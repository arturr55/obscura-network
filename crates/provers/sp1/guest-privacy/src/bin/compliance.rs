//! SP1 Compliance Proof Circuit
//!
//! Proves in zero knowledge:
//! 1. total_volume = sum(amounts)   [correct aggregation]
//! 2. total_volume <= regulatory_limit   [within compliance]
//!
//! This allows auditors to verify compliance WITHOUT seeing individual amounts.
//!
//! Private inputs: individual transaction amounts
//! Public outputs: total_volume, regulatory_limit, within_limit, tx_count

#![no_main]
sp1_zkvm::entrypoint!(main);

mod types_import {
    include!("../types.rs");
}
use types_import::*;

pub fn main() {
    // Read private witness
    let witness: ComplianceWitness = sp1_zkvm::io::read();

    // --- Constraint 1: compute total volume ---
    let total_volume: u64 = witness
        .amounts
        .iter()
        .fold(0u64, |acc, &a| acc.checked_add(a).expect("volume overflow"));

    // --- Constraint 2: check regulatory limit ---
    let within_limit = total_volume <= witness.regulatory_limit;

    // --- Commit public outputs ---
    let public_outputs = CompliancePublicOutputs {
        total_volume,
        regulatory_limit: witness.regulatory_limit,
        within_limit,
        tx_count: witness.amounts.len() as u32,
    };
    sp1_zkvm::io::commit(&public_outputs);
}
