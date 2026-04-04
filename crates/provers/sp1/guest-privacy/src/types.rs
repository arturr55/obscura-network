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
