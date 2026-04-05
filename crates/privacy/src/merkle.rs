//! Incremental Merkle Tree for the Obscura shielded pool.
//!
//! Append-only binary tree, depth=20 (supports up to 2^20 = 1,048,576 notes).
//! Uses SHA-256 for node hashing, matching the SP1 guest circuits.
//!
//! ## How it works
//!
//! - Leaves are note commitments, appended in order.
//! - Each insertion updates O(depth) nodes and the root.
//! - The tree stores `filled_subtrees[level]` — the rightmost fully-filled
//!   subtree at each level. This allows O(depth) insertion with O(depth) storage.
//! - Historical roots are kept (last 100) so that ZK proofs generated slightly
//!   before the latest insertion are still valid.
//!
//! ## Off-chain proof generation
//!
//! To generate an inclusion proof for leaf at index `i`, the prover (sequencer
//! or client) must:
//!   1. Fetch all commitments via the node REST API.
//!   2. Rebuild the full tree locally.
//!   3. Extract the Merkle path (siblings from leaf to root).
//!   4. Feed the path into the SP1 Transfer circuit as witness.

use sha2::{Digest, Sha256};

/// Fixed tree depth. Supports 2^20 = 1,048,576 notes.
pub const TREE_DEPTH: usize = 20;

/// How many historical roots to keep. Proofs generated within this window
/// remain valid even after new leaves are added.
pub const ROOTS_HISTORY_SIZE: u64 = 100;

// ── Hash helpers ──────────────────────────────────────────────────────────────

/// Hash two 32-byte nodes into one: SHA256(left ‖ right).
pub fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(left);
    h.update(right);
    h.finalize().into()
}

/// Zero value at a given level.
///
/// - Level 0: SHA256([0u8; 32])   (empty leaf)
/// - Level k: SHA256(zeros[k-1] ‖ zeros[k-1])
///
/// These are deterministic and the same in the SP1 circuit.
pub fn zero_value(level: usize) -> [u8; 32] {
    let mut current = [0u8; 32];
    for _ in 0..level {
        current = hash_pair(&current, &current);
    }
    current
}

/// The initial root of an empty tree of `TREE_DEPTH`.
pub fn empty_root() -> [u8; 32] {
    zero_value(TREE_DEPTH)
}

// ── Inclusion proof ───────────────────────────────────────────────────────────

/// Merkle inclusion proof: siblings on the path from leaf to root.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MerkleProof {
    /// 0-indexed position of the leaf in the tree.
    pub leaf_index: u64,
    /// Sibling hashes from level 0 (leaf level) up to level TREE_DEPTH-1.
    pub siblings: Vec<[u8; 32]>,
    /// The root this proof is against.
    pub root: [u8; 32],
}

impl MerkleProof {
    /// Verify the proof for the given `leaf` hash.
    pub fn verify(&self, leaf: [u8; 32]) -> bool {
        if self.siblings.len() != TREE_DEPTH {
            return false;
        }
        let mut current = leaf;
        let mut index = self.leaf_index;
        for sibling in &self.siblings {
            if index & 1 == 0 {
                // leaf is left child
                current = hash_pair(&current, sibling);
            } else {
                // leaf is right child
                current = hash_pair(sibling, &current);
            }
            index >>= 1;
        }
        current == self.root
    }
}

// ── Tree state helpers ────────────────────────────────────────────────────────

/// Compute the new root and updated filled_subtrees after inserting `leaf`
/// at position `next_index`.
///
/// `filled_subtrees[level]` is the value returned by `get_filled(level)`.
///
/// Returns: `(new_root, [(level, new_filled_value), ...])` — the updates to
/// persist in state.
pub fn compute_insert(
    leaf: [u8; 32],
    next_index: u64,
    mut get_filled: impl FnMut(usize) -> [u8; 32],
) -> ([u8; 32], Vec<(usize, [u8; 32])>) {
    let mut current = leaf;
    let mut index = next_index;
    let mut updates: Vec<(usize, [u8; 32])> = Vec::with_capacity(TREE_DEPTH);

    for level in 0..TREE_DEPTH {
        if index & 1 == 0 {
            // We are the left child — pair with zero on the right.
            // This level's filled subtree becomes `current`.
            updates.push((level, current));
            current = hash_pair(&current, &zero_value(level));
        } else {
            // We are the right child — pair with the stored left sibling.
            let left = get_filled(level);
            // filled_subtree at this level doesn't change (still the left sibling).
            current = hash_pair(&left, &current);
        }
        index >>= 1;
    }

    (current, updates)
}

/// Rebuild the full tree from a flat list of leaves and return all sibling
/// paths. Used off-chain by the prover to generate inclusion proofs.
///
/// Returns `Vec<Vec<[u8;32]>>` — `paths[i]` is the sibling list for leaf `i`.
pub fn build_proof_paths(leaves: &[[u8; 32]]) -> Vec<Vec<[u8; 32]>> {
    let size = 1usize << TREE_DEPTH;
    let mut nodes: Vec<[u8; 32]> = vec![[0u8; 32]; 2 * size];

    // Fill leaf level
    for (i, leaf) in leaves.iter().enumerate() {
        nodes[size + i] = *leaf;
    }
    // Fill empty leaves with zero values
    let zero_leaf = zero_value(0);
    for i in leaves.len()..size {
        nodes[size + i] = zero_leaf;
    }

    // Build up
    for level in (1..size).rev() {
        let left = nodes[2 * level];
        let right = nodes[2 * level + 1];
        nodes[level] = hash_pair(&left, &right);
    }

    // Extract sibling paths
    let mut paths = Vec::with_capacity(leaves.len());
    for i in 0..leaves.len() {
        let mut siblings = Vec::with_capacity(TREE_DEPTH);
        let mut pos = size + i;
        for _ in 0..TREE_DEPTH {
            let sibling = if pos & 1 == 0 { nodes[pos + 1] } else { nodes[pos - 1] };
            siblings.push(sibling);
            pos >>= 1;
        }
        paths.push(siblings);
    }
    paths
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tree_root_is_deterministic() {
        let r1 = empty_root();
        let r2 = empty_root();
        assert_eq!(r1, r2);
        // Must not be all-zeros
        assert_ne!(r1, [0u8; 32]);
    }

    #[test]
    fn single_leaf_insert() {
        let leaf = [1u8; 32];
        let (root, updates) = compute_insert(leaf, 0, |level| zero_value(level));
        // Root must be different from empty root
        assert_ne!(root, empty_root());
        // All TREE_DEPTH levels updated (leaf at index 0 is always left child at every level)
        assert_eq!(updates.len(), TREE_DEPTH);
    }

    #[test]
    fn two_leaves_deterministic() {
        let leaf0 = [1u8; 32];
        let leaf1 = [2u8; 32];

        // Insert leaf0
        let (_, updates0) = compute_insert(leaf0, 0, |level| zero_value(level));
        let mut filled: Vec<[u8; 32]> = vec![[0u8; 32]; TREE_DEPTH];
        for (level, val) in &updates0 {
            filled[*level] = *val;
        }

        // Insert leaf1
        let (root1, _) = compute_insert(leaf1, 1, |level| filled[level]);

        // Build via build_proof_paths
        let leaves = vec![leaf0, leaf1];
        let paths = build_proof_paths(&leaves);

        // Verify proof for leaf0
        let proof0 = MerkleProof {
            leaf_index: 0,
            siblings: paths[0].clone(),
            root: root1,
        };
        assert!(proof0.verify(leaf0), "Proof for leaf0 failed");

        // Verify proof for leaf1
        let proof1 = MerkleProof {
            leaf_index: 1,
            siblings: paths[1].clone(),
            root: root1,
        };
        assert!(proof1.verify(leaf1), "Proof for leaf1 failed");
    }

    #[test]
    fn invalid_proof_rejected() {
        let leaf = [42u8; 32];
        let wrong_leaf = [99u8; 32];
        let leaves = vec![leaf];
        let paths = build_proof_paths(&leaves);

        let (root, _) = compute_insert(leaf, 0, |l| zero_value(l));

        let proof = MerkleProof {
            leaf_index: 0,
            siblings: paths[0].clone(),
            root,
        };
        // Correct leaf → valid
        assert!(proof.verify(leaf));
        // Wrong leaf → invalid
        assert!(!proof.verify(wrong_leaf));
    }

    #[test]
    fn compute_insert_matches_build_proof_paths() {
        // Insert 4 leaves incrementally and compare root with build_proof_paths
        let leaves: Vec<[u8; 32]> = (0u8..4).map(|i| [i; 32]).collect();
        let mut filled: Vec<[u8; 32]> = (0..TREE_DEPTH).map(|l| zero_value(l)).collect();
        let mut last_root = [0u8; 32];

        for (i, &leaf) in leaves.iter().enumerate() {
            let (root, updates) =
                compute_insert(leaf, i as u64, |level| filled[level]);
            for (level, val) in updates {
                filled[level] = val;
            }
            last_root = root;
        }

        // Cross-check with full rebuild
        let paths = build_proof_paths(&leaves);
        // Pick any leaf and verify its proof against last_root
        for (i, &leaf) in leaves.iter().enumerate() {
            let proof = MerkleProof {
                leaf_index: i as u64,
                siblings: paths[i].clone(),
                root: last_root,
            };
            assert!(proof.verify(leaf), "Leaf {} failed verification", i);
        }
    }
}
