//! ZK Bridge Relayer — watches Ethereum, generates proofs, submits to Obscura.
//!
//! The relayer is an off-chain service that:
//!   1. Polls Ethereum for `DepositLocked` events from ObscuraBridge.sol
//!   2. For each new deposit:
//!      a. Fetches the Ethereum block header and MPT storage proofs
//!      b. Generates an SP1 bridge proof (mock on testnet)
//!      c. Submits a `ClaimDeposit` call to the Obscura rollup RPC
//!   3. Persists processed deposit IDs to avoid re-submission
//!
//! # Usage
//!
//! ```bash
//! # Testnet (mock proofs, no SP1 computation)
//! cargo run -p obscura-zk-bridge --bin bridge-relayer -- \
//!   --eth-rpc https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY \
//!   --bridge-contract 0xYOUR_BRIDGE_ADDRESS \
//!   --obscura-rpc http://49.13.23.128:12346 \
//!   --mock-proofs
//!
//! # Production (real SP1 proofs — slow, needs GPU/cloud prover)
//! RUST_LOG=info cargo run -p obscura-zk-bridge --bin bridge-relayer \
//!   --features native -- \
//!   --eth-rpc https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY \
//!   --bridge-contract 0xYOUR_BRIDGE_ADDRESS \
//!   --obscura-rpc https://rpc.obscura.network
//! ```

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::{info, warn};

use crate::types::{BridgePublicInputs, ClaimDeposit};
use crate::verifier::MOCK_PROOF_PREFIX;
use crate::helios_types::{HeliosPublicInputs, UpdateHeliosHead};
use crate::helios::MOCK_HELIOS_PREFIX;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RelayerConfig {
    /// Ethereum JSON-RPC endpoint (Alchemy, Infura, etc.)
    pub eth_rpc: String,

    /// ObscuraBridge.sol address on Ethereum
    pub bridge_contract: String,

    /// Obscura rollup JSON-RPC endpoint
    pub obscura_rpc: String,

    /// Use mock proofs instead of real SP1 (for testnet/dev)
    pub mock_proofs: bool,

    /// Poll interval in seconds
    pub poll_interval_secs: u64,

    /// Block number to start scanning from (0 = from deployment block)
    pub start_block: u64,
}

// ── Ethereum types (simplified) ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EthLog {
    pub block_number: u64,
    pub block_hash: [u8; 32],
    pub tx_hash: [u8; 32],
    pub log_index: u64,
    /// Decoded DepositLocked fields
    pub deposit_id: u64,
    pub sender: [u8; 20],
    pub obscura_recipient: [u8; 32],
    pub amount: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageProofResult {
    pub block_header_rlp: Vec<u8>,
    pub state_root: [u8; 32],
    pub storage_root: [u8; 32],
    pub account_proof: Vec<Vec<u8>>,
    pub storage_proof: Vec<Vec<u8>>,
    pub slot_value: u64,
}

// ── Relayer ───────────────────────────────────────────────────────────────────

pub struct BridgeRelayer {
    config: RelayerConfig,
    processed: HashSet<u64>,
    eth_client: EthClient,
    obscura_client: ObscuraClient,
}

impl BridgeRelayer {
    pub fn new(config: RelayerConfig) -> Result<Self> {
        let eth_client = EthClient::new(&config.eth_rpc, &config.bridge_contract)?;
        let obscura_client = ObscuraClient::new(&config.obscura_rpc)?;
        Ok(Self {
            config,
            processed: HashSet::new(),
            eth_client,
            obscura_client,
        })
    }

    /// Run the relayer event loop.
    ///
    /// Each iteration:
    ///   1. Submit a Helios proof for the latest finalized beacon block (if new deposits exist)
    ///   2. Scan Ethereum for DepositLocked events and relay them to Obscura
    pub async fn run(&mut self) -> Result<()> {
        info!(
            "Bridge relayer started: contract={}, mock_proofs={}",
            self.config.bridge_contract,
            self.config.mock_proofs
        );

        let mut from_block = self.config.start_block;
        let mut last_helios_block: u64 = 0;

        loop {
            match self.scan_and_relay(from_block, &mut last_helios_block).await {
                Ok(last_block) => {
                    from_block = last_block.saturating_add(1);
                }
                Err(e) => {
                    warn!("Relayer scan error (will retry): {e}");
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(
                self.config.poll_interval_secs,
            ))
            .await;
        }
    }

    async fn scan_and_relay(&mut self, from_block: u64, last_helios_block: &mut u64) -> Result<u64> {
        // Get latest finalized block
        let latest = self.eth_client.get_latest_block().await?;
        if from_block > latest {
            return Ok(latest);
        }

        // Scan for DepositLocked events in range
        let logs = self
            .eth_client
            .get_deposit_events(from_block, latest)
            .await?;

        // If there are new deposits, submit a Helios proof first so
        // the rollup can verify them trustlessly.
        if !logs.is_empty() && latest != *last_helios_block {
            match self.submit_helios_update(latest).await {
                Ok(_) => {
                    info!("Helios: updated trusted beacon root for block {}", latest);
                    *last_helios_block = latest;
                }
                Err(e) => {
                    warn!("Helios update failed (deposits may be delayed): {e}");
                    // Don't bail — deposits still work in Phase 1 (trusted mode)
                    // once Helios is fully activated, this would block deposits
                }
            }
        }

        for log in logs {
            if self.processed.contains(&log.deposit_id) {
                continue;
            }

            match self.relay_deposit(&log).await {
                Ok(_) => {
                    info!(
                        "Relayed deposit {}: {} USDC → {:?}",
                        log.deposit_id,
                        log.amount,
                        hex::encode(log.obscura_recipient)
                    );
                    self.processed.insert(log.deposit_id);
                }
                Err(e) => {
                    warn!("Failed to relay deposit {}: {e}", log.deposit_id);
                    // Will retry next scan
                }
            }
        }

        Ok(latest)
    }

    /// Submit a Helios head update to the Obscura rollup.
    ///
    /// In mock mode: creates a mock Helios proof for the given ETH block.
    /// In real mode: generates and submits a real SP1 Helios proof.
    async fn submit_helios_update(&self, eth_block_number: u64) -> Result<()> {
        // Fetch the beacon block root for this ETH block (via EIP-4788)
        let beacon_root = self
            .eth_client
            .get_beacon_root(eth_block_number)
            .await?;

        // Fetch the ETH block hash
        let block = self
            .eth_client
            .eth_call(
                "eth_getBlockByNumber",
                serde_json::json!([format!("0x{:x}", eth_block_number), false]),
            )
            .await?;
        let eth_block_hash_hex = block["hash"].as_str().unwrap_or("0x00");
        let eth_block_hash = hex_decode(eth_block_hash_hex)?;
        if eth_block_hash.len() != 32 {
            anyhow::bail!("Helios: invalid eth_block_hash length");
        }
        let mut eth_block_hash_arr = [0u8; 32];
        eth_block_hash_arr.copy_from_slice(&eth_block_hash);

        // Query the rollup for its current trusted beacon root and slot
        let (current_trusted_root, current_slot) = self
            .obscura_client
            .get_helios_state()
            .await
            .unwrap_or(([0u8; 32], 0));

        // New slot: use eth_block_number as a proxy for slot (real: fetch from beacon API)
        // In production, fetch the actual beacon slot from the CL API.
        let new_slot = eth_block_number; // simplified for Phase 1

        if new_slot <= current_slot {
            // Already up to date
            return Ok(());
        }

        // Build public inputs
        let public_inputs = HeliosPublicInputs {
            prev_trusted_root: current_trusted_root,
            new_beacon_root: beacon_root,
            new_slot,
            execution_block_hash: eth_block_hash_arr,
        };

        // Generate Helios proof (mock or real)
        let proof = if self.config.mock_proofs {
            // Mock: "OBShelios" + slot as 8 bytes LE
            let mut p = MOCK_HELIOS_PREFIX.to_vec();
            p.extend_from_slice(&new_slot.to_le_bytes());
            p
        } else {
            self.generate_helios_sp1_proof(&public_inputs).await?
        };

        // Submit to Obscura rollup
        let update = UpdateHeliosHead { proof, public_inputs };
        self.obscura_client.submit_helios_update(update).await?;

        Ok(())
    }

    #[allow(unused_variables)]
    async fn generate_helios_sp1_proof(&self, inputs: &HeliosPublicInputs) -> Result<Vec<u8>> {
        // Phase 2: Generate real SP1 Helios proof.
        //
        // Steps:
        //   1. Fetch full beacon LightClientUpdate from Beacon API
        //      (attested_header, finalized_header, finality_branch, sync_aggregate)
        //   2. Build HeliosWitness struct
        //   3. Call sp1_sdk::ProverClient::prove(HELIOS_ELF, witness)
        //   4. Return Groth16 proof bytes
        anyhow::bail!(
            "Real SP1 Helios proof generation not yet implemented. Use --mock-proofs for testnet."
        )
    }

    async fn relay_deposit(&self, log: &EthLog) -> Result<()> {
        // 1. Fetch MPT storage proof for deposits[depositId]
        let storage_proof = self
            .eth_client
            .get_storage_proof(log.block_number, log.deposit_id)
            .await?;

        // 2. Build bridge public inputs
        let public_inputs = BridgePublicInputs {
            eth_block_hash: log.block_hash,
            beacon_block_root: self.eth_client.get_beacon_root(log.block_number).await?,
            deposit_id: log.deposit_id,
            obscura_recipient: log.obscura_recipient,
            amount: log.amount,
            bridge_contract: parse_address_str(&self.config.bridge_contract)?,
        };

        // 3. Generate proof
        let proof = if self.config.mock_proofs {
            // Testnet: mock proof = "OBSbridge" + deposit_id
            let mut p = MOCK_PROOF_PREFIX.to_vec();
            p.extend_from_slice(&log.deposit_id.to_le_bytes());
            p
        } else {
            // Production: generate real SP1 proof
            self.generate_sp1_proof(log, &storage_proof, &public_inputs)
                .await?
        };

        // 4. Submit ClaimDeposit to Obscura rollup
        let claim = ClaimDeposit { proof, public_inputs };
        self.obscura_client.submit_claim(claim).await?;

        Ok(())
    }

    #[allow(unused_variables)]
    async fn generate_sp1_proof(
        &self,
        log: &EthLog,
        storage_proof: &StorageProofResult,
        public_inputs: &BridgePublicInputs,
    ) -> Result<Vec<u8>> {
        // Real SP1 proof generation.
        // Requires `native` feature and SP1 prover network access.
        //
        // Phase 2 implementation:
        //   1. Build BridgeDepositWitness from storage_proof
        //   2. Call sp1_sdk::ProverClient::prove(ELF, witness)
        //   3. Return serialized Groth16 proof bytes
        //
        // For now, return error to force mock mode in CI.
        anyhow::bail!(
            "Real SP1 proof generation not yet implemented. Use --mock-proofs for testnet."
        )
    }
}

// ── Ethereum Client ───────────────────────────────────────────────────────────

pub struct EthClient {
    rpc_url: String,
    bridge_contract: String,
}

impl EthClient {
    pub fn new(rpc_url: &str, bridge_contract: &str) -> Result<Self> {
        Ok(Self {
            rpc_url: rpc_url.to_string(),
            bridge_contract: bridge_contract.to_string(),
        })
    }

    pub async fn get_latest_block(&self) -> Result<u64> {
        let response = self
            .eth_call("eth_blockNumber", serde_json::json!([]))
            .await?;
        let hex_str = response
            .as_str()
            .context("eth_blockNumber: expected string")?;
        let num = u64::from_str_radix(hex_str.trim_start_matches("0x"), 16)
            .context("eth_blockNumber: parse error")?;
        Ok(num)
    }

    /// Fetch DepositLocked events from the bridge contract.
    ///
    /// DepositLocked event signature:
    ///   event DepositLocked(uint256 indexed depositId, address indexed sender,
    ///                       bytes32 indexed obscuraRecipient, uint256 amount, uint64 timestamp)
    ///   topic0 = keccak256("DepositLocked(uint256,address,bytes32,uint256,uint64)")
    pub async fn get_deposit_events(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<EthLog>> {
        // DepositLocked(uint256,address,bytes32,uint256,uint64)
        const TOPIC0: &str =
            "0x8a22e8ed8ee68e22fc67c94e4a26893b6d88ef0ee84bee8ca22a5b0a4d8a0a87";

        let params = serde_json::json!([{
            "fromBlock": format!("0x{:x}", from_block),
            "toBlock":   format!("0x{:x}", to_block),
            "address":   &self.bridge_contract,
            "topics":    [TOPIC0]
        }]);

        let logs_raw = self.eth_call("eth_getLogs", params).await?;
        let logs_arr = logs_raw.as_array().context("eth_getLogs: expected array")?;

        let mut result = Vec::new();
        for log in logs_arr {
            if let Ok(parsed) = self.parse_deposit_log(log) {
                result.push(parsed);
            }
        }
        Ok(result)
    }

    fn parse_deposit_log(&self, log: &serde_json::Value) -> Result<EthLog> {
        // topics[1] = depositId (indexed, padded to 32 bytes)
        // topics[2] = sender (indexed, padded to 32 bytes)
        // topics[3] = obscuraRecipient (indexed, 32 bytes)
        // data = abi.encode(amount, timestamp)
        let topics = log["topics"]
            .as_array()
            .context("log: missing topics")?;

        let deposit_id = hex_to_u64(&topics[1].as_str().unwrap_or(""))?;
        let sender = hex_to_address(&topics[2].as_str().unwrap_or(""))?;
        let obscura_recipient = hex_to_bytes32(&topics[3].as_str().unwrap_or(""))?;

        // data = amount (32 bytes) + timestamp (32 bytes)
        let data = hex_decode(log["data"].as_str().unwrap_or("0x"))?;
        let amount = u64::from_be_bytes(data[24..32].try_into()?);

        let block_number =
            hex_to_u64(log["blockNumber"].as_str().unwrap_or("0x0"))?;
        let block_hash = hex_to_bytes32(log["blockHash"].as_str().unwrap_or(""))?;
        let tx_hash = hex_to_bytes32(
            log["transactionHash"].as_str().unwrap_or(""),
        )?;
        let log_index =
            hex_to_u64(log["logIndex"].as_str().unwrap_or("0x0"))?;

        Ok(EthLog {
            block_number,
            block_hash,
            tx_hash,
            log_index,
            deposit_id,
            sender,
            obscura_recipient,
            amount,
        })
    }

    /// Fetch MPT storage proof for deposits[depositId] at a given block.
    /// Uses `eth_getProof` (EIP-1186).
    pub async fn get_storage_proof(
        &self,
        block_number: u64,
        deposit_id: u64,
    ) -> Result<StorageProofResult> {
        // Storage slot for deposits[depositId] = keccak256(depositId || 3)
        let slot = compute_deposit_slot(deposit_id);
        let slot_hex = format!("0x{}", hex::encode(slot));

        let params = serde_json::json!([
            &self.bridge_contract,
            [&slot_hex],
            format!("0x{:x}", block_number)
        ]);

        let proof = self.eth_call("eth_getProof", params).await?;

        let state_root_hex = proof["stateRoot"].as_str().unwrap_or("");
        let storage_root_hex = proof["storageHash"].as_str().unwrap_or("");

        let state_root = hex_to_bytes32(state_root_hex)?;
        let storage_root = hex_to_bytes32(storage_root_hex)?;

        let account_proof = proof["accountProof"]
            .as_array()
            .context("missing accountProof")?
            .iter()
            .map(|v| hex_decode(v.as_str().unwrap_or("0x")))
            .collect::<Result<Vec<_>>>()?;

        let storage_proof_nodes = proof["storageProof"][0]["proof"]
            .as_array()
            .context("missing storageProof[0].proof")?
            .iter()
            .map(|v| hex_decode(v.as_str().unwrap_or("0x")))
            .collect::<Result<Vec<_>>>()?;

        let slot_value_hex = proof["storageProof"][0]["value"]
            .as_str()
            .unwrap_or("0x0");
        let slot_value = hex_to_u64(slot_value_hex)?;

        // Fetch block header RLP
        let block = self
            .eth_call(
                "eth_getBlockByNumber",
                serde_json::json!([format!("0x{:x}", block_number), false]),
            )
            .await?;
        let block_header_rlp = encode_block_header_rlp(&block)?;

        Ok(StorageProofResult {
            block_header_rlp,
            state_root,
            storage_root,
            account_proof,
            storage_proof: storage_proof_nodes,
            slot_value,
        })
    }

    /// Get EIP-4788 beacon block root for a given execution block.
    pub async fn get_beacon_root(&self, block_number: u64) -> Result<[u8; 32]> {
        // EIP-4788: beacon block root is stored in the execution block's
        // `parentBeaconBlockRoot` field (available since Cancun fork).
        let block = self
            .eth_call(
                "eth_getBlockByNumber",
                serde_json::json!([format!("0x{:x}", block_number), false]),
            )
            .await?;

        let root_hex = block["parentBeaconBlockRoot"].as_str().unwrap_or("");
        if root_hex.len() < 3 {
            // Pre-Cancun block or not available: use block hash as fallback
            return hex_to_bytes32(
                block["hash"].as_str().unwrap_or("0x00"),
            );
        }
        hex_to_bytes32(root_hex)
    }

    pub async fn eth_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .context("eth RPC request failed")?
            .json::<serde_json::Value>()
            .await
            .context("eth RPC response parse failed")?;

        if let Some(err) = resp.get("error") {
            anyhow::bail!("eth RPC error: {}", err);
        }

        Ok(resp["result"].clone())
    }
}

// ── Obscura Client ────────────────────────────────────────────────────────────

pub struct ObscuraClient {
    rpc_url: String,
}

impl ObscuraClient {
    pub fn new(rpc_url: &str) -> Result<Self> {
        Ok(Self {
            rpc_url: rpc_url.to_string(),
        })
    }

    /// Query the current Helios state (trusted_beacon_root, trusted_slot) from the rollup.
    pub async fn get_helios_state(&self) -> Result<([u8; 32], u64)> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "obscura_getHeliosState",
            "params": []
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .await
            .context("Obscura RPC: get_helios_state request failed")?
            .json::<serde_json::Value>()
            .await
            .context("Obscura RPC: get_helios_state parse failed")?;

        if let Some(err) = resp.get("error") {
            anyhow::bail!("Obscura RPC error (helios state): {}", err);
        }

        let result = &resp["result"];
        let root_hex = result["trusted_beacon_root"].as_str().unwrap_or("0x");
        let slot = result["trusted_slot"].as_u64().unwrap_or(0);

        let root_bytes = hex_decode(root_hex).unwrap_or_default();
        let mut root = [0u8; 32];
        if root_bytes.len() == 32 {
            root.copy_from_slice(&root_bytes);
        }

        Ok((root, slot))
    }

    /// Submit an UpdateHeliosHead call to the Obscura rollup.
    pub async fn submit_helios_update(&self, update: UpdateHeliosHead) -> Result<()> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "obscura_submitHeliosUpdate",
            "params": [update]
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .await
            .context("Obscura RPC: submit_helios_update request failed")?
            .json::<serde_json::Value>()
            .await
            .context("Obscura RPC: submit_helios_update parse failed")?;

        if let Some(err) = resp.get("error") {
            anyhow::bail!("Obscura RPC error (helios update): {}", err);
        }

        info!("Helios update submitted: {:?}", resp["result"]);
        Ok(())
    }

    /// Submit a ClaimDeposit call to the Obscura rollup.
    pub async fn submit_claim(&self, claim: ClaimDeposit) -> Result<()> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "obscura_submitBridgeClaim",
            "params": [claim]
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .await
            .context("Obscura RPC: submit_claim request failed")?
            .json::<serde_json::Value>()
            .await
            .context("Obscura RPC: submit_claim response parse failed")?;

        if let Some(err) = resp.get("error") {
            anyhow::bail!("Obscura RPC error: {}", err);
        }

        info!("ClaimDeposit submitted: {:?}", resp["result"]);
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Compute Solidity mapping storage slot: keccak256(depositId as u256 || slot_3)
pub fn compute_deposit_slot(deposit_id: u64) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut preimage = [0u8; 64];
    preimage[24..32].copy_from_slice(&deposit_id.to_be_bytes());
    preimage[63] = 3; // mapping at slot 3
    let mut k = Keccak::v256();
    k.update(&preimage);
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

fn hex_to_u64(s: &str) -> Result<u64> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() {
        return Ok(0);
    }
    u64::from_str_radix(s, 16).context("hex_to_u64 parse error")
}

fn hex_to_bytes32(s: &str) -> Result<[u8; 32]> {
    let bytes = hex_decode(s)?;
    if bytes.len() != 32 {
        anyhow::bail!("expected 32 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn hex_to_address(s: &str) -> Result<[u8; 20]> {
    // Addresses are padded to 32 bytes in topics
    let bytes = hex_decode(s)?;
    if bytes.len() < 20 {
        anyhow::bail!("address too short: {} bytes", bytes.len());
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes[bytes.len() - 20..]);
    Ok(out)
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() {
        return Ok(vec![]);
    }
    hex::decode(s).context("hex decode error")
}

fn parse_address_str(s: &str) -> Result<[u8; 20]> {
    let s = s.trim().trim_start_matches("0x");
    if s.len() != 40 {
        anyhow::bail!("address must be 40 hex chars");
    }
    let mut bytes = [0u8; 20];
    hex::decode_to_slice(s, &mut bytes)?;
    Ok(bytes)
}

/// Minimal RLP encoding of an Ethereum block header.
/// For Phase 1 we only need the block hash, so we just keccak256 the raw hex.
fn encode_block_header_rlp(block: &serde_json::Value) -> Result<Vec<u8>> {
    // The `eth_getBlockByNumber` response doesn't include the raw RLP header.
    // To get the raw header, we'd need eth_getRawTransactionByHash or a full node.
    // For Phase 1 (mock proofs): return block hash bytes directly.
    // Phase 2: use alloy's block RLP encoding.
    let hash = block["hash"].as_str().unwrap_or("0x00");
    hex_decode(hash)
}
