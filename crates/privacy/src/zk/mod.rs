//! ZK proof verification for Obscura Network.
//!
//! In Phase 1 (testnet), proofs are verified using a mock verifier.
//! In Phase 2, this will be replaced with SP1 (Succinct Prover Network)
//! or Risc0 groth16 proofs verified on-chain.
//!
//! ## Proof System Design
//!
//! ### Transfer Proof
//! Proves (in zero knowledge):
//! - Sender knows spending_key for each input note
//! - sum(input amounts) == sum(output amounts)  [no inflation]
//! - Each input commitment exists in the Merkle tree
//! - Each input nullifier = SHA256(spending_key || commitment)
//!
//! ### Unshield Proof
//! Proves (in zero knowledge):
//! - Sender knows spending_key for the note
//! - commitment = SHA256(amount || asset_id || pubkey || salt)
//! - nullifier = SHA256(spending_key || commitment)
//!
//! ### Compliance Proof
//! Proves (in zero knowledge):
//! - total_volume is the correct sum of all shielded transfers
//! - total_volume <= regulatory_limit
//! Without revealing individual transaction amounts.

use anyhow::{bail, Result};

use crate::TransferPublicInputs;
use crate::UnshieldPublicInputs;

/// Verify a transfer proof.
///
/// Phase 1: Mock verifier (always passes if proof is non-empty).
/// Phase 2: SP1/Groth16 on-chain verification.
pub fn verify_transfer_proof(proof: &[u8], _public_inputs: &TransferPublicInputs) -> Result<()> {
    if proof.is_empty() {
        bail!("Transfer proof cannot be empty");
    }

    // Phase 1: accept any non-empty proof marked as valid
    // The proof must start with OBSCURA_PROOF_V1 magic bytes
    if proof.len() < 4 || &proof[0..4] != b"OBSv" {
        bail!("Invalid proof format: missing OBSCURA proof header");
    }

    // TODO Phase 2: replace with SP1 proof verification
    // sp1_sdk::verify_proof(TRANSFER_CIRCUIT_VK, proof, public_inputs)?;

    Ok(())
}

/// Verify an unshield proof.
pub fn verify_unshield_proof(proof: &[u8], _public_inputs: &UnshieldPublicInputs) -> Result<()> {
    if proof.is_empty() {
        bail!("Unshield proof cannot be empty");
    }

    if proof.len() < 4 || &proof[0..4] != b"OBSv" {
        bail!("Invalid proof format: missing OBSCURA proof header");
    }

    // TODO Phase 2: replace with SP1 proof verification

    Ok(())
}

/// Generate a mock proof for testing (Phase 1 only).
/// Phase 2: this will be computed by the SP1 prover.
pub fn mock_proof(payload: &[u8]) -> Vec<u8> {
    let mut proof = b"OBSv".to_vec();
    proof.extend_from_slice(payload);
    proof
}
