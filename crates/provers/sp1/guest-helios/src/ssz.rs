/// SSZ (Simple Serialize) helpers for the Helios SP1 circuit.
///
/// Implements the subset of SSZ needed to:
///   - Compute hash_tree_root of BeaconBlockHeader
///   - Verify Merkle branch proofs (for finality and execution payload)
///   - Compute the signing domain for BLS verification
///
/// Reference: https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md

use sha2::{Digest, Sha256};
use crate::types::BeaconBlockHeader;

// ── SHA-256 primitives ────────────────────────────────────────────────────────

/// SHA-256 of arbitrary data.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}

/// SHA-256 of two 32-byte values concatenated.
/// This is the core operation for SSZ Merkle tree construction.
pub fn sha256_pair(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&left);
    data[32..].copy_from_slice(&right);
    sha256(&data)
}

// ── SSZ hash_tree_root ────────────────────────────────────────────────────────

/// Compute hash_tree_root of a BeaconBlockHeader.
///
/// BeaconBlockHeader has 5 fields → 5 leaves, padded to 8 (next power of 2):
///   leaf[0] = slot (uint64 LE padded to 32 bytes)
///   leaf[1] = proposer_index (uint64 LE padded to 32 bytes)
///   leaf[2] = parent_root (Bytes32)
///   leaf[3] = state_root (Bytes32)
///   leaf[4] = body_root (Bytes32)
///   leaf[5..7] = zero (padding)
pub fn hash_tree_root_beacon_header(h: &BeaconBlockHeader) -> [u8; 32] {
    let mut leaves = [[0u8; 32]; 8];
    // uint64 fields: little-endian, zero-padded to 32 bytes
    leaves[0][..8].copy_from_slice(&h.slot.to_le_bytes());
    leaves[1][..8].copy_from_slice(&h.proposer_index.to_le_bytes());
    // Bytes32 fields: direct copy
    leaves[2] = h.parent_root;
    leaves[3] = h.state_root;
    leaves[4] = h.body_root;
    // leaves[5..7] remain zero (SSZ padding)

    merkle_root_8(leaves)
}

/// Compute the Merkle root of exactly 8 leaves using SHA-256.
fn merkle_root_8(leaves: [[u8; 32]; 8]) -> [u8; 32] {
    // Level 2 → 4 nodes
    let n0 = sha256_pair(leaves[0], leaves[1]);
    let n1 = sha256_pair(leaves[2], leaves[3]);
    let n2 = sha256_pair(leaves[4], leaves[5]);
    let n3 = sha256_pair(leaves[6], leaves[7]);
    // Level 1 → 2 nodes
    let m0 = sha256_pair(n0, n1);
    let m1 = sha256_pair(n2, n3);
    // Level 0 → root
    sha256_pair(m0, m1)
}

/// Compute hash_tree_root of ForkData { current_version: Bytes4, genesis_validators_root: Bytes32 }.
///
/// ForkData has 2 fields → 2 leaves:
///   leaf[0] = current_version (4 bytes LE padded to 32)
///   leaf[1] = genesis_validators_root (Bytes32)
fn hash_tree_root_fork_data(fork_version: [u8; 4], genesis_validators_root: [u8; 32]) -> [u8; 32] {
    let mut leaf0 = [0u8; 32];
    leaf0[..4].copy_from_slice(&fork_version);
    sha256_pair(leaf0, genesis_validators_root)
}

// ── Domain computation ────────────────────────────────────────────────────────

/// Domain type for sync committee (from the Ethereum consensus specs).
/// Used to compute the signing root that the sync committee signed over.
pub const DOMAIN_SYNC_COMMITTEE: [u8; 4] = [0x07, 0x00, 0x00, 0x00];

/// Compute the BLS signing domain for a given fork version.
///
/// domain = domain_type (4 bytes) || fork_data_root[0..28]
/// where fork_data_root = hash_tree_root(ForkData { fork_version, genesis_validators_root })
pub fn compute_domain(
    domain_type: [u8; 4],
    fork_version: [u8; 4],
    genesis_validators_root: [u8; 32],
) -> [u8; 32] {
    let fork_data_root = hash_tree_root_fork_data(fork_version, genesis_validators_root);
    let mut domain = [0u8; 32];
    domain[..4].copy_from_slice(&domain_type);
    domain[4..].copy_from_slice(&fork_data_root[..28]);
    domain
}

/// Compute the signing root that the sync committee members signed over.
///
/// signing_root = hash_tree_root(SigningData { object_root: header_root, domain })
/// SigningData has 2 Bytes32 fields → hash_tree_root = sha256_pair(header_root, domain)
pub fn compute_signing_root(header_root: [u8; 32], domain: [u8; 32]) -> [u8; 32] {
    sha256_pair(header_root, domain)
}

// ── Merkle branch verification ────────────────────────────────────────────────

/// Verify a SSZ Merkle inclusion proof.
///
/// Proves that `leaf` is at position `leaf_index` (0-based, from left) in a
/// tree of depth `depth`, and that the root of that tree is `root`.
///
/// # Arguments
/// - `leaf`       — the leaf value (hash_tree_root of the field being proven)
/// - `branch`     — sibling hashes from the leaf level up to (but not including) root
///                  length must equal `depth`
/// - `depth`      — number of levels in the Merkle tree (depth=0 → root IS the leaf)
/// - `leaf_index` — 0-based position of the leaf in the bottom level
/// - `root`       — expected Merkle root
///
/// The algorithm: at each level i (0 = bottom, depth-1 = just below root):
///   if bit i of leaf_index is 1 → this node is a right child → branch[i] is on the left
///   if bit i of leaf_index is 0 → this node is a left child  → branch[i] is on the right
pub fn verify_merkle_branch(
    leaf: [u8; 32],
    branch: &[[u8; 32]],
    depth: usize,
    leaf_index: u64,
    root: [u8; 32],
) -> bool {
    if branch.len() != depth {
        return false;
    }
    let mut value = leaf;
    for (i, &sibling) in branch.iter().enumerate() {
        if (leaf_index >> i) & 1 == 1 {
            // This node is a right child — sibling is on the left
            value = sha256_pair(sibling, value);
        } else {
            // This node is a left child — sibling is on the right
            value = sha256_pair(value, sibling);
        }
    }
    value == root
}
