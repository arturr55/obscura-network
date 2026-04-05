//! SP1 Sanctions Non-Membership Proof Circuit
//!
//! Proves in zero knowledge that a recipient address is NOT in the OFAC SDN
//! sanctions list, without revealing the recipient's address.
//!
//! ## Method: Sorted Merkle Tree Non-Membership Proof
//!
//! The OFAC oracle builds a sorted Merkle tree where each leaf is:
//!   `SHA256("leaf" || SHA256("addr" || sanctioned_address))`
//!
//! To prove address R is NOT sanctioned:
//! 1. Find two adjacent leaves L and Right in the sorted tree where:
//!    `L < SHA256("addr" || R) < Right`
//! 2. Provide Merkle inclusion proofs for both L and Right
//! 3. Verify L and Right are adjacent (right_index == left_index + 1)
//! 4. Therefore no leaf exists between L and Right → R is not sanctioned
//!
//! Edge cases (R smaller than all leaves, or larger) are handled with
//! sentinel leaves: all-zeros (minimum) and all-ones (maximum) at indices 0
//! and 2^depth-1, always present in the tree.
//!
//! ## Inputs / Outputs
//!
//! Private inputs (never revealed):
//!   recipient, left_leaf, right_leaf, left_proof, right_proof, left_index, right_index
//!
//! Public outputs (committed to proof):
//!   recipient_commitment, sanctions_root, is_clean, proof_timestamp

#![no_main]
sp1_zkvm::entrypoint!(main);

mod types_import {
    include!("../types.rs");
}
use types_import::*;

use sha2::{Digest, Sha256};

/// Hash a raw address to get its sorted-tree key.
/// Domain-separated to avoid collisions with leaf/node hashes.
fn hash_addr(addr: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"addr");
    h.update(addr);
    h.finalize().into()
}

/// Hash a leaf: SHA256("leaf" || addr_hash)
fn hash_leaf(addr_hash: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"leaf");
    h.update(addr_hash);
    h.finalize().into()
}

/// Hash an internal Merkle node: SHA256("node" || left || right)
fn hash_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"node");
    h.update(left);
    h.update(right);
    h.finalize().into()
}

/// Commitment to recipient: SHA256("recipient" || recipient)
/// Auditor can recompute this to confirm which address was checked.
fn recipient_commitment(addr: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"recipient");
    h.update(addr);
    h.finalize().into()
}

/// Verify Merkle inclusion proof for a leaf at `index`.
/// `proof` contains sibling hashes from leaf level up to (not including) root.
fn verify_merkle_proof(
    leaf_hash: [u8; 32],
    index: u64,
    proof: &[[u8; 32]],
    root: &[u8; 32],
    depth: u32,
) -> bool {
    if proof.len() != depth as usize {
        return false;
    }
    let mut current = leaf_hash;
    let mut idx = index;
    for sibling in proof {
        current = if idx % 2 == 0 {
            hash_node(&current, sibling)
        } else {
            hash_node(sibling, &current)
        };
        idx >>= 1;
    }
    &current == root
}

pub fn main() {
    let witness: SanctionsWitness = sp1_zkvm::io::read();

    // --- Constraint 1: adjacent leaves ---
    assert_eq!(
        witness.left_index + 1,
        witness.right_index,
        "left and right leaves must be adjacent (right_index = left_index + 1)"
    );

    // --- Constraint 2: recipient hash is strictly between the two leaves ---
    // This is the core non-membership argument.
    // If hash(R) is strictly between two adjacent leaves in a sorted tree,
    // then hash(R) cannot itself be a leaf.
    let addr_hash = hash_addr(&witness.recipient);
    assert!(
        witness.left_leaf < addr_hash,
        "recipient addr_hash must be strictly greater than left_leaf"
    );
    assert!(
        addr_hash < witness.right_leaf,
        "recipient addr_hash must be strictly less than right_leaf"
    );

    // --- Constraint 3: left_leaf is a valid member of the sanctions tree ---
    let left_leaf_hash = hash_leaf(&witness.left_leaf);
    assert!(
        verify_merkle_proof(
            left_leaf_hash,
            witness.left_index,
            &witness.left_proof,
            &witness.sanctions_root,
            witness.tree_depth,
        ),
        "left_leaf Merkle inclusion proof is invalid"
    );

    // --- Constraint 4: right_leaf is a valid member of the sanctions tree ---
    let right_leaf_hash = hash_leaf(&witness.right_leaf);
    assert!(
        verify_merkle_proof(
            right_leaf_hash,
            witness.right_index,
            &witness.right_proof,
            &witness.sanctions_root,
            witness.tree_depth,
        ),
        "right_leaf Merkle inclusion proof is invalid"
    );

    // --- Commit public outputs ---
    // is_clean = true because all constraints above passed
    let outputs = SanctionsPublicOutputs {
        recipient_commitment: recipient_commitment(&witness.recipient),
        sanctions_root: witness.sanctions_root,
        is_clean: true,
        proof_timestamp: witness.proof_timestamp,
    };
    sp1_zkvm::io::commit(&outputs);
}
