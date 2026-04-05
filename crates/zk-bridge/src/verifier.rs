/// ZK Proof verifier for the Obscura bridge.
///
/// Phase 1 (testnet): mock verification — accepts proof bytes starting with "OBSbridge"
/// Phase 2 (mainnet): SP1 Groth16 verification using the compiled ELF verifying key
///
/// The module is feature-gated: `native` feature enables real SP1 verification.

use anyhow::{bail, Result};
use crate::types::BridgePublicInputs;

/// SP1 verifying key hash for the eth_deposit circuit.
/// Must be regenerated after compiling the SP1 guest.
/// Run: `cargo run -p obscura-zk-bridge --bin gen_bridge_vkey --features native`
pub const BRIDGE_VK_HASH: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

/// ELF bytes of the compiled SP1 bridge guest circuit.
/// Only included when building with `native` feature.
#[cfg(feature = "native")]
pub const BRIDGE_ELF: &[u8] =
    include_bytes!("../../provers/sp1/guest-bridge/elf/eth-deposit");

/// Mock proof prefix used on testnet (no real ZK computation).
pub const MOCK_PROOF_PREFIX: &[u8] = b"OBSbridge";

/// Verify a bridge ZK proof against the public inputs.
///
/// In mock mode: accepts any proof starting with MOCK_PROOF_PREFIX.
/// In native mode: performs real SP1 Groth16 verification.
pub fn verify_bridge_proof(proof: &[u8], public_inputs: &BridgePublicInputs) -> Result<()> {
    if proof.starts_with(MOCK_PROOF_PREFIX) {
        // Testnet: accept mock proofs
        tracing::debug!("Bridge: accepted mock proof for deposit {}", public_inputs.deposit_id);
        return Ok(());
    }

    #[cfg(feature = "native")]
    {
        verify_sp1_proof(proof, public_inputs)?;
        return Ok(());
    }

    #[cfg(not(feature = "native"))]
    {
        bail!("Bridge: real proof submitted but sp1 verification not compiled in (missing --features native)");
    }
}

#[cfg(feature = "native")]
fn verify_sp1_proof(proof: &[u8], public_inputs: &BridgePublicInputs) -> Result<()> {
    use sp1_sdk::{ProverClient, SP1VerifyingKey, SP1Proof};

    // Deserialize the SP1 compressed proof
    let sp1_proof: SP1Proof = bincode::deserialize(proof)
        .map_err(|e| anyhow::anyhow!("Bridge: failed to deserialize SP1 proof: {e}"))?;

    // Load verifying key from the compiled ELF
    let client = ProverClient::new();
    let (_pk, vk) = client.setup(BRIDGE_ELF);

    // Build expected public values: serialize BridgePublicInputs
    let expected_pub_vals = borsh::to_vec(public_inputs)
        .map_err(|e| anyhow::anyhow!("Bridge: failed to serialize public inputs: {e}"))?;

    // Verify the proof
    client.verify(&sp1_proof, &vk)
        .map_err(|e| anyhow::anyhow!("Bridge: SP1 proof verification failed: {e}"))?;

    // Check public values match
    let committed = sp1_proof.public_values.as_slice();
    if committed != expected_pub_vals.as_slice() {
        bail!("Bridge: public values mismatch — committed {:?} != expected {:?}",
              &committed[..committed.len().min(32)],
              &expected_pub_vals[..expected_pub_vals.len().min(32)]);
    }

    Ok(())
}
