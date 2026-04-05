//! SP1 Prover — native host-side code for generating privacy proofs.
//! Requires `sp1` feature. Uses sp1-sdk blocking API (SP1 v6).

use anyhow::{bail, Context, Result};
use sp1_sdk::{
    blocking::{EnvProver, ProveRequest, Prover, ProverClient},
    Elf, SP1Stdin,
};

const TRANSFER_ELF: &[u8] = include_bytes!(
    "../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/transfer"
);
const UNSHIELD_ELF: &[u8] = include_bytes!(
    "../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/unshield"
);
const COMPLIANCE_ELF: &[u8] = include_bytes!(
    "../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/compliance"
);
const SANCTIONS_ELF: &[u8] = include_bytes!(
    "../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/sanctions"
);

use crate::types::Note;

mod guest_types {
    include!("../../provers/sp1/guest-privacy/src/types.rs");
}
pub use guest_types::{ComplianceWitness, NoteData, SanctionsWitness, TransferWitness, UnshieldWitness};

fn note_to_data(note: &Note) -> NoteData {
    let mut asset_id = [0u8; 32];
    asset_id.copy_from_slice(&note.asset_id.0);
    let mut pubkey = [0u8; 32];
    let len = note.owner_pubkey.len().min(32);
    pubkey[..len].copy_from_slice(&note.owner_pubkey[..len]);
    NoteData {
        amount: note.amount,
        asset_id,
        owner_pubkey: pubkey.to_vec(),
        salt: note.salt,
    }
}

fn client() -> EnvProver {
    ProverClient::from_env()
}

/// Generate a transfer proof using SP1.
///
/// `leaf_indices[i]` is the position of `input_notes[i]` in the commitment tree.
/// `merkle_paths[i]` contains the sibling hashes (TREE_DEPTH elements) for input i.
/// These are obtained by calling `crate::merkle::build_proof_paths` on all commitments.
pub fn prove_transfer(
    spending_keys: Vec<[u8; 32]>,
    input_notes: &[Note],
    output_notes: &[Note],
    merkle_root: [u8; 32],
    leaf_indices: Vec<u64>,
    merkle_paths: Vec<Vec<[u8; 32]>>,
) -> Result<Vec<u8>> {
    if leaf_indices.len() != input_notes.len() {
        bail!("leaf_indices length must match input_notes length");
    }
    if merkle_paths.len() != input_notes.len() {
        bail!("merkle_paths length must match input_notes length");
    }
    let prover = client();
    let witness = TransferWitness {
        spending_keys,
        inputs: input_notes.iter().map(note_to_data).collect(),
        outputs: output_notes.iter().map(note_to_data).collect(),
        merkle_root,
        leaf_indices,
        merkle_paths,
    };
    let mut stdin = SP1Stdin::new();
    stdin.write(&witness);
    let pk = prover.setup(Elf::Static(TRANSFER_ELF)).context("setup transfer")?;
    let proof = prover.prove(&pk, stdin).groth16().run().context("prove transfer")?;
    Ok(proof.bytes())
}

/// Generate an unshield proof using SP1.
pub fn prove_unshield(spending_key: [u8; 32], note: &Note) -> Result<Vec<u8>> {
    let prover = client();
    let witness = UnshieldWitness { spending_key, note: note_to_data(note) };
    let mut stdin = SP1Stdin::new();
    stdin.write(&witness);
    let pk = prover.setup(Elf::Static(UNSHIELD_ELF)).context("setup unshield")?;
    let proof = prover.prove(&pk, stdin).groth16().run().context("prove unshield")?;
    Ok(proof.bytes())
}

/// Generate a compliance proof using SP1.
pub fn prove_compliance(amounts: Vec<u64>, regulatory_limit: u64) -> Result<Vec<u8>> {
    if amounts.is_empty() {
        bail!("No amounts provided");
    }
    let prover = client();
    let witness = ComplianceWitness { amounts, regulatory_limit };
    let mut stdin = SP1Stdin::new();
    stdin.write(&witness);
    let pk = prover.setup(Elf::Static(COMPLIANCE_ELF)).context("setup compliance")?;
    let proof = prover.prove(&pk, stdin).groth16().run().context("prove compliance")?;
    Ok(proof.bytes())
}

/// Generate a ZK sanctions non-membership proof using SP1.
///
/// Proves that `recipient` is NOT on the OFAC SDN list identified by
/// `sanctions_root`, without revealing the recipient's address.
///
/// The `witness` should be obtained from the sanctions oracle:
/// `sanctions-oracle witness --address 0x...`
pub fn prove_sanctions(witness: SanctionsWitness) -> Result<Vec<u8>> {
    let prover = client();
    let mut stdin = SP1Stdin::new();
    stdin.write(&witness);
    let pk = prover.setup(Elf::Static(SANCTIONS_ELF)).context("setup sanctions")?;
    let proof = prover.prove(&pk, stdin).groth16().run().context("prove sanctions")?;
    Ok(proof.bytes())
}
