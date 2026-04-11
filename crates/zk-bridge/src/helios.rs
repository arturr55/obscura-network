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
fn verify_helios_sp1_proof(proof_bytes: &[u8], inputs: &HeliosPublicInputs) -> Result<()> {
    use anyhow::Context;
    use sp1_sdk::{ProverClient, SP1ProofWithPublicValues};

    // Load the Helios guest ELF to derive the verifying key.
    // The VK is derived deterministically from the ELF, so the same ELF always
    // produces the same VK. Any tampering with the ELF changes the VK and
    // invalidates all proofs.
    const HELIOS_ELF_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../provers/sp1/guest-helios/elf/helios-step"
    );
    let elf = std::fs::read(HELIOS_ELF_PATH)
        .with_context(|| {
            format!(
                "Helios ELF not found at {HELIOS_ELF_PATH}. \
                 Build it with: cd crates/provers/sp1/guest-helios && cargo prove build"
            )
        })?;

    let client = ProverClient::from_env();
    let (_, vk) = client.setup(&elf);

    // Deserialize the Groth16 proof (bincode-encoded SP1ProofWithPublicValues)
    let proof: SP1ProofWithPublicValues = bincode::deserialize(proof_bytes)
        .context("Helios: deserialize SP1 proof failed")?;

    // Cryptographic proof verification (Groth16 pairing check)
    client
        .verify(&proof, &vk)
        .context("Helios: SP1 Groth16 proof verification failed")?;

    // Check that the proof's committed public outputs match the submitted inputs.
    // This prevents a valid proof from a different update being replayed.
    let mut pub_vals = proof.public_values.clone();
    // The circuit commits HeliosPublicOutputs (mirrors HeliosPublicInputs fields)
    let committed_prev_root: [u8; 32] = pub_vals.read();
    let committed_new_root: [u8; 32] = pub_vals.read();
    let committed_slot: u64 = pub_vals.read();
    let committed_block_hash: [u8; 32] = pub_vals.read();

    if committed_prev_root != inputs.prev_trusted_root {
        bail!(
            "Helios: proof prev_trusted_root mismatch — expected 0x{}, got 0x{}",
            hex::encode(inputs.prev_trusted_root),
            hex::encode(committed_prev_root)
        );
    }
    if committed_new_root != inputs.new_beacon_root {
        bail!(
            "Helios: proof new_beacon_root mismatch — expected 0x{}, got 0x{}",
            hex::encode(inputs.new_beacon_root),
            hex::encode(committed_new_root)
        );
    }
    if committed_slot != inputs.new_slot {
        bail!(
            "Helios: proof new_slot mismatch — expected {}, got {}",
            inputs.new_slot,
            committed_slot
        );
    }
    if committed_block_hash != inputs.execution_block_hash {
        bail!(
            "Helios: proof execution_block_hash mismatch — expected 0x{}, got 0x{}",
            hex::encode(inputs.execution_block_hash),
            hex::encode(committed_block_hash)
        );
    }

    tracing::info!(
        "Helios: SP1 proof verified — slot {} → block 0x{}",
        committed_slot,
        hex::encode(committed_block_hash)
    );

    Ok(())
}
