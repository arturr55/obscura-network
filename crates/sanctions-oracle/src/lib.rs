//! Sanctions Oracle — OFAC SDN Merkle Tree builder.
//!
//! Builds a sorted Merkle tree from the OFAC SDN list.
//! The tree can then be used to generate ZK non-membership proofs.
//!
//! ## Tree structure
//!
//! - Leaves are sorted hashes: `SHA256("addr" || address_bytes)`
//! - Leaf node: `SHA256("leaf" || addr_hash)`
//! - Internal node: `SHA256("node" || left || right)`
//! - Empty/padding leaf: `SHA256("leaf" || [0xff; 32])` — sentinel max value
//! - Tree is padded to the next power of 2 with sentinel max leaves
//! - Sentinel min `[0x00; 32]` is always inserted at index 0
//! - Sentinel max `[0xff; 32]` is always inserted at last index
//!   This ensures every real address always has valid adjacent neighbours.

pub mod server;

use anyhow::{bail, Result};
use sha2::{Digest, Sha256};

/// Sorted Merkle tree built from OFAC sanctions addresses.
pub struct SanctionsMerkleTree {
    /// Sorted addr_hashes (what goes into leaf positions)
    pub sorted_addr_hashes: Vec<[u8; 32]>,
    /// Full tree (leaf level + all internal levels), index 0 = root
    /// Stored bottom-up: levels[0] = leaf level, levels[last] = root
    levels: Vec<Vec<[u8; 32]>>,
    pub depth: u32,
}

/// A Merkle inclusion proof for a single leaf.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MerkleProof {
    /// The addr_hash of the leaf being proved
    pub addr_hash: [u8; 32],
    /// Index of the leaf in the sorted tree
    pub index: u64,
    /// Sibling hashes from leaf level up to (not including) root
    pub siblings: Vec<[u8; 32]>,
}

/// Non-membership witness for a single address.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NonMembershipWitness {
    pub sanctions_root: [u8; 32],
    pub left_leaf: [u8; 32],
    pub right_leaf: [u8; 32],
    pub left_proof: Vec<[u8; 32]>,
    pub right_proof: Vec<[u8; 32]>,
    pub left_index: u64,
    pub right_index: u64,
    pub tree_depth: u32,
}

fn hash_addr(addr: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"addr");
    h.update(addr);
    h.finalize().into()
}

fn hash_leaf(addr_hash: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"leaf");
    h.update(addr_hash);
    h.finalize().into()
}

fn hash_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"node");
    h.update(left);
    h.update(right);
    h.finalize().into()
}

impl SanctionsMerkleTree {
    /// Build a sorted Merkle tree from raw 32-byte addresses.
    /// Sentinel min/max are automatically added.
    pub fn build(addresses: &[[u8; 32]]) -> Self {
        // Hash all addresses → addr_hashes
        let mut addr_hashes: Vec<[u8; 32]> = addresses.iter().map(|a| hash_addr(a)).collect();

        // Add sentinels
        addr_hashes.push([0x00u8; 32]); // min sentinel
        addr_hashes.push([0xffu8; 32]); // max sentinel

        // Sort
        addr_hashes.sort();
        addr_hashes.dedup();

        // Pad to next power of 2 (fill with max sentinel)
        let n = addr_hashes.len();
        let tree_size = n.next_power_of_two();
        addr_hashes.resize(tree_size, [0xffu8; 32]);

        let depth = tree_size.trailing_zeros();

        // Build leaf level
        let leaf_level: Vec<[u8; 32]> = addr_hashes.iter().map(|h| hash_leaf(h)).collect();

        // Build tree bottom-up
        let mut levels: Vec<Vec<[u8; 32]>> = vec![leaf_level.clone()];
        let mut current = leaf_level;
        while current.len() > 1 {
            let next: Vec<[u8; 32]> = current
                .chunks(2)
                .map(|pair| hash_node(&pair[0], &pair[1]))
                .collect();
            levels.push(next.clone());
            current = next;
        }

        Self { sorted_addr_hashes: addr_hashes, levels, depth }
    }

    /// Merkle root of the tree.
    pub fn root(&self) -> [u8; 32] {
        self.levels.last().unwrap()[0]
    }

    /// Generate inclusion proof for the leaf at `index`.
    pub fn inclusion_proof(&self, index: usize) -> MerkleProof {
        let mut siblings = Vec::with_capacity(self.depth as usize);
        let mut idx = index;
        for level in &self.levels[..self.levels.len() - 1] {
            let sibling_idx = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
            siblings.push(level[sibling_idx]);
            idx >>= 1;
        }
        MerkleProof {
            addr_hash: self.sorted_addr_hashes[index],
            index: index as u64,
            siblings,
        }
    }

    /// Generate a non-membership witness for `address`.
    /// Returns error if the address IS in the sanctions list.
    pub fn non_membership_witness(
        &self,
        address: &[u8; 32],
        _timestamp: u64,
    ) -> Result<NonMembershipWitness> {
        let addr_hash = hash_addr(address);

        // Binary search for insertion point
        let pos = self.sorted_addr_hashes.partition_point(|&h| h < addr_hash);

        // Check it's not actually in the list
        if pos < self.sorted_addr_hashes.len() && self.sorted_addr_hashes[pos] == addr_hash {
            bail!("Address is in the sanctions list — cannot generate non-membership proof");
        }

        // Adjacent leaves: pos-1 (left) and pos (right)
        if pos == 0 {
            bail!("Address is smaller than all leaves — sentinel should prevent this");
        }
        let left_index = pos - 1;
        let right_index = pos;

        let left_proof = self.inclusion_proof(left_index);
        let right_proof = self.inclusion_proof(right_index);

        Ok(NonMembershipWitness {
            sanctions_root: self.root(),
            left_leaf: self.sorted_addr_hashes[left_index],
            right_leaf: self.sorted_addr_hashes[right_index],
            left_proof: left_proof.siblings,
            right_proof: right_proof.siblings,
            left_index: left_index as u64,
            right_index: right_index as u64,
            tree_depth: self.depth,
        })
    }

    /// Check if an address is sanctioned.
    pub fn is_sanctioned(&self, address: &[u8; 32]) -> bool {
        let addr_hash = hash_addr(address);
        self.sorted_addr_hashes.binary_search(&addr_hash).is_ok()
    }
}

/// Fetch OFAC SDN XML from treasury.gov.
pub fn fetch_ofac_sdn() -> Result<String> {
    tracing::info!("Fetching OFAC SDN list from treasury.gov...");
    let url = "https://www.treasury.gov/ofac/downloads/sdn_advanced.xml";
    let body = reqwest::blocking::get(url)
        .map_err(|e| anyhow::anyhow!("HTTP GET failed: {e}"))?
        .text()
        .map_err(|e| anyhow::anyhow!("reading response: {e}"))?;
    Ok(body)
}

/// Load SDN XML from a local file.
pub fn load_local_sdn(path: &str) -> Result<String> {
    std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("reading {path}: {e}"))
}

/// Extract Ethereum addresses from OFAC SDN XML.
/// OFAC marks Ethereum addresses with "Digital Currency Address - ETH".
pub fn extract_eth_addresses_from_xml(xml: &str) -> Vec<String> {
    let mut addresses = Vec::new();
    let mut search = xml;
    while let Some(pos) = search.find("Digital Currency Address - ETH") {
        search = &search[pos..];
        if let Some(start) = search.find("<versionDetail>") {
            let after_tag = &search[start + "<versionDetail>".len()..];
            if let Some(end) = after_tag.find("</versionDetail>") {
                let addr = after_tag[..end].trim().to_string();
                if addr.starts_with("0x") || addr.starts_with("0X") {
                    addresses.push(addr);
                }
            }
        }
        search = &search[30..];
    }
    addresses
}

/// Parse Ethereum-style hex addresses (0x...) from a list of strings.
pub fn parse_eth_addresses(raw: &[String]) -> Vec<[u8; 32]> {
    raw.iter()
        .filter_map(|s| {
            let s = s.trim().strip_prefix("0x").unwrap_or(s.trim());
            if s.len() != 40 {
                return None;
            }
            let mut bytes = [0u8; 20];
            hex::decode_to_slice(s, &mut bytes).ok()?;
            // Pad 20-byte Ethereum address to 32 bytes (left-pad with zeros)
            let mut padded = [0u8; 32];
            padded[12..].copy_from_slice(&bytes);
            Some(padded)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_addr(byte: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[31] = byte;
        a
    }

    #[test]
    fn test_build_and_root_is_deterministic() {
        let addrs: Vec<[u8; 32]> = (1..=5).map(make_addr).collect();
        let tree1 = SanctionsMerkleTree::build(&addrs);
        let tree2 = SanctionsMerkleTree::build(&addrs);
        assert_eq!(tree1.root(), tree2.root());
    }

    #[test]
    fn test_non_membership_clean_address() {
        let sanctioned: Vec<[u8; 32]> = (1..=10).map(make_addr).collect();
        let tree = SanctionsMerkleTree::build(&sanctioned);

        let clean_addr = make_addr(200); // not in the list
        let witness = tree.non_membership_witness(&clean_addr, 0).unwrap();
        assert_eq!(witness.sanctions_root, tree.root());
        assert_eq!(witness.right_index, witness.left_index + 1);
    }

    #[test]
    fn test_sanctioned_address_returns_error() {
        let sanctioned: Vec<[u8; 32]> = (1..=5).map(make_addr).collect();
        let tree = SanctionsMerkleTree::build(&sanctioned);

        let bad_addr = make_addr(3); // IS in the list
        assert!(tree.non_membership_witness(&bad_addr, 0).is_err());
    }

    #[test]
    fn test_inclusion_proof_verifies() {
        let addrs: Vec<[u8; 32]> = (1..=4).map(make_addr).collect();
        let tree = SanctionsMerkleTree::build(&addrs);

        // Verify each leaf's inclusion proof
        for i in 0..tree.sorted_addr_hashes.len() {
            let proof = tree.inclusion_proof(i);
            let mut current = hash_leaf(&tree.sorted_addr_hashes[i]);
            let mut idx = i;
            for sibling in &proof.siblings {
                current = if idx % 2 == 0 {
                    hash_node(&current, sibling)
                } else {
                    hash_node(sibling, &current)
                };
                idx >>= 1;
            }
            assert_eq!(current, tree.root(), "proof failed for index {i}");
        }
    }
}
