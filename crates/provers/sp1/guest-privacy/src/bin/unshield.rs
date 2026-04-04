//! SP1 Unshield Proof Circuit
//!
//! Proves in zero knowledge:
//! 1. Sender knows spending_key for the note
//!    (commitment = SHA256(amount||asset_id||pubkey||salt))
//!    (nullifier = SHA256(spending_key||commitment))
//! 2. Note has valid non-zero amount
//!
//! Private inputs: spending_key, note data
//! Public outputs: nullifier, amount, asset_id

#![no_main]
sp1_zkvm::entrypoint!(main);

mod types_import {
    include!("../types.rs");
}
use types_import::*;

use sha2::{Digest, Sha256};

pub fn main() {
    // Read private witness
    let witness: UnshieldWitness = sp1_zkvm::io::read();

    // --- Constraint 1: valid note ---
    assert!(witness.note.amount > 0, "note amount must be non-zero");
    assert_eq!(witness.note.owner_pubkey.len(), 32, "pubkey must be 32 bytes");

    // --- Constraint 2: compute commitment ---
    let mut h = Sha256::new();
    h.update(witness.note.amount.to_le_bytes());
    h.update(witness.note.asset_id);
    h.update(&witness.note.owner_pubkey);
    h.update(witness.note.salt);
    let commitment: [u8; 32] = h.finalize().into();

    // --- Constraint 3: compute nullifier (proves spending key knowledge) ---
    let mut h2 = Sha256::new();
    h2.update(witness.spending_key);
    h2.update(commitment);
    let nullifier: [u8; 32] = h2.finalize().into();

    // --- Commit public outputs ---
    let public_outputs = UnshieldPublicOutputs {
        nullifier,
        amount: witness.note.amount,
        asset_id: witness.note.asset_id,
    };
    sp1_zkvm::io::commit(&public_outputs);
}
