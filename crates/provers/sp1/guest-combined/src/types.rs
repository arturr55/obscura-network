// Shared types for the Obscura Combined Proof aggregator circuit.
//
// The combined proof bundles a Transfer proof and a Sanctions non-membership proof
// into a single Groth16 proof, reducing on-chain verification cost by ~2×.
//
// # Aggregation protocol
//
// Sub-proofs are generated in SP1 COMPRESSED mode (aggregatable), then fed into
// this aggregator circuit which recursively verifies both and commits combined
// public outputs. The final aggregated proof is Groth16 (verifiable on-chain).
//
// # Cost reduction rationale
//
// Before: 2 Groth16 verifications per Transfer TX (Transfer + Sanctions)
// After : 1 Groth16 verification per Transfer TX (Combined)
//
// Additional savings: on the Succinct Prover Network, 2 compressed proofs cost
// far less than 1 Groth16 each, so the net amortised cost decreases significantly.

use serde::{Deserialize, Serialize};

/// Public outputs committed by the Transfer sub-circuit.
/// Must match `TransferPublicOutputs` in `guest-privacy/src/types.rs` exactly.
#[derive(Serialize, Deserialize, Clone)]
pub struct TransferPublicOutputs {
    pub nullifiers: Vec<[u8; 32]>,
    pub output_commitments: Vec<[u8; 32]>,
    pub transfer_amount: u64,
    pub asset_id: [u8; 32],
    pub merkle_root: [u8; 32],
}

/// Public outputs committed by the Sanctions sub-circuit.
/// Must match `SanctionsPublicOutputs` in `guest-privacy/src/types.rs` exactly.
#[derive(Serialize, Deserialize, Clone)]
pub struct SanctionsPublicOutputs {
    /// SHA256("recipient" || recipient) — proves a specific address was checked
    /// without revealing it. Auditor can verify: SHA256("recipient" || addr) == this.
    pub recipient_commitment: [u8; 32],
    /// OFAC Merkle root used in this sanctions proof.
    pub sanctions_root: [u8; 32],
    /// Always true if proof is valid (circuit rejects sanctioned addresses).
    pub is_clean: bool,
    /// Unix timestamp when proof was generated.
    pub proof_timestamp: u64,
}

/// Combined public outputs committed by the aggregator circuit.
///
/// Merges Transfer and Sanctions outputs into a single set of public values
/// verified by one Groth16 proof. The rollup STF reads these to:
///   - Add nullifiers (prevent double-spend)
///   - Register output commitments (make notes spendable)
///   - Verify OFAC compliance (sanctions_root must match rollup state)
#[derive(Serialize, Deserialize, Clone)]
pub struct CombinedPublicOutputs {
    // ── From Transfer sub-proof ────────────────────────────────────────────────
    /// Nullifiers of spent input notes — must be new (not in rollup's nullifier set).
    pub nullifiers: Vec<[u8; 32]>,
    /// Commitments of new output notes — added to the rollup's commitment tree.
    pub output_commitments: Vec<[u8; 32]>,
    /// Total transfer amount (for compliance accounting).
    pub transfer_amount: u64,
    /// Asset being transferred (must match rollup's registered assets).
    pub asset_id: [u8; 32],
    /// Commitment tree root used in the transfer proof.
    /// The rollup verifies this matches its current Merkle root.
    pub merkle_root: [u8; 32],

    // ── From Sanctions sub-proof ───────────────────────────────────────────────
    /// SHA256("recipient" || recipient) — proves OFAC check was performed.
    pub recipient_commitment: [u8; 32],
    /// OFAC Merkle root at proof time — must be fresh (rollup checks max age).
    pub sanctions_root: [u8; 32],
    /// Unix timestamp of the sanctions proof (must be < 24h old).
    pub proof_timestamp: u64,

    // ── Cross-circuit binding ─────────────────────────────────────────────────
    /// VK hash of the Transfer sub-circuit (0x00c5d4...).
    /// The rollup checks this matches the registered transfer VK.
    pub transfer_vk_hash: [u32; 8],
    /// VK hash of the Sanctions sub-circuit.
    /// The rollup checks this matches the registered sanctions VK.
    pub sanctions_vk_hash: [u32; 8],
}
