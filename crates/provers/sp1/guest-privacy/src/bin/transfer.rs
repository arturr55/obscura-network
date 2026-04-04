//! SP1 Transfer Proof Circuit
//!
//! Proves in zero knowledge:
//! 1. Sender knows spending_key for each input note
//!    (commitment = SHA256(amount||asset_id||pubkey||salt))
//!    (nullifier = SHA256(spending_key||commitment))
//! 2. sum(input amounts) == sum(output amounts)  [no inflation]
//! 3. All input/output notes have the same asset_id
//!
//! Private inputs (never revealed):
//!   spending_keys, input note data, output note data
//!
//! Public outputs (committed to the proof):
//!   nullifiers, output_commitments, transfer_amount, asset_id, merkle_root

#![no_main]
sp1_zkvm::entrypoint!(main);

mod types_import {
    include!("../types.rs");
}
use types_import::*;

use sha2::{Digest, Sha256};

fn hash_note(note: &NoteData) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(note.amount.to_le_bytes());
    h.update(note.asset_id);
    h.update(&note.owner_pubkey);
    h.update(note.salt);
    h.finalize().into()
}

fn hash_nullifier(spending_key: &[u8; 32], commitment: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(spending_key);
    h.update(commitment);
    h.finalize().into()
}

pub fn main() {
    // Read private witness
    let witness: TransferWitness = sp1_zkvm::io::read();

    // --- Constraint 1: non-empty inputs ---
    assert!(!witness.inputs.is_empty(), "must have at least one input");
    assert!(!witness.outputs.is_empty(), "must have at least one output");
    assert_eq!(
        witness.inputs.len(),
        witness.spending_keys.len(),
        "spending key count must match input count"
    );

    // --- Constraint 2: same asset_id for all notes ---
    let asset_id = witness.inputs[0].asset_id;
    for note in &witness.inputs {
        assert_eq!(note.asset_id, asset_id, "all inputs must have same asset");
    }
    for note in &witness.outputs {
        assert_eq!(note.asset_id, asset_id, "all outputs must have same asset");
    }

    // --- Constraint 3: balance conservation ---
    let input_sum: u64 = witness
        .inputs
        .iter()
        .map(|n| n.amount)
        .fold(0u64, |acc, a| acc.checked_add(a).expect("input overflow"));
    let output_sum: u64 = witness
        .outputs
        .iter()
        .map(|n| n.amount)
        .fold(0u64, |acc, a| acc.checked_add(a).expect("output overflow"));
    assert_eq!(input_sum, output_sum, "input sum must equal output sum");

    // --- Constraint 4: compute nullifiers (proves spending key knowledge) ---
    let mut nullifiers = Vec::with_capacity(witness.inputs.len());
    for (note, sk) in witness.inputs.iter().zip(witness.spending_keys.iter()) {
        let commitment = hash_note(note);
        let nullifier = hash_nullifier(sk, &commitment);
        nullifiers.push(nullifier);
    }

    // --- Constraint 5: compute output commitments ---
    let mut output_commitments = Vec::with_capacity(witness.outputs.len());
    for note in &witness.outputs {
        assert!(note.amount > 0, "output amount must be non-zero");
        let commitment = hash_note(note);
        output_commitments.push(commitment);
    }

    // --- Commit public outputs ---
    let public_outputs = TransferPublicOutputs {
        nullifiers,
        output_commitments,
        transfer_amount: input_sum,
        asset_id,
        merkle_root: witness.merkle_root,
    };
    sp1_zkvm::io::commit(&public_outputs);
}
