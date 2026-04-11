//! Ethereum Beacon Chain (Consensus Layer) API client and Helios witness builder.
//!
//! Implements:
//!   - [`BeaconApiClient`] — fetches `LightClientFinalityUpdate` and genesis data
//!   - [`build_helios_witness`] — constructs a [`HeliosWitness`] ready for SP1 proving
//!   - SSZ helpers for ExecutionPayloadHeader (Deneb) — hash_tree_root + Merkle branch
//!
//! The witness types here mirror `crates/provers/sp1/guest-helios/src/types.rs`.
//! Both sets of types must stay in sync (same field order, same serde format).
//!
//! # Beacon API endpoints used
//!
//! - `GET /eth/v1/beacon/light_client/finality_update` — latest finalized LC update
//! - `GET /eth/v1/config/genesis` — genesis_validators_root, genesis_fork_version
//! - `GET /eth/v1/beacon/states/finalized/sync_committees` — sync committee pubkeys
//!
//! # Public Beacon API nodes (testnet)
//!
//! - Ethereum Sepolia: https://lodestar-sepolia.chainsafe.io
//! - Ethereum Mainnet: https://lodestar-mainnet.chainsafe.io
//!                     https://www.lightclientdata.org

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ── Beacon API JSON types ─────────────────────────────────────────────────────

/// Minimal beacon block header (slot, proposer_index, parent_root, state_root, body_root).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconHeaderJson {
    pub slot: String,
    pub proposer_index: String,
    pub parent_root: String,
    pub state_root: String,
    pub body_root: String,
}

/// ExecutionPayloadHeader (Deneb) from the Beacon API.
/// All fields are hex strings (bytes) or decimal strings (integers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPayloadHeaderJson {
    pub parent_hash: String,
    pub fee_recipient: String,
    pub state_root: String,
    pub receipts_root: String,
    pub logs_bloom: String,
    pub prev_randao: String,
    pub block_number: String,
    pub gas_limit: String,
    pub gas_used: String,
    pub timestamp: String,
    pub extra_data: String,
    pub base_fee_per_gas: String,
    pub block_hash: String,
    pub transactions_root: String,
    pub withdrawals_root: String,
    pub blob_gas_used: String,
    pub excess_blob_gas: String,
}

/// A Deneb LightClientHeader (beacon header + execution header + execution branch).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightClientHeaderJson {
    pub beacon: BeaconHeaderJson,
    pub execution: ExecutionPayloadHeaderJson,
    pub execution_branch: Vec<String>, // 4 nodes (depth=4)
}

/// Sync aggregate: bitvector of participants + BLS12-381 G2 aggregate signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAggregateJson {
    pub sync_committee_bits: String,      // hex bitvector (512 bits = 64 bytes)
    pub sync_committee_signature: String, // hex 96-byte G2 aggregate signature
}

/// Full `LightClientFinalityUpdate` response body (Deneb).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightClientFinalityUpdateJson {
    pub attested_header: LightClientHeaderJson,
    pub finalized_header: LightClientHeaderJson,
    pub finality_branch: Vec<String>, // 6 nodes (FINALIZED_ROOT_GINDEX=105, depth=6)
    pub sync_aggregate: SyncAggregateJson,
    pub signature_slot: String,
}

/// Genesis configuration from `GET /eth/v1/config/genesis`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisConfigJson {
    pub genesis_validators_root: String, // hex Bytes32
    pub genesis_fork_version: String,    // hex Bytes4 ("0x00000000")
    pub genesis_time: String,            // decimal unix timestamp
}

// ── HeliosWitness (mirrors guest-helios/src/types.rs) ────────────────────────
//
// IMPORTANT: Field names and types must match the SP1 guest crate exactly.
// Both sides serialize with `bincode` via serde, so the layout must be identical.

/// A beacon block header (Ethereum consensus layer).
///
/// Only `Serialize` is needed (we write this into SP1 stdin with bincode).
/// The guest circuit uses its own copy with `Serialize + Deserialize`.
#[derive(Debug, Clone, Serialize)]
pub struct BeaconBlockHeader {
    pub slot: u64,
    pub proposer_index: u64,
    pub parent_root: [u8; 32],
    pub state_root: [u8; 32],
    pub body_root: [u8; 32],
}

/// Full witness for one Helios light client step.
/// Fed into SP1 via `stdin.write(&witness)` (bincode serialization).
///
/// Field layout mirrors `crates/provers/sp1/guest-helios/src/types.rs` exactly.
/// Both use bincode (via serde) so field order and types must match.
///
/// Note: `[u8; 48]` and `[u8; 96]` are stored as fixed-size arrays but this
/// workspace's serde build doesn't support Serialize/Deserialize for them.
/// We use `serde_bytes`-style manual serialization through helper wrappers.
/// SP1 stdin uses bincode which handles `[u8; N]` natively via `serialize_tuple`.
#[derive(Debug, Clone)]
pub struct HeliosWitness {
    pub prev_trusted_root: [u8; 32],
    pub attested_header: BeaconBlockHeader,
    pub finalized_header: BeaconBlockHeader,
    pub finality_branch: [[u8; 32]; 6],
    pub sync_committee_participation: u16,
    pub sync_aggregate_signature: [u8; 96],
    pub sync_committee_pubkey: [u8; 48],
    pub fork_version: [u8; 4],
    pub genesis_validators_root: [u8; 32],
    pub execution_payload_root: [u8; 32],
    pub body_to_exec_branch: [[u8; 32]; 4],
    pub execution_block_hash: [u8; 32],
    pub exec_to_hash_branch: [[u8; 32]; 5],
}

/// Manual Serialize impl for HeliosWitness.
///
/// Produces the same bincode layout as the guest circuit's derived Serialize:
/// each fixed-size array is serialized as a tuple of bytes in field order.
/// This is required because the workspace's serde doesn't support [u8;48]/[u8;96].
impl serde::Serialize for HeliosWitness {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("HeliosWitness", 13)?;
        st.serialize_field("prev_trusted_root", &self.prev_trusted_root)?;
        st.serialize_field("attested_header", &self.attested_header)?;
        st.serialize_field("finalized_header", &self.finalized_header)?;
        st.serialize_field("finality_branch", &self.finality_branch)?;
        st.serialize_field("sync_committee_participation", &self.sync_committee_participation)?;
        st.serialize_field("sync_aggregate_signature", &SerBytes(&self.sync_aggregate_signature))?;
        st.serialize_field("sync_committee_pubkey", &SerBytes(&self.sync_committee_pubkey))?;
        st.serialize_field("fork_version", &self.fork_version)?;
        st.serialize_field("genesis_validators_root", &self.genesis_validators_root)?;
        st.serialize_field("execution_payload_root", &self.execution_payload_root)?;
        st.serialize_field("body_to_exec_branch", &self.body_to_exec_branch)?;
        st.serialize_field("execution_block_hash", &self.execution_block_hash)?;
        st.serialize_field("exec_to_hash_branch", &self.exec_to_hash_branch)?;
        st.end()
    }
}

/// Newtype wrapper that serializes `[u8; N]` as a fixed-length byte tuple.
/// Matches the serde output of `#[derive(Serialize)]` on `[u8; N]` in the guest.
struct SerBytes<'a>(&'a [u8]);

impl<'a> serde::Serialize for SerBytes<'a> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeTuple;
        let mut tup = s.serialize_tuple(self.0.len())?;
        for b in self.0 {
            tup.serialize_element(b)?;
        }
        tup.end()
    }
}

// ── BeaconApiClient ───────────────────────────────────────────────────────────

/// HTTP client for the Ethereum Beacon Chain (Consensus Layer) API.
pub struct BeaconApiClient {
    base_url: String,
    http: reqwest::Client,
}

impl BeaconApiClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// Fetch the latest `LightClientFinalityUpdate`.
    ///
    /// Corresponds to: `GET /eth/v1/beacon/light_client/finality_update`
    pub async fn get_finality_update(&self) -> Result<LightClientFinalityUpdateJson> {
        let url = format!(
            "{}/eth/v1/beacon/light_client/finality_update",
            self.base_url
        );
        let body = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .context("beacon API: get_finality_update request failed")?
            .json::<serde_json::Value>()
            .await
            .context("beacon API: get_finality_update parse failed")?;

        serde_json::from_value(body["data"].clone())
            .context("beacon API: deserialize LightClientFinalityUpdate failed")
    }

    /// Fetch genesis configuration (genesis_validators_root, genesis_fork_version).
    ///
    /// Corresponds to: `GET /eth/v1/config/genesis`
    pub async fn get_genesis(&self) -> Result<GenesisConfigJson> {
        let url = format!("{}/eth/v1/config/genesis", self.base_url);
        let body = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .context("beacon API: get_genesis request failed")?
            .json::<serde_json::Value>()
            .await
            .context("beacon API: get_genesis parse failed")?;

        serde_json::from_value(body["data"].clone())
            .context("beacon API: deserialize GenesisConfig failed")
    }

    /// Fetch the aggregate BLS12-381 public key for the current sync committee.
    ///
    /// Uses `GET /eth/v1/beacon/light_client/bootstrap/{block_root}` which returns
    /// the `current_sync_committee.aggregate_pubkey` for the sync committee active
    /// at the given `block_root`.
    ///
    /// In Phase 1 (mock BLS), any non-zero key passes the circuit's structural check.
    /// Pass the finalized beacon root from the latest finality update.
    pub async fn get_sync_committee_aggregate_pubkey(
        &self,
        block_root: &str,
    ) -> Result<[u8; 48]> {
        let url = format!(
            "{}/eth/v1/beacon/light_client/bootstrap/{}",
            self.base_url, block_root
        );
        let body = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .context("beacon API: get bootstrap request failed")?
            .json::<serde_json::Value>()
            .await
            .context("beacon API: get bootstrap parse failed")?;

        let pubkey_hex = body["data"]["current_sync_committee"]["aggregate_pubkey"]
            .as_str()
            .unwrap_or("0x");

        let bytes = hex_decode(pubkey_hex)
            .context("beacon API: parse aggregate_pubkey failed")?;

        if bytes.len() != 48 {
            anyhow::bail!(
                "beacon API: aggregate_pubkey has {} bytes, expected 48",
                bytes.len()
            );
        }
        let mut arr = [0u8; 48];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}

// ── Witness builder ───────────────────────────────────────────────────────────

/// Build a [`HeliosWitness`] from a `LightClientFinalityUpdate` and genesis config.
///
/// The witness is fed into the SP1 helios_step circuit via `stdin.write(&witness)`.
///
/// # Arguments
/// - `update` — latest finality update from the beacon API
/// - `genesis` — genesis config (genesis_validators_root, fork_version)
/// - `sync_committee_pubkey` — aggregate BLS pubkey of the current sync committee
/// - `prev_trusted_root` — the rollup's current trusted beacon root
///
/// # Returns
/// A fully constructed `HeliosWitness` ready for SP1 proving.
pub fn build_helios_witness(
    update: &LightClientFinalityUpdateJson,
    genesis: &GenesisConfigJson,
    sync_committee_pubkey: [u8; 48],
    prev_trusted_root: [u8; 32],
) -> Result<HeliosWitness> {
    // ── Parse beacon block headers ─────────────────────────────────────────────
    let attested_header = parse_beacon_header(&update.attested_header.beacon)?;
    let finalized_header = parse_beacon_header(&update.finalized_header.beacon)?;

    // ── Parse finality branch (6 nodes, FINALIZED_ROOT_GINDEX = 105, depth = 6) ─
    let finality_branch = parse_branch_6(&update.finality_branch)
        .context("build_witness: parse finality_branch failed")?;

    // ── Sync committee participation ───────────────────────────────────────────
    // Count set bits in sync_committee_bits bitvector (SSZ BitVector[512] = 64 bytes).
    let bits_hex = hex_decode(&update.sync_aggregate.sync_committee_bits)
        .context("build_witness: parse sync_committee_bits failed")?;
    let participation: u16 = bits_hex.iter().map(|b| b.count_ones()).sum::<u32>() as u16;

    // ── Sync aggregate signature (BLS12-381 G2, 96 bytes) ─────────────────────
    let sig_bytes = hex_decode(&update.sync_aggregate.sync_committee_signature)
        .context("build_witness: parse sync_committee_signature failed")?;
    if sig_bytes.len() != 96 {
        anyhow::bail!(
            "build_witness: sync_committee_signature has {} bytes, expected 96",
            sig_bytes.len()
        );
    }
    let mut sync_aggregate_signature = [0u8; 96];
    sync_aggregate_signature.copy_from_slice(&sig_bytes);

    // ── Fork version (Deneb: mainnet = 0x04000000, Sepolia = 0x90000073) ──────
    let fork_version = parse_fork_version(&genesis.genesis_fork_version)
        .context("build_witness: parse fork_version failed")?;

    // ── Genesis validators root ────────────────────────────────────────────────
    let genesis_validators_root = parse_bytes32(&genesis.genesis_validators_root)
        .context("build_witness: parse genesis_validators_root failed")?;

    // ── Execution payload: root + branches ────────────────────────────────────
    // body_to_exec_branch: finalized_header.execution_branch (depth=4, leaf_index=9).
    // This proves execution_payload_root is in finalized_header.body_root.
    let body_to_exec_branch = parse_branch_4(&update.finalized_header.execution_branch)
        .context("build_witness: parse execution_branch failed")?;

    // execution_payload_root: hash_tree_root(ExecutionPayloadHeader) — computed locally.
    // exec_to_hash_branch:    Merkle proof within the payload tree to block_hash (leaf 12).
    let (execution_payload_root, exec_leaves) =
        ssz_execution_payload_root(&update.finalized_header.execution)
            .context("build_witness: compute execution_payload_root failed")?;

    let exec_to_hash_branch = merkle_branch_32(&exec_leaves, 12);

    // execution_block_hash: the actual EL block hash (keccak256 of the EL block header).
    let execution_block_hash = parse_bytes32(&update.finalized_header.execution.block_hash)
        .context("build_witness: parse execution.block_hash failed")?;

    Ok(HeliosWitness {
        prev_trusted_root,
        attested_header,
        finalized_header,
        finality_branch,
        sync_committee_participation: participation,
        sync_aggregate_signature,
        sync_committee_pubkey,
        fork_version,
        genesis_validators_root,
        execution_payload_root,
        body_to_exec_branch,
        execution_block_hash,
        exec_to_hash_branch,
    })
}

// ── SSZ helpers for ExecutionPayloadHeader (Deneb) ───────────────────────────
//
// Deneb ExecutionPayloadHeader: 17 fields → padded to 32 leaves (depth = 5).
//
// Field index:  0   parent_hash        (Bytes32)
//               1   fee_recipient      (Address → Bytes20 padded to 32)
//               2   state_root         (Bytes32)
//               3   receipts_root      (Bytes32)
//               4   logs_bloom         (ByteVector[256] → Merkle root of 8 chunks)
//               5   prev_randao        (Bytes32)
//               6   block_number       (uint64 LE padded)
//               7   gas_limit          (uint64 LE padded)
//               8   gas_used           (uint64 LE padded)
//               9   timestamp          (uint64 LE padded)
//              10   extra_data         (ByteList[32] → mix_in_length)
//              11   base_fee_per_gas   (uint256 LE)
//              12   block_hash         (Bytes32) ← the field we prove
//              13   transactions_root  (Bytes32)
//              14   withdrawals_root   (Bytes32)
//              15   blob_gas_used      (uint64 LE, Deneb)
//              16   excess_blob_gas    (uint64 LE, Deneb)
//           17..31  zero (SSZ padding)

/// Compute `hash_tree_root(ExecutionPayloadHeader)` and return the 32-leaf SSZ tree.
///
/// Returns `(root, leaves)` so that the caller can extract any branch.
pub fn ssz_execution_payload_root(
    exec: &ExecutionPayloadHeaderJson,
) -> Result<([u8; 32], [[u8; 32]; 32])> {
    let mut leaves = [[0u8; 32]; 32];

    // 0: parent_hash
    leaves[0] = parse_bytes32(&exec.parent_hash)?;

    // 1: fee_recipient (20-byte address, zero-padded to 32)
    let fee = hex_decode(&exec.fee_recipient)?;
    if fee.len() != 20 {
        anyhow::bail!("ssz: fee_recipient has {} bytes, expected 20", fee.len());
    }
    leaves[1][..20].copy_from_slice(&fee);

    // 2-3: state_root, receipts_root
    leaves[2] = parse_bytes32(&exec.state_root)?;
    leaves[3] = parse_bytes32(&exec.receipts_root)?;

    // 4: logs_bloom — ByteVector[256] → 8 chunks of 32 bytes, depth-3 Merkle tree
    let bloom = hex_decode(&exec.logs_bloom)?;
    if bloom.len() != 256 {
        anyhow::bail!("ssz: logs_bloom has {} bytes, expected 256", bloom.len());
    }
    leaves[4] = ssz_bytes_vector_root(&bloom);

    // 5: prev_randao
    leaves[5] = parse_bytes32(&exec.prev_randao)?;

    // 6-9: uint64 fields (LE, zero-padded to 32)
    leaves[6] = uint64_leaf(exec.block_number.parse::<u64>()
        .context("ssz: parse block_number")?);
    leaves[7] = uint64_leaf(exec.gas_limit.parse::<u64>()
        .context("ssz: parse gas_limit")?);
    leaves[8] = uint64_leaf(exec.gas_used.parse::<u64>()
        .context("ssz: parse gas_used")?);
    leaves[9] = uint64_leaf(exec.timestamp.parse::<u64>()
        .context("ssz: parse timestamp")?);

    // 10: extra_data — ByteList[32] → mix_in_length(merkle_root(chunks), length)
    let extra = hex_decode(&exec.extra_data)?;
    if extra.len() > 32 {
        anyhow::bail!("ssz: extra_data has {} bytes, max 32", extra.len());
    }
    leaves[10] = ssz_byte_list_root(&extra, 1 /* max_chunks = ceil(32/32) = 1 */);

    // 11: base_fee_per_gas — uint256 as decimal string → 32-byte LE
    leaves[11] = parse_uint256_le(&exec.base_fee_per_gas)
        .context("ssz: parse base_fee_per_gas")?;

    // 12: block_hash ← the leaf we want to prove
    leaves[12] = parse_bytes32(&exec.block_hash)?;

    // 13-14: roots
    leaves[13] = parse_bytes32(&exec.transactions_root)?;
    leaves[14] = parse_bytes32(&exec.withdrawals_root)?;

    // 15-16: Deneb new fields
    leaves[15] = uint64_leaf(exec.blob_gas_used.parse::<u64>()
        .context("ssz: parse blob_gas_used")?);
    leaves[16] = uint64_leaf(exec.excess_blob_gas.parse::<u64>()
        .context("ssz: parse excess_blob_gas")?);
    // leaves[17..31] remain zero (SSZ padding)

    let root = merkle_root_vec(leaves.to_vec());
    Ok((root, leaves))
}

/// Compute the SSZ Merkle branch from leaf at `leaf_index` in a 32-leaf tree (depth=5).
///
/// Returns 5 sibling hashes ordered from leaf level up to (but not including) root.
/// The branch lets a verifier recompute the root starting from `leaves[leaf_index]`.
pub fn merkle_branch_32(leaves: &[[u8; 32]; 32], leaf_index: usize) -> [[u8; 32]; 5] {
    let mut level: Vec<[u8; 32]> = leaves.to_vec();
    let mut branch = [[0u8; 32]; 5];
    let mut idx = leaf_index;

    for depth in 0..5 {
        let sibling = idx ^ 1; // flip lowest bit
        branch[depth] = level[sibling];

        // Hash pairs to compute the next level up
        let mut next = Vec::with_capacity(level.len() / 2);
        for i in (0..level.len()).step_by(2) {
            next.push(sha256_pair(level[i], level[i + 1]));
        }
        level = next;
        idx /= 2;
    }

    branch
}

/// SSZ `hash_tree_root` for `ByteVector[256]` (logs_bloom, 256 bytes = 8 × 32-byte chunks).
///
/// Builds a balanced Merkle tree over 8 chunks (next power of 2 = 8, depth=3).
fn ssz_bytes_vector_root(data: &[u8]) -> [u8; 32] {
    // 256 bytes → 8 chunks of 32 bytes (already a power of 2, no padding needed)
    let mut leaves: Vec<[u8; 32]> = Vec::with_capacity(8);
    for chunk in data.chunks(32) {
        let mut leaf = [0u8; 32];
        leaf[..chunk.len()].copy_from_slice(chunk);
        leaves.push(leaf);
    }
    merkle_root_vec(leaves)
}

/// SSZ `hash_tree_root` for `ByteList[max_length]` (variable-length byte list).
///
/// ByteList SSZ: `mix_in_length(chunk_root, length)` where:
///   - `chunk_root` = Merkle root of the data padded to `max_chunks` 32-byte chunks
///   - `mix_in_length` = sha256_pair(chunk_root, length_as_uint256_le)
fn ssz_byte_list_root(data: &[u8], max_chunks: usize) -> [u8; 32] {
    let tree_size = max_chunks.next_power_of_two();
    let mut leaves = vec![[0u8; 32]; tree_size];
    for (i, chunk) in data.chunks(32).enumerate() {
        if i < leaves.len() {
            leaves[i][..chunk.len()].copy_from_slice(chunk);
        }
    }
    let chunk_root = merkle_root_vec(leaves);
    // mix_in_length: append length as uint256 LE
    let mut len_leaf = [0u8; 32];
    len_leaf[..8].copy_from_slice(&(data.len() as u64).to_le_bytes());
    sha256_pair(chunk_root, len_leaf)
}

/// Iterative Merkle root computation for an arbitrary power-of-2 leaf array.
fn merkle_root_vec(mut level: Vec<[u8; 32]>) -> [u8; 32] {
    assert!(!level.is_empty() && level.len().is_power_of_two());
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len() / 2);
        for i in (0..level.len()).step_by(2) {
            next.push(sha256_pair(level[i], level[i + 1]));
        }
        level = next;
    }
    level[0]
}

// ── SHA-256 primitives ────────────────────────────────────────────────────────

/// SHA-256(left || right) — the fundamental SSZ Merkle hash.
pub fn sha256_pair(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(&left);
    h.update(&right);
    h.finalize().into()
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

fn parse_beacon_header(h: &BeaconHeaderJson) -> Result<BeaconBlockHeader> {
    Ok(BeaconBlockHeader {
        slot: h.slot.parse().context("parse slot")?,
        proposer_index: h.proposer_index.parse().context("parse proposer_index")?,
        parent_root: parse_bytes32(&h.parent_root).context("parse parent_root")?,
        state_root: parse_bytes32(&h.state_root).context("parse state_root")?,
        body_root: parse_bytes32(&h.body_root).context("parse body_root")?,
    })
}

fn parse_branch_6(nodes: &[String]) -> Result<[[u8; 32]; 6]> {
    if nodes.len() != 6 {
        anyhow::bail!("expected 6 branch nodes, got {}", nodes.len());
    }
    let mut arr = [[0u8; 32]; 6];
    for (i, s) in nodes.iter().enumerate() {
        arr[i] = parse_bytes32(s)?;
    }
    Ok(arr)
}

fn parse_branch_4(nodes: &[String]) -> Result<[[u8; 32]; 4]> {
    if nodes.len() != 4 {
        anyhow::bail!("expected 4 branch nodes, got {}", nodes.len());
    }
    let mut arr = [[0u8; 32]; 4];
    for (i, s) in nodes.iter().enumerate() {
        arr[i] = parse_bytes32(s)?;
    }
    Ok(arr)
}

fn parse_bytes32(s: &str) -> Result<[u8; 32]> {
    let bytes = hex_decode(s).with_context(|| format!("hex decode: {}", s))?;
    if bytes.len() != 32 {
        anyhow::bail!("expected 32 bytes, got {} (input: {})", bytes.len(), s);
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn parse_fork_version(s: &str) -> Result<[u8; 4]> {
    let bytes = hex_decode(s)?;
    if bytes.len() != 4 {
        anyhow::bail!("expected 4-byte fork version, got {} bytes", bytes.len());
    }
    let mut arr = [0u8; 4];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Parse a decimal or hex string as uint256 (little-endian 32 bytes).
///
/// The Beacon API sends `base_fee_per_gas` as a decimal string.
/// Small values fit in u128; for larger values we fall back to u64.
fn parse_uint256_le(s: &str) -> Result<[u8; 32]> {
    let mut arr = [0u8; 32];
    let s = s.trim();
    if s.starts_with("0x") || s.starts_with("0X") {
        // Hex big-endian → reverse to LE
        let b = hex_decode(s)?;
        let start = 32usize.saturating_sub(b.len());
        // Copy bytes as little-endian (reverse the big-endian hex bytes)
        for (i, byte) in b.iter().rev().enumerate() {
            if i < 32 { arr[i] = *byte; }
        }
        let _ = start;
    } else {
        // Decimal string → parse as u128 (sufficient for gas values)
        let v: u128 = s.parse().context("parse uint256 decimal")?;
        arr[..16].copy_from_slice(&v.to_le_bytes());
    }
    Ok(arr)
}

fn uint64_leaf(v: u64) -> [u8; 32] {
    let mut arr = [0u8; 32];
    arr[..8].copy_from_slice(&v.to_le_bytes());
    arr
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    let s = s.trim().trim_start_matches("0x").trim_start_matches("0X");
    if s.is_empty() {
        return Ok(vec![]);
    }
    hex::decode(s).context("hex decode failed")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_pair() {
        let left = [1u8; 32];
        let right = [2u8; 32];
        let result = sha256_pair(left, right);
        // Must be deterministic and non-zero
        assert_ne!(result, [0u8; 32]);
        assert_eq!(result, sha256_pair(left, right));
    }

    #[test]
    fn test_merkle_branch_32_roundtrip() {
        // Build 32 leaves, compute branch for leaf[12], verify it
        let mut leaves = [[0u8; 32]; 32];
        for (i, leaf) in leaves.iter_mut().enumerate() {
            leaf[0] = i as u8;
        }

        let root = merkle_root_vec(leaves.to_vec());
        let branch = merkle_branch_32(&leaves, 12);

        // Manually verify: start from leaf[12] and walk up using branch
        let mut value = leaves[12];
        let mut idx = 12usize;
        for (depth, &sibling) in branch.iter().enumerate() {
            if idx & 1 == 1 {
                value = sha256_pair(sibling, value);
            } else {
                value = sha256_pair(value, sibling);
            }
            idx >>= 1;
            let _ = depth;
        }
        assert_eq!(value, root, "branch roundtrip failed");
    }

    #[test]
    fn test_uint64_leaf() {
        let v = 12345678u64;
        let leaf = uint64_leaf(v);
        let recovered = u64::from_le_bytes(leaf[..8].try_into().unwrap());
        assert_eq!(recovered, v);
        assert_eq!(&leaf[8..], &[0u8; 24]);
    }

    #[test]
    fn test_ssz_byte_list_root_empty() {
        // Empty ByteList[32] should not panic
        let root = ssz_byte_list_root(&[], 1);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn test_parse_uint256_le_decimal() {
        let arr = parse_uint256_le("7").unwrap();
        assert_eq!(arr[0], 7);
        assert_eq!(&arr[1..], &[0u8; 31]);
    }
}
