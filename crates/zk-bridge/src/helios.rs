/// Helios proof verifier for the Obscura bridge module (host side).
///
/// Phase 1 (testnet): accepts mock Helios proofs prefixed with `b"OBShelios"`.
/// Phase 2 (mainnet): verifies real SP1 Groth16 proofs from the helios_step circuit.
///
/// The Helios proof advances the trusted beacon root stored in the rollup:
///   prev_trusted_root → new_beacon_root  (via sync committee + finality branch)
///
/// After verification, the `execution_block_hash` from the proof is added to
/// the rollup's `finalized_eth_blocks` set, allowing bridge deposits to be
/// accepted from that execution block without trusting the relayer.

use anyhow::{bail, Result};
use crate::helios_types::HeliosPublicInputs;

/// Mock proof prefix for testnet (no real ZK computation).
pub const MOCK_HELIOS_PREFIX: &[u8] = b"OBShelios";

/// SP1 ELF verifying key hash for the helios_step circuit.
/// Regenerate after compiling: `cargo prove build` in crates/provers/sp1/guest-helios/
pub const HELIOS_VK_HASH: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

/// Verify a Helios SP1 proof.
///
/// In mock mode: accepts any proof starting with `MOCK_HELIOS_PREFIX`.
/// In native mode: verifies the SP1 Groth16 proof against public inputs.
///
/// # Arguments
/// - `proof`  — raw proof bytes (mock prefix or real Groth16/Plonk)
/// - `inputs` — public inputs that the circuit committed to
pub fn verify_helios_proof(proof: &[u8], inputs: &HeliosPublicInputs) -> Result<()> {
    if proof.starts_with(MOCK_HELIOS_PREFIX) {
        tracing::debug!(
            "Helios: accepted mock proof for slot {} → block 0x{}",
            inputs.new_slot,
            hex::encode(inputs.execution_block_hash)
        );
        return Ok(());
    }

    #[cfg(feature = "native")]
    {
        verify_helios_sp1_proof(proof, inputs)?;
        return Ok(());
    }

    #[cfg(not(feature = "native"))]
    {
        bail!(
            "Helios: real proof submitted but SP1 verification not compiled in \
             (missing --features native). Use mock proof for testnet."
        );
    }
}

#[cfg(feature = "native")]
fn verify_helios_sp1_proof(_proof: &[u8], _inputs: &HeliosPublicInputs) -> Result<()> {
    // Phase 2: implement real SP1 Groth16 verification.
    //
    // Steps:
    //   1. Load ELF: include_bytes!("../../provers/sp1/guest-helios/elf/helios-step")
    //   2. Build ProverClient: sp1_sdk::ProverClient::builder().network().build()
    //   3. Deserialize proof from bytes (Groth16Proof)
    //   4. Verify: client.verify(&proof, &vk)
    //   5. Check public values match `inputs`
    bail!("Helios: real SP1 verification not yet implemented (Phase 2 feature).")
}
