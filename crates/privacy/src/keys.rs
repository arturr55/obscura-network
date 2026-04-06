/// Viewing key types for the Obscura privacy module.
///
/// # Key hierarchy
///
/// ```text
/// spending_key (secret, 32 bytes)
///     └── viewing_keypair
///             ├── viewing_secret_key  — can decrypt notes (share with auditor)
///             └── viewing_public_key  — others use this to encrypt notes for you
/// ```
///
/// # Dual encryption (compliance by design)
///
/// Every Note in Obscura is encrypted TWICE:
///   1. `enc_for_recipient` — encrypted with the recipient's `viewing_public_key`
///   2. `enc_for_compliance` — encrypted with `COMPLIANCE_ORACLE_PUBKEY` (protocol-level)
///
/// The compliance oracle holds the secret key for `COMPLIANCE_ORACLE_PUBKEY` and
/// can decrypt **any** transaction, even if the user never shared their viewing key.
/// This satisfies regulatory requirements without breaking user privacy for everyone else.
///
/// # Security
///
/// - A viewing key lets you **read** transactions but NOT spend funds.
/// - Spending requires the `spending_key` which is never shared.
/// - The compliance oracle sees transaction amounts and parties, but this is
///   gated to authorized regulators (ZKCompliance multisig on mainnet).

use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

/// X25519 public key — 32 bytes.
/// Share this with senders so they can encrypt notes for you.
/// Safe to publish; cannot be used to spend funds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewingPublicKey(pub [u8; 32]);

/// X25519 secret key — 32 bytes.
/// Keep private. Used to decrypt notes sent to you.
/// Can be shared with a trusted auditor for voluntary disclosure.
#[derive(Debug, Clone)]
pub struct ViewingSecretKey(pub [u8; 32]);

/// A full viewing keypair (secret + public).
pub struct ViewingKeypair {
    pub secret: ViewingSecretKey,
    pub public: ViewingPublicKey,
}

impl ViewingKeypair {
    /// Generate a new random viewing keypair.
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
        let public = PublicKey::from(&secret);
        Self {
            secret: ViewingSecretKey(*secret.as_bytes()),
            public: ViewingPublicKey(*public.as_bytes()),
        }
    }

    /// Derive a deterministic viewing keypair from a spending key.
    /// The viewing key is a one-way derivation — knowing the viewing key
    /// does NOT allow you to derive the spending key.
    pub fn from_spending_key(spending_key: &[u8; 32]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"obscura-viewing-key-v1");
        hasher.update(spending_key);
        let viewing_sk_bytes: [u8; 32] = hasher.finalize().into();

        let secret = StaticSecret::from(viewing_sk_bytes);
        let public = PublicKey::from(&secret);
        Self {
            secret: ViewingSecretKey(*secret.as_bytes()),
            public: ViewingPublicKey(*public.as_bytes()),
        }
    }
}

/// The Compliance Oracle public key — hardcoded in the Obscura protocol.
///
/// Every Note is encrypted with this key in addition to the recipient's key.
/// The compliance oracle (ZKCompliance service) holds the corresponding secret key
/// and can decrypt any transaction on the Obscura network.
///
/// # Testnet key (2026)
/// This is a deterministic testnet key derived from a known seed.
/// On mainnet, this will be replaced with a key controlled by a multisig of
/// authorized regulators/compliance providers.
///
/// # How the secret is held
/// Secret key = SHA256("obscura-compliance-oracle-testnet-v1-secret")
/// This is documented here for testnet transparency; mainnet key is secret.
pub const COMPLIANCE_ORACLE_PUBKEY: [u8; 32] = [
    // X25519 public key corresponding to:
    // sk = SHA256("obscura-compliance-oracle-testnet-v1-secret")
    // Computed from compliance_oracle_keypair() function below.
    0xd4, 0x7e, 0xe5, 0xdb, 0xcc, 0xed, 0x12, 0x9e,
    0x12, 0x6c, 0x8a, 0x6e, 0x54, 0xd3, 0x69, 0xea,
    0xad, 0x01, 0x25, 0xe5, 0x80, 0xf7, 0x45, 0xef,
    0x94, 0xd7, 0x4e, 0xd2, 0x43, 0xb2, 0x36, 0x78,
];

/// Derive the testnet compliance oracle viewing keypair.
/// This function is only for the oracle service itself — not for end users.
///
/// In production, this secret key would be stored in an HSM or multisig.
pub fn compliance_oracle_keypair() -> ViewingKeypair {
    // Derive from known seed (testnet only)
    let mut hasher = Sha256::new();
    hasher.update(b"obscura-compliance-oracle-testnet-v1-secret");
    let sk_bytes: [u8; 32] = hasher.finalize().into();

    let secret = StaticSecret::from(sk_bytes);
    let public = PublicKey::from(&secret);

    // Verify it matches the hardcoded pubkey (sanity check)
    debug_assert_eq!(
        public.as_bytes(),
        &COMPLIANCE_ORACLE_PUBKEY,
        "Compliance oracle pubkey mismatch — update COMPLIANCE_ORACLE_PUBKEY constant"
    );

    ViewingKeypair {
        secret: ViewingSecretKey(*secret.as_bytes()),
        public: ViewingPublicKey(*public.as_bytes()),
    }
}
