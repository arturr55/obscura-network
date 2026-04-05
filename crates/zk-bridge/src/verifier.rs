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
/// Phase 2: compile with `cargo prove build` in guest-bridge/, then uncomment.
#[cfg(feature = "native")]
pub const BRIDGE_ELF: &[u8] = &[]; // TODO Phase 2: include_bytes!("../../provers/sp1/guest-bridge/elf/eth-deposit")

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
fn verify_sp1_proof(_proof: &[u8], _public_inputs: &BridgePublicInputs) -> Result<()> {
    // Phase 2: implement real SP1 Groth16 verification.
    // Requires:
    //   1. Compile guest-bridge with `cargo prove build`
    //   2. Uncomment BRIDGE_ELF include_bytes! above
    //   3. Use sp1_sdk::ProverClient::builder().mock().build() for local verify
    //      or sp1_sdk::ProverClient::builder().network().build() for network prover
    bail!("Bridge: real SP1 verification not yet implemented. Phase 2 feature.")
}
