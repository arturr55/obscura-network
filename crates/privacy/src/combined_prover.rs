//! Combined Proof host prover — Transfer + Sanctions → one Groth16 proof.
//!
//! This module generates the combined aggregated proof by:
//!   1. Proving Transfer in SP1 COMPRESSED mode (aggregatable sub-proof)
//!   2. Proving Sanctions in SP1 COMPRESSED mode
//!   3. Running the aggregator circuit with both proofs → final Groth16
//!
//! Requires `sp1` feature.
//!
//! # Cost model
//!
//! | Approach             | Succinct Network calls | On-chain verifications |
//! |----------------------|------------------------|------------------------|
//! | Separate proofs      | 2 Groth16              | 2                      |
//! | Combined (this file) | 2 Compressed + 1 Groth16 | 1                    |
//!
//! Compressed proofs are ~10x cheaper than Groth16 on the Succinct Network.
//! Savings: (2×Groth16) vs (2×Compressed + 1×Groth16) ≈ 60% cost reduction.
//!
//! # Usage
//!
//! ```rust,ignore
//! use obscura_privacy::combined_prover::prove_transfer_with_sanctions;
//!
//! let proof_bytes = prove_transfer_with_sanctions(
//!     transfer_witness,
//!     sanctions_witness,
//! )?;
//!
//! // The rollup verifies this single proof via verify_combined_proof()
//! ```

use anyhow::Result;

// ── ELF paths ─────────────────────────────────────────────────────────────────
//
// These ELFs must be compiled before use:
//   cargo prove build   (in crates/provers/sp1/guest-privacy/)
//   cargo prove build   (in crates/provers/sp1/guest-combined/)
//
// The combined circuit ELF path:

const COMBINED_ELF_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../provers/sp1/guest-combined/elf/transfer-sanctions"
);

// The sub-circuit ELFs (needed to derive VKs for the aggregator stdin):
const TRANSFER_ELF_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../provers/sp1/guest-privacy/target/elf-compilation/",
    "riscv64im-succinct-zkvm-elf/release/transfer"
);
const SANCTIONS_ELF_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../provers/sp1/guest-privacy/target/elf-compilation/",
    "riscv64im-succinct-zkvm-elf/release/sanctions"
);

// ── Public witness types (re-exported from sp1_prover for convenience) ────────

#[cfg(feature = "sp1")]
pub use crate::sp1_prover::{TransferWitness, SanctionsWitness};

// ── Combined proof generation ─────────────────────────────────────────────────

/// Generate a combined Transfer + Sanctions Groth16 proof.
///
/// The two sub-proofs are generated in COMPRESSED mode (cheap, aggregatable),
/// then recursively verified by the aggregator circuit which outputs one
/// Groth16 proof suitable for on-chain verification.
///
/// # Arguments
///
/// - `transfer_witness` — private inputs for the Transfer circuit
/// - `sanctions_witness` — private inputs for the Sanctions circuit
///
/// # Returns
///
/// Serialized `SP1ProofWithPublicValues` (bincode) containing the combined
/// Groth16 proof and `CombinedPublicOutputs` as public values.
///
/// # Environment
///
/// Set `SP1_PROVER=network` and `SP1_PRIVATE_KEY=0x...` for cloud proving.
/// Set `SP1_PROVER=cpu` for local proving (slow, for development).
#[cfg(feature = "sp1")]
pub fn prove_transfer_with_sanctions(
    transfer_witness: TransferWitness,
    sanctions_witness: SanctionsWitness,
) -> Result<Vec<u8>> {
    use sp1_sdk::{blocking::ProverClient, Elf, SP1Stdin};

    // Load ELFs
    let transfer_elf = std::fs::read(TRANSFER_ELF_PATH)
        .with_context(|| format!("Transfer ELF not found at {TRANSFER_ELF_PATH}"))?;
    let sanctions_elf = std::fs::read(SANCTIONS_ELF_PATH)
        .with_context(|| format!("Sanctions ELF not found at {SANCTIONS_ELF_PATH}"))?;
    let combined_elf = std::fs::read(COMBINED_ELF_PATH)
        .with_context(|| format!("Combined ELF not found at {COMBINED_ELF_PATH}. Build with: cd crates/provers/sp1/guest-combined && cargo prove build"))?;

    let client = ProverClient::from_env();

    // ── Step 1: Transfer proof in COMPRESSED mode ──────────────────────────────
    //
    // COMPRESSED is aggregatable (can be recursively verified inside another SP1 circuit).
    // Unlike GROTH16, COMPRESSED proofs don't produce a fixed-size 256-byte proof;
    // they're larger but can be fed into an aggregator.

    tracing::info!("Combined: proving Transfer (compressed)...");
    let (transfer_pk, transfer_vk) = client
        .setup(Elf::Static(&transfer_elf))
        .context("setup Transfer ELF")?;

    let mut transfer_stdin = SP1Stdin::new();
    transfer_stdin.write(&transfer_witness);

    let transfer_proof = client
        .prove(&transfer_pk, transfer_stdin)
        .compressed()
        .run()
        .context("prove Transfer (compressed)")?;

    tracing::info!(
        "Combined: Transfer compressed proof done (public values: {} bytes)",
        transfer_proof.public_values.to_vec().len()
    );

    // ── Step 2: Sanctions proof in COMPRESSED mode ─────────────────────────────

    tracing::info!("Combined: proving Sanctions (compressed)...");
    let (sanctions_pk, sanctions_vk) = client
        .setup(Elf::Static(&sanctions_elf))
        .context("setup Sanctions ELF")?;

    let mut sanctions_stdin = SP1Stdin::new();
    sanctions_stdin.write(&sanctions_witness);

    let sanctions_proof = client
        .prove(&sanctions_pk, sanctions_stdin)
        .compressed()
        .run()
        .context("prove Sanctions (compressed)")?;

    tracing::info!(
        "Combined: Sanctions compressed proof done (public values: {} bytes)",
        sanctions_proof.public_values.to_vec().len()
    );

    // ── Step 3: Aggregator proof in GROTH16 mode ───────────────────────────────
    //
    // The aggregator circuit:
    //   a. Reads transfer_pv_bytes + transfer_vk_hash from stdin
    //   b. Calls verify_sp1_proof(transfer_vk_hash, sha256(transfer_pv_bytes))
    //   c. Repeats for sanctions
    //   d. Commits CombinedPublicOutputs
    //
    // Stdin layout (must match transfer_sanctions.rs guest):
    //   write_vec(transfer_pv_bytes)         → io::read_vec()
    //   write(transfer_vk.hash_u32())        → io::read::<[u32; 8]>()
    //   write_proof(transfer_proof, vk)      → (proof stream for verify_sp1_proof)
    //   write_vec(sanctions_pv_bytes)        → io::read_vec()
    //   write(sanctions_vk.hash_u32())       → io::read::<[u32; 8]>()
    //   write_proof(sanctions_proof, vk)     → (proof stream for verify_sp1_proof)

    tracing::info!("Combined: building aggregator stdin...");
    let mut agg_stdin = SP1Stdin::new();

    // Transfer sub-proof inputs
    let transfer_pv_bytes = transfer_proof.public_values.to_vec();
    agg_stdin.write_vec(transfer_pv_bytes);
    agg_stdin.write(&transfer_vk.hash_u32());
    agg_stdin.write_proof(transfer_proof, &transfer_vk);

    // Sanctions sub-proof inputs
    let sanctions_pv_bytes = sanctions_proof.public_values.to_vec();
    agg_stdin.write_vec(sanctions_pv_bytes);
    agg_stdin.write(&sanctions_vk.hash_u32());
    agg_stdin.write_proof(sanctions_proof, &sanctions_vk);

    // Prove aggregator in Groth16 mode (on-chain verifiable)
    tracing::info!("Combined: proving aggregator (Groth16)...");
    let (agg_pk, _agg_vk) = client
        .setup(Elf::Static(&combined_elf))
        .context("setup Combined ELF")?;

    let combined_proof = client
        .prove(&agg_pk, agg_stdin)
        .groth16()
        .run()
        .context("prove Combined (Groth16)")?;

    tracing::info!("Combined: aggregated Groth16 proof generated successfully");

    // Serialize proof for storage and transmission
    let proof_bytes =
        bincode::serialize(&combined_proof).context("serialize combined proof")?;

    Ok(proof_bytes)
}

// ── Combined proof verification (STF side) ────────────────────────────────────

/// Verify a combined Transfer+Sanctions Groth16 proof.
///
/// In `sp1` feature mode: full Groth16 verification using `sp1-verifier`.
/// In default mode: mock verification (accepts `OBSc`-prefixed proofs).
///
/// # Arguments
///
/// - `proof` — bytes from `prove_transfer_with_sanctions()` (or mock)
/// - `expected_transfer_vk_hash` — VK hash registered in rollup genesis for Transfer circuit
/// - `expected_sanctions_vk_hash` — VK hash registered in rollup genesis for Sanctions circuit
pub fn verify_combined_proof(
    proof: &[u8],
    expected_transfer_vk_hash: Option<&[u32; 8]>,
    expected_sanctions_vk_hash: Option<&[u32; 8]>,
) -> Result<()> {
    if proof.is_empty() {
        anyhow::bail!("Combined proof cannot be empty");
    }

    #[cfg(feature = "sp1")]
    {
        return verify_combined_sp1(proof, expected_transfer_vk_hash, expected_sanctions_vk_hash);
    }

    #[cfg(not(feature = "sp1"))]
    {
        // Phase 1: accept mock proofs with OBSc (Obscura Combined) prefix
        if proof.len() < 4 || &proof[0..4] != b"OBSc" {
            anyhow::bail!(
                "Combined proof: invalid format — expected 'OBSc' prefix (mock mode)"
            );
        }
        let _ = (expected_transfer_vk_hash, expected_sanctions_vk_hash);
        return Ok(());
    }
}

#[cfg(feature = "sp1")]
fn verify_combined_sp1(
    proof_bytes: &[u8],
    expected_transfer_vk: Option<&[u32; 8]>,
    expected_sanctions_vk: Option<&[u32; 8]>,
) -> Result<()> {
    use anyhow::Context;
    use sp1_sdk::{blocking::ProverClient, Elf, SP1ProofWithPublicValues};

    let combined_elf = std::fs::read(COMBINED_ELF_PATH)
        .with_context(|| format!("Combined ELF not found at {COMBINED_ELF_PATH}"))?;

    let client = ProverClient::from_env();
    let (_, vk) = client
        .setup(Elf::Static(&combined_elf))
        .context("setup Combined VK")?;

    let proof: SP1ProofWithPublicValues =
        bincode::deserialize(proof_bytes).context("deserialize combined proof")?;

    client.verify(&proof, &vk).context("Combined Groth16 verification failed")?;

    // Read combined public outputs from the verified proof
    let mut pub_vals = proof.public_values.clone();

    // Read all fields in the same order as CombinedPublicOutputs
    let nullifiers: Vec<[u8; 32]>        = pub_vals.read();
    let output_commitments: Vec<[u8; 32]> = pub_vals.read();
    let _transfer_amount: u64             = pub_vals.read();
    let _asset_id: [u8; 32]              = pub_vals.read();
    let _merkle_root: [u8; 32]           = pub_vals.read();
    let _recipient_commitment: [u8; 32]  = pub_vals.read();
    let _sanctions_root: [u8; 32]        = pub_vals.read();
    let _proof_timestamp: u64            = pub_vals.read();
    let transfer_vk_hash: [u32; 8]       = pub_vals.read();
    let sanctions_vk_hash: [u32; 8]      = pub_vals.read();

    // Verify the sub-circuit VK hashes match the rollup's registered versions.
    // This prevents a combined proof from a different/malicious circuit version.
    if let Some(expected) = expected_transfer_vk {
        if &transfer_vk_hash != expected {
            anyhow::bail!(
                "Combined proof: transfer VK hash mismatch — expected {:?}, got {:?}",
                expected, transfer_vk_hash
            );
        }
    }
    if let Some(expected) = expected_sanctions_vk {
        if &sanctions_vk_hash != expected {
            anyhow::bail!(
                "Combined proof: sanctions VK hash mismatch — expected {:?}, got {:?}",
                expected, sanctions_vk_hash
            );
        }
    }

    tracing::info!(
        "Combined proof verified: {} nullifiers, {} output commitments",
        nullifiers.len(),
        output_commitments.len()
    );

    Ok(())
}

/// Generate a mock combined proof for testing (Phase 1 / no `sp1` feature).
///
/// Format: `b"OBSc"` + transfer_amount (8 bytes LE) + sanctions_timestamp (8 bytes LE)
#[cfg(not(feature = "sp1"))]
pub fn mock_combined_proof(transfer_amount: u64, sanctions_timestamp: u64) -> Vec<u8> {
    let mut p = b"OBSc".to_vec();
    p.extend_from_slice(&transfer_amount.to_le_bytes());
    p.extend_from_slice(&sanctions_timestamp.to_le_bytes());
    p
}

