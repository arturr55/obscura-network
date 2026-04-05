// Shared types for SP1 privacy circuit guest programs.
// These types are used both inside the zkVM and in the host prover.

use serde::{Deserialize, Serialize};

/// Private witness for transfer proof.
/// These inputs are NOT revealed — they stay inside the zkVM.
#[derive(Serialize, Deserialize, Clone)]
pub struct TransferWitness {
    /// Spending key for each input note (32 bytes each, kept secret)
    pub spending_keys: Vec<[u8; 32]>,
    /// Input note data (private)
    pub inputs: Vec<NoteData>,
    /// Output note data (private)
    pub outputs: Vec<NoteData>,
    /// Merkle root at time of proof (public, verified on-chain)
    pub merkle_root: [u8; 32],
    /// Leaf index of each input note in the commitment tree.
    /// `leaf_indices[i]` is the position of `inputs[i]`'s commitment.
    pub leaf_indices: Vec<u64>,
    /// Merkle sibling paths proving each input note is in `merkle_root`.
    /// `merkle_paths[i]` has TREE_DEPTH elements (leaf→root siblings).
    pub merkle_paths: Vec<Vec<[u8; 32]>>,
}

/// Private witness for unshield proof.
#[derive(Serialize, Deserialize, Clone)]
pub struct UnshieldWitness {
    /// Spending key for the note being unshielded (secret)
    pub spending_key: [u8; 32],
    /// Note being unshielded (private)
    pub note: NoteData,
}

/// Private witness for compliance proof.
/// Proves total_volume = sum(amounts) AND total_volume <= limit
/// without revealing individual amounts.
#[derive(Serialize, Deserialize, Clone)]
pub struct ComplianceWitness {
    /// Individual transaction amounts (private)
    pub amounts: Vec<u64>,
    /// Regulatory limit (public)
    pub regulatory_limit: u64,
}

/// Note data used inside the zkVM.
#[derive(Serialize, Deserialize, Clone)]
pub struct NoteData {
    pub amount: u64,
    pub asset_id: [u8; 32],
    pub owner_pubkey: Vec<u8>,
    pub salt: [u8; 32],
}

/// Public outputs committed by the transfer proof.
#[derive(Serialize, Deserialize, Clone)]
pub struct TransferPublicOutputs {
    /// Nullifiers of spent input notes (revealed to prevent double-spend)
    pub nullifiers: Vec<[u8; 32]>,
    /// Commitments of new output notes
    pub output_commitments: Vec<[u8; 32]>,
    /// Total transfer amount (for compliance accounting)
    pub transfer_amount: u64,
    /// Asset being transferred
    pub asset_id: [u8; 32],
    /// Merkle root used in this proof
    pub merkle_root: [u8; 32],
}

/// Public outputs committed by the unshield proof.
#[derive(Serialize, Deserialize, Clone)]
pub struct UnshieldPublicOutputs {
    /// Nullifier of the spent note
    pub nullifier: [u8; 32],
    /// Amount being unshielded
    pub amount: u64,
    /// Asset ID
    pub asset_id: [u8; 32],
}

/// Public outputs committed by the compliance proof.
#[derive(Serialize, Deserialize, Clone)]
pub struct CompliancePublicOutputs {
    /// Total volume (sum of amounts)
    pub total_volume: u64,
    /// Regulatory limit (as provided)
    pub regulatory_limit: u64,
    /// Whether total_volume <= regulatory_limit
    pub within_limit: bool,
    /// Number of transactions counted
    pub tx_count: u32,
}

/// Private witness for sanctions non-membership proof.
///
/// Proves that `recipient` is NOT in the OFAC SDN sanctions list,
/// using a Sorted Merkle Tree non-membership proof:
/// - All sanctioned addresses are hashed and sorted as tree leaves
/// - Non-membership is proved by showing two adjacent leaves L < hash(R) < Right
/// - Both adjacent leaves are valid members of the tree
/// - Therefore hash(R) cannot exist between them
#[derive(Serialize, Deserialize, Clone)]
pub struct SanctionsWitness {
    /// Address being checked (private — never revealed)
    pub recipient: [u8; 32],
    /// OFAC SDN Merkle root (public — updated daily by oracle)
    pub sanctions_root: [u8; 32],
    /// Left adjacent leaf: sorted hash of a sanctioned address, left neighbour
    pub left_leaf: [u8; 32],
    /// Right adjacent leaf: sorted hash of a sanctioned address, right neighbour
    pub right_leaf: [u8; 32],
    /// Merkle proof path for left_leaf (sibling hashes, leaf→root)
    pub left_proof: Vec<[u8; 32]>,
    /// Merkle proof path for right_leaf (sibling hashes, leaf→root)
    pub right_proof: Vec<[u8; 32]>,
    /// Position (index) of left_leaf in the sorted tree
    pub left_index: u64,
    /// Position (index) of right_leaf in the sorted tree
    pub right_index: u64,
    /// Depth of the Merkle tree (proof length)
    pub tree_depth: u32,
    /// Unix timestamp of proof generation (informational, not verified)
    pub proof_timestamp: u64,
}

/// Public outputs committed by the sanctions non-membership proof.
#[derive(Serialize, Deserialize, Clone)]
pub struct SanctionsPublicOutputs {
    /// SHA256("recipient" || recipient) — proves the same address was checked
    /// without revealing it. Auditor can verify by hashing the address themselves.
    pub recipient_commitment: [u8; 32],
    /// OFAC Merkle root used in this proof
    pub sanctions_root: [u8; 32],
    /// True if recipient is clean (not sanctioned) — always true if proof is valid
    pub is_clean: bool,
    /// Unix timestamp when proof was generated
    pub proof_timestamp: u64,
}
