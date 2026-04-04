//! Generate SP1 verification key hashes for the privacy circuits.
//! Run: cargo run -p obscura-privacy --bin gen_vkeys --features sp1

#[cfg(feature = "sp1")]
fn main() {
    use sp1_sdk::blocking::{MockProver, Prover};
    use sp1_sdk::{Elf, ProvingKey};
    use sp1_prover::HashableKey;

    const TRANSFER_ELF: &[u8] = include_bytes!(
        "../../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/transfer"
    );
    const UNSHIELD_ELF: &[u8] = include_bytes!(
        "../../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/unshield"
    );
    const COMPLIANCE_ELF: &[u8] = include_bytes!(
        "../../../provers/sp1/guest-privacy/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/compliance"
    );

    let prover = MockProver::new();

    let transfer_pk = prover.setup(Elf::Static(TRANSFER_ELF)).expect("setup transfer");
    let unshield_pk = prover.setup(Elf::Static(UNSHIELD_ELF)).expect("setup unshield");
    let compliance_pk = prover.setup(Elf::Static(COMPLIANCE_ELF)).expect("setup compliance");

    println!("// Paste these into zk/mod.rs sp1_vkeys module:");
    println!("pub const TRANSFER_VK_HASH: &str = \"{}\";", transfer_pk.verifying_key().bytes32());
    println!("pub const UNSHIELD_VK_HASH: &str = \"{}\";", unshield_pk.verifying_key().bytes32());
    println!("pub const COMPLIANCE_VK_HASH: &str = \"{}\";", compliance_pk.verifying_key().bytes32());
}

#[cfg(not(feature = "sp1"))]
fn main() {
    eprintln!("Run with: cargo run -p obscura-privacy --bin gen_vkeys --features sp1");
    std::process::exit(1);
}
