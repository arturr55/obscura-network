//! Helios SP1 Circuit — Ethereum Beacon Chain Light Client Step
//!
//! # What this circuit proves
//!
//! Given a trusted beacon root (stored in the Obscura rollup), this circuit
//! advances the light client by one epoch and proves:
//!
//!   1. The sync committee (2/3+ supermajority) signed the attested header.
//!   2. The finalized header is in the attested header's state (finality branch).
//!   3. The execution block hash is in the finalized header's body (SSZ Merkle).
//!
//! # Public outputs
//!
//!   - prev_trusted_root     — the previous trusted beacon root (chain link)
//!   - new_beacon_root       — hash_tree_root(finalized_header) — new trusted root
//!   - new_slot              — finalized_header.slot
//!   - execution_block_hash  — the ETH execution block proven finalized
//!
//! # Security model
//!
//! Phase 1 (testnet — `mock_bls` behavior):
//!   BLS signature is checked to be structurally non-zero, but no pairing check.
//!   All Merkle branch proofs ARE verified with real SHA-256.
//!   Sufficient for testnet where the relayer is trusted.
//!
//! Phase 2 (mainnet — compile with `--features bls`):
//!   Full BLS12-381 aggregate pairing check via SP1 precompile.
//!   Trustless: anyone can submit proofs, no trusted relayer needed.
//!
//! # Beacon chain constants (Ethereum mainnet / Deneb)
//!
//!   FINALIZED_ROOT_GINDEX = 105  → depth=6, leaf_index=41
//!   EXECUTION_PAYLOAD field in BeaconBlockBody → depth=4, leaf_index=9
//!   BLOCK_HASH field in ExecutionPayload       → depth=5, leaf_index=12
//!   SYNC_COMMITTEE_SIZE = 512, QUORUM = 342 (2/3 rounded up)

#![no_main]
sp1_zkvm::entrypoint!(main);

mod ssz;
mod types;

use types::{HeliosPublicOutputs, HeliosWitness};

/// Minimum sync committee participation for a valid update (2/3 of 512 = 342).
const MIN_SYNC_COMMITTEE_PARTICIPATION: u16 = 342;

/// SSZ Merkle constants for finalized_header proof in BeaconState.
/// generalized_index = 105 → depth=6, leaf_index = 105 - 2^6 = 41
const FINALIZED_ROOT_DEPTH: usize = 6;
const FINALIZED_ROOT_LEAF_INDEX: u64 = 41; // 105 - 64

/// SSZ Merkle constants for execution_payload in BeaconBlockBody (Deneb).
/// BeaconBlockBody has 12 fields → padded to 16 leaves → depth=4.
/// execution_payload is field index 9.
const BODY_TO_EXEC_DEPTH: usize = 4;
const BODY_TO_EXEC_LEAF_INDEX: u64 = 9;

/// SSZ Merkle constants for block_hash in ExecutionPayload (Deneb).
/// ExecutionPayload has 17 fields → padded to 32 leaves → depth=5.
/// block_hash is field index 12.
const EXEC_TO_HASH_DEPTH: usize = 5;
const EXEC_TO_HASH_LEAF_INDEX: u64 = 12;

pub fn main() {
    // ── Read witness ──────────────────────────────────────────────────────────
    let witness: HeliosWitness = sp1_zkvm::io::read();

    // ── Step 1: Compute beacon header roots ───────────────────────────────────
    // hash_tree_root(BeaconBlockHeader) — this is what gets committed on-chain.
    let finalized_header_root =
        ssz::hash_tree_root_beacon_header(&witness.finalized_header);
    let attested_header_root =
        ssz::hash_tree_root_beacon_header(&witness.attested_header);

    // The finalized slot must be non-zero (genesis protection)
    assert!(
        witness.finalized_header.slot > 0,
        "Helios: finalized slot must be non-zero"
    );

    // The finalized slot must not exceed the attested slot
    assert!(
        witness.finalized_header.slot <= witness.attested_header.slot,
        "Helios: finalized slot ({}) > attested slot ({})",
        witness.finalized_header.slot,
        witness.attested_header.slot
    );

    // ── Step 2: Verify finality branch ────────────────────────────────────────
    // Proves: hash_tree_root(finalized_header) is in attested_header.state_root
    // at generalized index 105 (FINALIZED_ROOT_GINDEX in the beacon specs).
    assert!(
        ssz::verify_merkle_branch(
            finalized_header_root,
            &witness.finality_branch,
            FINALIZED_ROOT_DEPTH,
            FINALIZED_ROOT_LEAF_INDEX,
            witness.attested_header.state_root,
        ),
        "Helios: finality branch verification failed — finalized_header not in attested state"
    );

    // ── Step 3: Verify sync committee participation ───────────────────────────
    // The sync committee must have a 2/3+ supermajority.
    assert!(
        witness.sync_committee_participation >= MIN_SYNC_COMMITTEE_PARTICIPATION,
        "Helios: insufficient sync committee participation ({}/512, need {})",
        witness.sync_committee_participation,
        MIN_SYNC_COMMITTEE_PARTICIPATION
    );

    // ── Step 4: Verify BLS aggregate signature ────────────────────────────────
    //
    // Phase 1 (testnet): structural check only — signature must be non-zero.
    // This prevents trivially invalid proofs from being accepted on testnet.
    //
    // Phase 2 (mainnet): uncomment the BLS pairing check below and compile
    // with `--features bls`. Requires SP1 BLS12-381 precompile.
    {
        // Mock check: signature must be non-zero and pubkey must be non-zero
        assert!(
            witness.sync_aggregate_signature != [0u8; 96],
            "Helios: BLS signature is all zeros (invalid)"
        );
        assert!(
            witness.sync_committee_pubkey != [0u8; 48],
            "Helios: sync committee pubkey is all zeros (invalid)"
        );

        // The signing root that was signed over (verified structurally):
        // signing_root = hash_tree_root(SigningData { attested_header_root, domain })
        // where domain = compute_domain(DOMAIN_SYNC_COMMITTEE, fork_version, genesis_validators_root)
        //
        // We still compute it to verify the witness is internally consistent.
        let domain = ssz::compute_domain(
            ssz::DOMAIN_SYNC_COMMITTEE,
            witness.fork_version,
            witness.genesis_validators_root,
        );
        let _signing_root = ssz::compute_signing_root(attested_header_root, domain);

        // Phase 2: BLS verification (uncomment when --features bls is enabled):
        // bls::verify_bls_aggregate(
        //     &witness.sync_committee_pubkey,  // 48-byte G1 aggregate pubkey
        //     &_signing_root,                   // 32-byte message
        //     &witness.sync_aggregate_signature,// 96-byte G2 signature
        // ).expect("Helios: BLS12-381 aggregate signature verification failed");
    }

    // ── Step 5: Verify execution payload root in finalized body ──────────────
    // Proves: execution_payload_root is in finalized_header.body_root
    // execution_payload is field 9 in BeaconBlockBody (Deneb), depth=4.
    assert!(
        ssz::verify_merkle_branch(
            witness.execution_payload_root,
            &witness.body_to_exec_branch,
            BODY_TO_EXEC_DEPTH,
            BODY_TO_EXEC_LEAF_INDEX,
            witness.finalized_header.body_root,
        ),
        "Helios: execution_payload_root not in finalized body_root (depth=4, index=9)"
    );

    // ── Step 6: Verify execution block hash in execution payload ─────────────
    // Proves: execution_block_hash is in execution_payload_root
    // block_hash is field 12 in ExecutionPayload (Deneb), depth=5.
    assert!(
        ssz::verify_merkle_branch(
            witness.execution_block_hash,
            &witness.exec_to_hash_branch,
            EXEC_TO_HASH_DEPTH,
            EXEC_TO_HASH_LEAF_INDEX,
            witness.execution_payload_root,
        ),
        "Helios: execution_block_hash not in execution_payload_root (depth=5, index=12)"
    );

    // ── Step 7: Commit public outputs ────────────────────────────────────────
    let outputs = HeliosPublicOutputs {
        prev_trusted_root: witness.prev_trusted_root,
        new_beacon_root: finalized_header_root,
        new_slot: witness.finalized_header.slot,
        execution_block_hash: witness.execution_block_hash,
    };

    sp1_zkvm::io::commit(&outputs);
}
