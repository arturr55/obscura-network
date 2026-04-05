//! Obscura ZK Bridge — Sovereign SDK module.
//!
//! Handles `ClaimDeposit` call messages:
//!   1. Verify the SP1 ZK proof (mock on testnet, real Groth16 on mainnet)
//!   2. Check the deposit hasn't been claimed before (anti-replay)
//!   3. Mint bridged-USDC to the obscura_recipient address
//!   4. Emit a BridgeDeposited event

use anyhow::{bail, Result};
use schemars::JsonSchema;
use sov_modules_api::macros::{serialize, UniversalWallet};
use sov_modules_api::{
    Context, EventEmitter, GenesisState, Module, ModuleId, ModuleInfo, ModuleRestApi, Spec,
    StateMap, StateValue, TxState,
};
use sov_rollup_interface::da::DaSpec;
use std::marker::PhantomData;

use crate::types::{BridgeConfig, ClaimDeposit};

#[allow(dead_code)] // will be used when UpdateConfig is added
use crate::verifier::verify_bridge_proof;

// ── Obscura ZK Bridge Module ──────────────────────────────────────────────────

#[derive(Clone, ModuleInfo, ModuleRestApi)]
pub struct ObscuraBridge<S: Spec> {
    #[id]
    pub id: ModuleId,

    /// Bridge configuration (bridge contract address, VK hash, etc.)
    #[state]
    pub config: StateValue<BridgeConfig>,

    /// Processed deposits: anti-replay map.
    /// Key: hex(bridge_contract_20_bytes) + "_" + deposit_id (as decimal string)
    #[state]
    pub processed_deposits: StateMap<String, bool>,

    /// Total bridged USDC minted (6 decimal places)
    #[state]
    pub total_bridged_usdc: StateValue<u64>,

    /// Total number of successful bridge claims
    #[state]
    pub total_claims: StateValue<u64>,

    #[phantom]
    pub phantom: PhantomData<S>,
}

// ── Call Messages ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
#[serde(rename_all = "snake_case")]
pub enum BridgeCallMessage {
    /// Claim a locked USDC deposit from Ethereum.
    /// Submitted by the relayer after generating the SP1 storage proof.
    ClaimDeposit(ClaimDeposit),
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
#[serde(rename_all = "snake_case")]
pub enum BridgeEvent {
    /// Emitted when a deposit is successfully claimed and bridged-USDC is minted.
    DepositClaimed {
        deposit_id: u64,
        obscura_recipient: [u8; 32],
        amount: u64,
        eth_block_hash: [u8; 32],
    },
    /// Emitted when bridge config is updated.
    ConfigUpdated,
}

// ── Module Implementation ─────────────────────────────────────────────────────

impl<S: Spec> Module for ObscuraBridge<S> {
    type Spec = S;
    type Config = BridgeConfig;
    type CallMessage = BridgeCallMessage;
    type Event = BridgeEvent;
    type Error = anyhow::Error;

    fn genesis(
        &mut self,
        _genesis_rollup_header: &<<S as Spec>::Da as DaSpec>::BlockHeader,
        config: &Self::Config,
        state: &mut impl GenesisState<S>,
    ) -> Result<()> {
        self.config.set(config, state)?;
        self.total_bridged_usdc.set(&0u64, state)?;
        self.total_claims.set(&0u64, state)?;
        tracing::info!(
            "ObscuraBridge genesis: contract={}",
            config.bridge_contract_address
        );
        Ok(())
    }

    fn call(
        &mut self,
        msg: Self::CallMessage,
        context: &Context<Self::Spec>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        match msg {
            BridgeCallMessage::ClaimDeposit(claim) => {
                self.handle_claim_deposit(claim, context, state)
            }
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

impl<S: Spec> ObscuraBridge<S> {
    fn handle_claim_deposit(
        &mut self,
        claim: ClaimDeposit,
        _context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        let inputs = &claim.public_inputs;

        // ── 1. Validate inputs ─────────────────────────────────────────────
        if inputs.amount == 0 {
            bail!("Bridge: deposit amount is zero");
        }
        if inputs.obscura_recipient == [0u8; 32] {
            bail!("Bridge: zero obscura recipient");
        }

        // ── 2. Check config matches ────────────────────────────────────────
        let config = self.config.get(state)?.unwrap_or_default();
        let expected_contract = parse_contract_address(&config.bridge_contract_address)?;
        if inputs.bridge_contract != expected_contract {
            bail!(
                "Bridge: proof is for wrong contract {:?}, expected {:?}",
                inputs.bridge_contract,
                expected_contract
            );
        }

        // ── 3. Anti-replay: check deposit not already claimed ──────────────
        let deposit_key = make_deposit_key_str(&inputs.bridge_contract, inputs.deposit_id);
        if self.processed_deposits.get(&deposit_key, state)?.unwrap_or(false) {
            bail!(
                "Bridge: deposit {} already claimed",
                inputs.deposit_id
            );
        }

        // ── 4. Verify ZK proof ─────────────────────────────────────────────
        verify_bridge_proof(&claim.proof, inputs)
            .map_err(|e| anyhow::anyhow!("Bridge: proof verification failed: {e}"))?;

        // ── 5. Mark deposit as processed ───────────────────────────────────
        self.processed_deposits.set(&deposit_key, &true, state)?; // mark as processed

        // ── 6. Mint bridged-USDC to obscura_recipient ──────────────────────
        // Note: In the full integration, this calls sov-bank to mint tokens.
        // For Phase 1: we track balance in a simple state map and emit the event.
        // The dApp reads the event to credit the recipient's shielded balance.
        //
        // Phase 2: integrate with sov-bank:
        //   let token_id = TokenId::from(BRIDGED_USDC_TOKEN_ID);
        //   self.bank.mint(token_id, obscura_recipient, inputs.amount, state)?;

        let prev_total = self.total_bridged_usdc.get(state)?.unwrap_or(0);
        self.total_bridged_usdc.set(&(prev_total + inputs.amount), state)?;

        let prev_claims = self.total_claims.get(state)?.unwrap_or(0);
        self.total_claims.set(&(prev_claims + 1), state)?;

        tracing::info!(
            "Bridge: claimed deposit {} — {} USDC → {:?}",
            inputs.deposit_id,
            inputs.amount,
            hex::encode(inputs.obscura_recipient)
        );

        // ── 7. Emit event ──────────────────────────────────────────────────
        self.emit_event(
            state,
            BridgeEvent::DepositClaimed {
                deposit_id: inputs.deposit_id,
                obscura_recipient: inputs.obscura_recipient,
                amount: inputs.amount,
                eth_block_hash: inputs.eth_block_hash,
            },
        );

        Ok(())
    }

    // UpdateConfig will be added in a future version as a separate
    // admin call message once the UniversalWallet cross-crate limitation is resolved.
    #[allow(dead_code)]
    pub fn update_config(
        &mut self,
        new_config: BridgeConfig,
        context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        let current = self.config.get(state)?.unwrap_or_default();
        let caller = context.sender().as_ref().to_vec();
        if !current.admin.is_empty() && caller != current.admin {
            bail!("Bridge: only admin can update config");
        }
        self.config.set(&new_config, state)?;
        self.emit_event(state, BridgeEvent::ConfigUpdated);
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Create the string key for the anti-replay map.
/// Format: "0x{contract_hex}_{deposit_id}"
fn make_deposit_key_str(contract: &[u8; 20], deposit_id: u64) -> String {
    format!("0x{}_{}", hex::encode(contract), deposit_id)
}

/// Parse an Ethereum contract address from "0x..." hex string.
fn parse_contract_address(addr: &str) -> Result<[u8; 20]> {
    let s = addr.trim().strip_prefix("0x").unwrap_or(addr.trim());
    if s.len() != 40 {
        bail!("Bridge: invalid contract address length: {}", addr);
    }
    let mut bytes = [0u8; 20];
    hex::decode_to_slice(s, &mut bytes)
        .map_err(|e| anyhow::anyhow!("Bridge: invalid contract address hex: {e}"))?;
    Ok(bytes)
}
