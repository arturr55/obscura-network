//! Core types for the Obscura shielded pool.

use anyhow::{bail, Result};
use schemars::JsonSchema;
use sov_modules_api::macros::{serialize, UniversalWallet};
use sha2::{Digest, Sha256};
use std::fmt;
use std::str::FromStr;

/// A commitment is the public fingerprint of a private Note.
/// commitment = SHA256(amount || asset_id || owner_pubkey || salt)
/// It is safe to publish because it hides all meaningful data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct Commitment(pub [u8; 32]);

impl Commitment {
    pub fn from_note(note: &Note) -> Result<Self> {
        if note.amount == 0 {
            bail!("Note amount must be non-zero");
        }
        if note.owner_pubkey.len() != 32 {
            bail!("Owner pubkey must be 32 bytes");
        }

        let mut hasher = Sha256::new();
        hasher.update(note.amount.to_le_bytes());
        hasher.update(note.asset_id.0);
        hasher.update(&note.owner_pubkey);
        hasher.update(note.salt);

        Ok(Commitment(hasher.finalize().into()))
    }
}

impl fmt::Display for Commitment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

impl FromStr for Commitment {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        let bytes = hex::decode(s)?;
        if bytes.len() != 32 {
            bail!("Commitment must be 32 bytes");
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Commitment(arr))
    }
}

/// A nullifier is revealed when spending a note to prevent double-spending.
/// nullifier = SHA256(spending_key || commitment)
/// Once revealed on-chain, the corresponding note is permanently spent.
#[derive(Debug, Clone, PartialEq, Eq, Hash, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct Nullifier(pub [u8; 32]);

impl Nullifier {
    pub fn compute(spending_key: &[u8; 32], commitment: &Commitment) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(spending_key);
        hasher.update(commitment.0);
        Nullifier(hasher.finalize().into())
    }
}

impl fmt::Display for Nullifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

impl FromStr for Nullifier {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        let bytes = hex::decode(s)?;
        if bytes.len() != 32 {
            bail!("Nullifier must be 32 bytes");
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Nullifier(arr))
    }
}

/// Asset identifier — 32-byte token ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct AssetId(pub [u8; 32]);

impl fmt::Display for AssetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

impl FromStr for AssetId {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        let bytes = hex::decode(s)?;
        if bytes.len() != 32 {
            bail!("AssetId must be 32 bytes");
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(AssetId(arr))
    }
}

/// A private Note represents a shielded balance.
/// This struct is kept secret by the owner — never published on-chain.
/// Only the Commitment (hash) is published.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct Note {
    /// Token amount (in base units)
    pub amount: u64,
    /// Asset identifier
    pub asset_id: AssetId,
    /// Owner's public key (32 bytes)
    pub owner_pubkey: Vec<u8>,
    /// Random salt for commitment uniqueness
    pub salt: [u8; 32],
}

/// Shielded balance summary for a given asset (public aggregate).
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct ShieldedBalance {
    pub asset_id: AssetId,
    pub total_shielded: u64,
}

/// Compliance report — ZK proof of aggregate compliance without individual privacy.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct ComplianceReport {
    pub tx_count: u64,
    pub total_volume: u64,
    /// ZK proof that total_volume <= regulatory_limit
    pub compliance_proof: Vec<u8>,
    pub block_height: u64,
}
