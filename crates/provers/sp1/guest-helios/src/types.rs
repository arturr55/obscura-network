/// Types for the Obscura Helios SP1 circuit.
///
/// This circuit proves one Ethereum beacon chain light client step:
/// given a trusted beacon root (from the sync committee), it proves
/// that a new block is finalized and extracts the execution block hash.
///
/// Phase 1 (testnet): BLS signature check is mocked (non-zero check only).
/// Phase 2 (mainnet): Real BLS12-381 pairing via SP1 precompile.

use serde::{Deserialize, Serialize};

/// A beacon block header (Ethereum consensus layer).
/// SSZ fields in order: slot, proposer_index, parent_root, state_root, body_root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconBlockHeader {
    pub slot: u64,
    pub proposer_index: u64,
    pub parent_root: [u8; 32],
    pub state_root: [u8; 32],
    pub body_root: [u8; 32],
}

/// Full witness for one Helios light client step.
///
/// Proves that `execution_block_hash` was finalized by the Ethereum beacon chain,
/// given the previously trusted beacon root `prev_trusted_root`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeliosWitness {
    // ── Trusted input (must match rollup state) ───────────────────────────────
    /// The current trusted finalized beacon root stored in the Obscura rollup.
    /// The circuit output `prev_trusted_root` will equal this value,
    /// allowing the rollup to verify the chain of Helios updates.
    pub prev_trusted_root: [u8; 32],

    // ── Ethereum beacon chain update ──────────────────────────────────────────
    /// The header that the sync committee signed (attested to).
    /// Its state_root contains the finalized checkpoint.
    pub attested_header: BeaconBlockHeader,

    /// The finalized header (proven via finality_branch in attested_header.state_root).
    /// Its hash_tree_root becomes the new trusted beacon root.
    pub finalized_header: BeaconBlockHeader,

    /// SSZ Merkle proof: finalized_header_root is in attested_header.state_root.
    /// Depth = 6 (FINALIZED_ROOT_DEPTH), leaf index = 41 (FINALIZED_ROOT_GINDEX=105, 105-64=41).
    /// Nodes ordered from leaf level up to root.
    pub finality_branch: [[u8; 32]; 6],

    // ── Sync committee signature ──────────────────────────────────────────────
    /// Number of sync committee members that participated (out of 512).
    /// Must be >= 341 (2/3 supermajority) for the update to be valid.
    pub sync_committee_participation: u16,

    /// BLS12-381 G2 aggregate signature (96 bytes).
    /// Signature over signing_root = hash_tree_root(SigningData { attested_header_root, domain }).
    /// Phase 1 (mock): checked to be non-zero only.
    /// Phase 2 (real): verified via BLS12-381 pairing.
    pub sync_aggregate_signature: [u8; 96],

    /// BLS12-381 G1 aggregate public key of the current sync committee (48 bytes).
    /// Must match rollup's stored trusted_sync_committee_pubkey_hash.
    pub sync_committee_pubkey: [u8; 48],

    /// Ethereum network fork version (4 bytes).
    /// Mainnet Deneb: 0x04000000, Sepolia Deneb: 0x90000073.
    pub fork_version: [u8; 4],

    /// Genesis validators root — unique per chain, used in domain computation.
    /// Mainnet: 0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95.
    pub genesis_validators_root: [u8; 32],

    // ── Execution payload extraction ──────────────────────────────────────────
    /// Root of the execution_payload within the finalized beacon block body.
    /// Intermediate value linking body_root to execution_block_hash.
    pub execution_payload_root: [u8; 32],

    /// SSZ Merkle proof: execution_payload_root is in finalized_header.body_root.
    /// Depth = 4 (log2(16) for BeaconBlockBody with 12 fields padded to 16).
    /// Leaf index = 9 (execution_payload is field 9 in BeaconBlockBody).
    pub body_to_exec_branch: [[u8; 32]; 4],

    /// The Ethereum execution block hash (keccak256 of the execution block header).
    /// This is the key output: it identifies which ETH block is now proven finalized.
    pub execution_block_hash: [u8; 32],

    /// SSZ Merkle proof: execution_block_hash is in execution_payload_root.
    /// Depth = 5 (log2(32) for ExecutionPayload with 17 fields padded to 32).
    /// Leaf index = 12 (block_hash is field 12 in ExecutionPayload, Deneb).
    pub exec_to_hash_branch: [[u8; 32]; 5],
}

/// Public outputs committed by the Helios ZK circuit.
/// Stored in the Obscura rollup state and verified on-chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeliosPublicOutputs {
    /// The previous trusted beacon root (chain link — must match rollup state).
    /// The rollup verifies this matches its current `trusted_beacon_root`.
    pub prev_trusted_root: [u8; 32],

    /// The new finalized beacon root (= hash_tree_root(finalized_header)).
    /// The rollup updates its `trusted_beacon_root` to this value.
    pub new_beacon_root: [u8; 32],

    /// The slot number of the newly finalized beacon block.
    pub new_slot: u64,

    /// The Ethereum execution block hash proven to be finalized.
    /// The rollup adds this to its `finalized_eth_blocks` set.
    /// The bridge then accepts deposits proven in this execution block.
    pub execution_block_hash: [u8; 32],
}
