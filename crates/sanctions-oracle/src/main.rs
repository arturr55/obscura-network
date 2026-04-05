//! Sanctions Oracle CLI
//!
//! Usage:
//!   sanctions-oracle root
//!   sanctions-oracle root --sdn-file ./sdn_advanced.xml
//!   sanctions-oracle witness --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
//!   sanctions-oracle check --address 0x...

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use sanctions_oracle::{
    extract_eth_addresses_from_xml, fetch_ofac_sdn, load_local_sdn,
    parse_eth_addresses, SanctionsMerkleTree,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(name = "sanctions-oracle")]
struct Cli {
    #[arg(long)]
    sdn_file: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Root,
    Witness {
        #[arg(long)]
        address: String,
    },
    Check {
        #[arg(long)]
        address: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let addresses = load_sanctions(&cli.sdn_file)?;
    println!("Loaded {} sanctioned Ethereum addresses", addresses.len());

    let tree = SanctionsMerkleTree::build(&addresses);

    match cli.command {
        Command::Root => {
            println!("OFAC SDN Merkle Root: 0x{}", hex::encode(tree.root()));
            println!("Tree depth: {}", tree.depth);
            println!("Total leaves (incl. padding): {}", tree.sorted_addr_hashes.len());
        }
        Command::Witness { address } => {
            let addr_bytes = parse_single_address(&address)?;
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
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
            if tree.is_sanctioned(&addr_bytes) {
                println!("SANCTIONED: {} is on the OFAC SDN list", address);
                std::process::exit(1);
            } else {
                println!("CLEAN: {} is not on the OFAC SDN list", address);
            }
        }
    }
    Ok(())
}

fn parse_single_address(s: &str) -> Result<[u8; 32]> {
    let s = s.trim().strip_prefix("0x").unwrap_or(s.trim());
    anyhow::ensure!(s.len() == 40, "Address must be 40 hex chars");
    let mut bytes = [0u8; 20];
    hex::decode_to_slice(s, &mut bytes).context("invalid hex address")?;
    let mut padded = [0u8; 32];
    padded[12..].copy_from_slice(&bytes);
    Ok(padded)
}

fn load_sanctions(sdn_file: &Option<String>) -> Result<Vec<[u8; 32]>> {
    let xml = match sdn_file {
        Some(path) => load_local_sdn(path)?,
        None => fetch_ofac_sdn()?,
    };
    let raw = extract_eth_addresses_from_xml(&xml);
    Ok(parse_eth_addresses(&raw))
}
