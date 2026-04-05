//! Sanctions Oracle CLI
//!
//! Fetches the OFAC SDN list, builds a sorted Merkle tree, and outputs:
//! - The current Merkle root (to publish on-chain)
//! - Non-membership witnesses for given addresses (to feed into SP1 prover)
//!
//! Usage:
//!   # Print current Merkle root
//!   sanctions-oracle root
//!
//!   # Generate non-membership witness for an address
//!   sanctions-oracle witness --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
//!
//!   # Use a local SDN file instead of fetching
//!   sanctions-oracle root --sdn-file ./sdn_advanced.xml

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use sanctions_oracle::{parse_eth_addresses, SanctionsMerkleTree};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(name = "sanctions-oracle", about = "OFAC SDN Merkle tree oracle for ZK sanctions proofs")]
struct Cli {
    /// Path to local SDN XML file (skips HTTP fetch)
    #[arg(long)]
    sdn_file: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print the current OFAC SDN Merkle root
    Root,
    /// Generate a non-membership witness for an address
    Witness {
        /// Ethereum address to check (0x...)
        #[arg(long)]
        address: String,
    },
    /// Check if an address is sanctioned
    Check {
        /// Ethereum address to check (0x...)
        #[arg(long)]
        address: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let addresses = load_sanctions(&cli.sdn_file)?;
    println!("Loaded {} sanctioned Ethereum addresses", addresses.len());

    let tree = SanctionsMerkleTree::build(&addresses);
    let root = tree.root();

    match cli.command {
        Command::Root => {
            println!("OFAC SDN Merkle Root: 0x{}", hex::encode(root));
            println!("Tree depth: {}", tree.depth);
            println!("Total leaves (incl. padding): {}", tree.sorted_addr_hashes.len());
        }

        Command::Witness { address } => {
            let addr_bytes = parse_single_address(&address)?;
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();

            match tree.non_membership_witness(&addr_bytes, timestamp) {
                Ok(witness) => {
                    println!("Address {} is CLEAN (not sanctioned)", address);
                    println!("{}", serde_json::to_string_pretty(&witness)?);
                }
                Err(e) => {
                    eprintln!("Cannot generate witness: {e}");
                    std::process::exit(1);
                }
            }
        }

        Command::Check { address } => {
            let addr_bytes = parse_single_address(&address)?;
            let addr_hash = sha2_hash_addr(&addr_bytes);
            let is_sanctioned = tree
                .sorted_addr_hashes
                .binary_search(&addr_hash)
                .is_ok();

            if is_sanctioned {
                println!("SANCTIONED: {} is on the OFAC SDN list", address);
                std::process::exit(1);
            } else {
                println!("CLEAN: {} is not on the OFAC SDN list", address);
            }
        }
    }

    Ok(())
}

/// Hash address the same way the tree does (must match lib.rs hash_addr).
fn sha2_hash_addr(addr: &[u8; 32]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"addr");
    h.update(addr);
    h.finalize().into()
}

fn parse_single_address(s: &str) -> Result<[u8; 32]> {
    let s = s.trim().strip_prefix("0x").unwrap_or(s.trim());
    anyhow::ensure!(s.len() == 40, "Address must be 20 bytes (40 hex chars), got {}", s.len());
    let mut bytes = [0u8; 20];
    hex::decode_to_slice(s, &mut bytes).context("invalid hex address")?;
    let mut padded = [0u8; 32];
    padded[12..].copy_from_slice(&bytes);
    Ok(padded)
}

/// Load OFAC SDN Ethereum addresses from file or HTTP.
fn load_sanctions(sdn_file: &Option<String>) -> Result<Vec<[u8; 32]>> {
    let xml = if let Some(path) = sdn_file {
        std::fs::read_to_string(path).context("reading SDN file")?
    } else {
        fetch_ofac_sdn().context("fetching OFAC SDN list")?
    };

    let raw_addresses = extract_eth_addresses_from_xml(&xml);
    Ok(parse_eth_addresses(&raw_addresses))
}

/// Fetch OFAC SDN XML from treasury.gov.
fn fetch_ofac_sdn() -> Result<String> {
    println!("Fetching OFAC SDN list from treasury.gov...");
    let url = "https://www.treasury.gov/ofac/downloads/sdn_advanced.xml";
    let body = reqwest::blocking::get(url)
        .context("HTTP GET failed")?
        .text()
        .context("reading response body")?;
    Ok(body)
}

/// Extract Ethereum addresses from OFAC SDN XML.
/// OFAC marks Ethereum addresses with Digital Currency Address - ETH.
fn extract_eth_addresses_from_xml(xml: &str) -> Vec<String> {
    let mut addresses = Vec::new();
    // OFAC XML format: <feature featureTypeID="344"> (344 = ETH address)
    // followed by <versionDetail>0x...</versionDetail>
    // We do a simple string scan since the XML structure is consistent.
    let mut search = xml;
    while let Some(pos) = search.find("Digital Currency Address - ETH") {
        search = &search[pos..];
        // Find the next versionDetail tag
        if let Some(start) = search.find("<versionDetail>") {
            let after_tag = &search[start + "<versionDetail>".len()..];
            if let Some(end) = after_tag.find("</versionDetail>") {
                let addr = after_tag[..end].trim().to_string();
                if addr.starts_with("0x") || addr.starts_with("0X") {
                    addresses.push(addr);
                }
            }
        }
        // Advance past this match
        search = &search[30..];
    }
    addresses
}
