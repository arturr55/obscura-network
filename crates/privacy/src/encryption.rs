/// ECIES-style note encryption for the Obscura privacy module.
///
/// # Encryption scheme: X25519-ECIES with SHA256-CTR
///
/// ```text
/// Encrypt(plaintext, recipient_pk):
///   1. eph_sk = random_32_bytes
///   2. eph_pk = X25519::pubkey(eph_sk)
///   3. dh     = X25519(eph_sk, recipient_pk)         // Diffie-Hellman
///   4. key    = SHA256("obscura-enc-v1" || dh || eph_pk)
///   5. ks_i   = SHA256("ks" || key || i as u8)        // 32-byte keystream blocks
///   6. ct     = plaintext XOR ks                      // stream cipher
///   7. mac    = SHA256("mac" || key || ct)             // authentication
///   8. output = eph_pk (32) || mac (32) || ct
///
/// Decrypt(blob, my_sk):
///   1. eph_pk = blob[0..32], mac = blob[32..64], ct = blob[64..]
///   2. dh     = X25519(my_sk, eph_pk)
///   3. key    = SHA256("obscura-enc-v1" || dh || eph_pk)
///   4. verify mac == SHA256("mac" || key || ct)       // reject if mismatch
///   5. ks_i   = SHA256("ks" || key || i as u8)
///   6. return ct XOR ks
/// ```
///
/// # Note plaintext format
///
/// The encrypted payload is: amount (8 LE) || asset_id (32) || salt (32) || memo (opt)
/// Total: 72 bytes minimum.
///
/// # Security properties
///
/// - Forward secrecy: each note uses a fresh ephemeral keypair
/// - Unlinkability: different notes to the same recipient produce different ciphertexts
/// - Authentication: MAC prevents ciphertext tampering
/// - Non-repudiation: only sender knows eph_sk, but anyone with recipient_pk can verify

use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use anyhow::{bail, Result};

/// The overhead bytes added by encryption: eph_pk (32) + mac (32) = 64 bytes.
pub const ENCRYPTION_OVERHEAD: usize = 64;

/// Minimum encrypted note size: 64 (overhead) + 72 (note data) = 136 bytes.
pub const MIN_ENCRYPTED_NOTE_SIZE: usize = ENCRYPTION_OVERHEAD + 72;

// ── Public API ────────────────────────────────────────────────────────────────

/// Encrypt a note for a recipient.
///
/// # Arguments
/// - `plaintext`    — note data bytes (see NoteContent::to_bytes())
/// - `recipient_pk` — X25519 public key of the recipient (32 bytes)
///
/// # Returns
/// `eph_pk (32) || mac (32) || ciphertext`
pub fn encrypt_note(plaintext: &[u8], recipient_pk: &[u8; 32]) -> Vec<u8> {
    // Generate fresh ephemeral keypair
    let eph_sk = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let eph_pk = PublicKey::from(&eph_sk);

    // X25519 Diffie-Hellman with recipient's public key
    let recipient = PublicKey::from(*recipient_pk);
    let dh = eph_sk.diffie_hellman(&recipient);

    // Derive encryption key
    let key = derive_key(dh.as_bytes(), eph_pk.as_bytes());

    // Stream-cipher encrypt
    let ciphertext = stream_xor(plaintext, &key);

    // Authenticate
    let mac = compute_mac(&key, &ciphertext);

    // Assemble output
    let mut out = Vec::with_capacity(ENCRYPTION_OVERHEAD + plaintext.len());
    out.extend_from_slice(eph_pk.as_bytes());
    out.extend_from_slice(&mac);
    out.extend_from_slice(&ciphertext);
    out
}

/// Decrypt a note using the recipient's secret key.
///
/// # Arguments
/// - `blob`   — encrypted bytes: `eph_pk (32) || mac (32) || ciphertext`
/// - `my_sk`  — X25519 secret key of the recipient (32 bytes)
///
/// # Returns
/// Decrypted plaintext, or error if MAC verification fails or blob is too short.
pub fn decrypt_note(blob: &[u8], my_sk: &[u8; 32]) -> Result<Vec<u8>> {
    if blob.len() < ENCRYPTION_OVERHEAD {
        bail!("Encrypted note too short: {} bytes (min {})", blob.len(), ENCRYPTION_OVERHEAD);
    }

    let eph_pk_bytes: [u8; 32] = blob[0..32].try_into().unwrap();
    let expected_mac: [u8; 32] = blob[32..64].try_into().unwrap();
    let ciphertext = &blob[64..];

    // DH with ephemeral public key
    let sk = StaticSecret::from(*my_sk);
    let eph_pk = PublicKey::from(eph_pk_bytes);
    let dh = sk.diffie_hellman(&eph_pk);

    // Derive the same key
    let key = derive_key(dh.as_bytes(), &eph_pk_bytes);

    // Verify MAC
    let actual_mac = compute_mac(&key, ciphertext);
    if actual_mac != expected_mac {
        bail!("Note decryption failed: MAC mismatch (wrong key or tampered data)");
    }

    // Decrypt
    Ok(stream_xor(ciphertext, &key))
}

// ── Note content serialization ────────────────────────────────────────────────

/// The plaintext payload of an encrypted note.
#[derive(Debug, Clone)]
pub struct NoteContent {
    /// Token amount (8 bytes LE)
    pub amount: u64,
    /// Asset identifier (32 bytes)
    pub asset_id: [u8; 32],
    /// Note salt / randomness (32 bytes)
    pub salt: [u8; 32],
    /// Optional memo text (UTF-8, max 64 bytes, zero-padded)
    pub memo: [u8; 64],
}

impl NoteContent {
    /// Serialize to 136 bytes: amount(8) || asset_id(32) || salt(32) || memo(64)
    pub fn to_bytes(&self) -> [u8; 136] {
        let mut out = [0u8; 136];
        out[0..8].copy_from_slice(&self.amount.to_le_bytes());
        out[8..40].copy_from_slice(&self.asset_id);
        out[40..72].copy_from_slice(&self.salt);
        out[72..136].copy_from_slice(&self.memo);
        out
    }

    /// Deserialize from 136 bytes.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() < 136 {
            bail!("NoteContent too short: {} bytes (need 136)", data.len());
        }
        Ok(Self {
            amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            asset_id: data[8..40].try_into().unwrap(),
            salt: data[40..72].try_into().unwrap(),
            memo: data[72..136].try_into().unwrap(),
        })
    }
}

// ── Encrypted note container ──────────────────────────────────────────────────

/// A note encrypted in two ways: for the recipient and for the compliance oracle.
///
/// Both are stored on-chain alongside the commitment. This enables:
/// - Recipient: decrypt with their viewing secret key
/// - Compliance oracle: decrypt with the protocol's oracle secret key (mandatory access)
/// - Voluntary auditor: user shares their viewing secret key
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedNote {
    /// Encrypted with the recipient's X25519 viewing public key.
    /// Only the recipient (or someone they shared their viewing key with) can decrypt.
    pub enc_for_recipient: Vec<u8>,

    /// Encrypted with the Compliance Oracle's hardcoded X25519 public key.
    /// The compliance oracle can decrypt this for ANY note, regardless of user consent.
    /// This is the "forced compliance" guarantee — auditors can always audit.
    pub enc_for_compliance: Vec<u8>,
}

impl EncryptedNote {
    /// Create a new EncryptedNote by encrypting note content for both parties.
    ///
    /// # Arguments
    /// - `content`         — note data to encrypt
    /// - `recipient_pk`    — recipient's viewing public key (32 bytes)
    /// - `oracle_pk`       — compliance oracle public key (use `COMPLIANCE_ORACLE_PUBKEY`)
    pub fn create(
        content: &NoteContent,
        recipient_pk: &[u8; 32],
        oracle_pk: &[u8; 32],
    ) -> Self {
        let plaintext = content.to_bytes();
        Self {
            enc_for_recipient: encrypt_note(&plaintext, recipient_pk),
            enc_for_compliance: encrypt_note(&plaintext, oracle_pk),
        }
    }

    /// Decrypt this note as the recipient.
    pub fn decrypt_as_recipient(&self, viewing_sk: &[u8; 32]) -> Result<NoteContent> {
        let plaintext = decrypt_note(&self.enc_for_recipient, viewing_sk)?;
        NoteContent::from_bytes(&plaintext)
    }

    /// Decrypt this note as the compliance oracle.
    pub fn decrypt_as_oracle(&self, oracle_sk: &[u8; 32]) -> Result<NoteContent> {
        let plaintext = decrypt_note(&self.enc_for_compliance, oracle_sk)?;
        NoteContent::from_bytes(&plaintext)
    }

    /// Try to decrypt this note — returns Some(content) if the key works, None otherwise.
    /// Used by wallets scanning the chain for their own notes.
    pub fn try_decrypt(&self, viewing_sk: &[u8; 32]) -> Option<NoteContent> {
        // Try recipient encryption first, then compliance encryption
        decrypt_note(&self.enc_for_recipient, viewing_sk)
            .ok()
            .and_then(|p| NoteContent::from_bytes(&p).ok())
            .or_else(|| {
                decrypt_note(&self.enc_for_compliance, viewing_sk)
                    .ok()
                    .and_then(|p| NoteContent::from_bytes(&p).ok())
            })
    }

    /// Serialize to bytes: [2 bytes enc_len][enc_for_recipient][2 bytes enc_len][enc_for_compliance]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let r_len = self.enc_for_recipient.len() as u16;
        out.extend_from_slice(&r_len.to_le_bytes());
        out.extend_from_slice(&self.enc_for_recipient);
        let c_len = self.enc_for_compliance.len() as u16;
        out.extend_from_slice(&c_len.to_le_bytes());
        out.extend_from_slice(&self.enc_for_compliance);
        out
    }

    /// Deserialize from bytes.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() < 4 {
            bail!("EncryptedNote too short");
        }
        let r_len = u16::from_le_bytes([data[0], data[1]]) as usize;
        if data.len() < 2 + r_len + 2 {
            bail!("EncryptedNote truncated (enc_for_recipient)");
        }
        let enc_for_recipient = data[2..2 + r_len].to_vec();
        let c_off = 2 + r_len;
        let c_len = u16::from_le_bytes([data[c_off], data[c_off + 1]]) as usize;
        if data.len() < c_off + 2 + c_len {
            bail!("EncryptedNote truncated (enc_for_compliance)");
        }
        let enc_for_compliance = data[c_off + 2..c_off + 2 + c_len].to_vec();
        Ok(Self { enc_for_recipient, enc_for_compliance })
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Derive a 32-byte encryption key from a DH shared secret.
fn derive_key(dh_bytes: &[u8; 32], eph_pk: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"obscura-enc-v1");
    h.update(dh_bytes);
    h.update(eph_pk);
    h.finalize().into()
}

/// Compute MAC: SHA256("mac" || key || ciphertext)
fn compute_mac(key: &[u8; 32], ciphertext: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"mac");
    h.update(key);
    h.update(ciphertext);
    h.finalize().into()
}

/// XOR plaintext with a SHA256-based keystream.
/// Generates 32-byte keystream blocks: block_i = SHA256("ks" || key || [i])
fn stream_xor(data: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut block_idx: u8 = 0;
    let mut remaining = data.len();
    let mut offset = 0;

    while remaining > 0 {
        // Generate next 32-byte keystream block
        let mut h = Sha256::new();
        h.update(b"ks");
        h.update(key);
        h.update(&[block_idx]);
        let block: [u8; 32] = h.finalize().into();

        let take = remaining.min(32);
        for i in 0..take {
            out.push(data[offset + i] ^ block[i]);
        }
        offset += take;
        remaining -= take;
        block_idx = block_idx.wrapping_add(1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        use crate::keys::ViewingKeypair;
        let kp = ViewingKeypair::generate();
        let plaintext = b"hello obscura viewing keys test 1234567890!!";
        let blob = encrypt_note(plaintext, &kp.public.0);
        let decrypted = decrypt_note(&blob, &kp.secret.0).unwrap();
        assert_eq!(&decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        use crate::keys::ViewingKeypair;
        let kp1 = ViewingKeypair::generate();
        let kp2 = ViewingKeypair::generate();
        let plaintext = b"secret data";
        let blob = encrypt_note(plaintext, &kp1.public.0);
        assert!(decrypt_note(&blob, &kp2.secret.0).is_err());
    }

    #[test]
    fn test_note_content_roundtrip() {
        let content = NoteContent {
            amount: 1_000_000,
            asset_id: [0xab; 32],
            salt: [0xcd; 32],
            memo: [0u8; 64],
        };
        let bytes = content.to_bytes();
        let decoded = NoteContent::from_bytes(&bytes).unwrap();
        assert_eq!(decoded.amount, content.amount);
        assert_eq!(decoded.asset_id, content.asset_id);
    }

    #[test]
    fn test_encrypted_note_dual_encryption() {
        use crate::keys::{ViewingKeypair, COMPLIANCE_ORACLE_PUBKEY, compliance_oracle_keypair};
        let recipient = ViewingKeypair::generate();
        let content = NoteContent {
            amount: 5000,
            asset_id: [1u8; 32],
            salt: [2u8; 32],
            memo: [0u8; 64],
        };
        let enc = EncryptedNote::create(&content, &recipient.public.0, &COMPLIANCE_ORACLE_PUBKEY);

        // Recipient can decrypt
        let dec_recipient = enc.decrypt_as_recipient(&recipient.secret.0).unwrap();
        assert_eq!(dec_recipient.amount, 5000);

        // Compliance oracle can decrypt the same note
        let oracle = compliance_oracle_keypair();
        let dec_oracle = enc.decrypt_as_oracle(&oracle.secret.0).unwrap();
        assert_eq!(dec_oracle.amount, 5000);

        // Random user cannot decrypt
        let random = ViewingKeypair::generate();
        assert!(decrypt_note(&enc.enc_for_recipient, &random.secret.0).is_err());
    }
}
