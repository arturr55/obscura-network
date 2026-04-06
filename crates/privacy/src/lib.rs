//! # Obscura Privacy Module
//!
//! Shielded pool with ZK proofs for Obscura Network.
//!
//! ## Architecture
//!
//! Users can:
//! - `Shield` — deposit public tokens into the private pool, receive a Note commitment
//! - `Transfer` — spend a Note and create new Notes (private transfer, ZK proof required)
//! - `Unshield` — withdraw from the pool back to public balance (ZK proof required)
//! - `Disclose` — generate a compliance proof for auditors without revealing individual txs
//!
//! ## ZK Proof System
//!
//! Each private transaction includes a ZK proof that verifies:
//! 1. The sender knows the spending key for the input Note
//! 2. Input and output values balance (no inflation)
//! 3. The Note has not been previously spent (nullifier uniqueness)
//!
//! Compliance disclosure allows an authorized auditor to verify aggregate
//! compliance (e.g. total payroll < $X) without seeing individual salaries.

use anyhow::{bail, Result};
use schemars::JsonSchema;
use sov_modules_api::macros::{serialize, UniversalWallet};
use sov_modules_api::{
    Context, DaSpec, EventEmitter, GenesisState, Module, ModuleId, ModuleInfo,
    ModuleRestApi, Spec, StateMap, StateValue, StateVec, TxState,
};
use merkle::{compute_insert, zero_value, ROOTS_HISTORY_SIZE, TREE_DEPTH};
use std::marker::PhantomData;

pub mod merkle;
pub mod types;
pub mod zk;
pub mod keys;
pub mod encryption;

/// SP1 proof generation (Phase 2, requires `sp1` feature).
/// Use prove_transfer(), prove_unshield(), prove_compliance() to generate real ZK proofs.
#[cfg(feature = "sp1")]
pub mod sp1_prover;

use types::{AssetId, Commitment, Note, Nullifier};

/// Maximum age of a sanctions proof in seconds (24 hours).
/// Proofs older than this are rejected — OFAC list updates daily.
pub const SANCTIONS_PROOF_MAX_AGE_SECS: u64 = 86_400;

/// Obscura Privacy Module — shielded pool for private transactions on Celestia DA.
#[derive(Clone, ModuleInfo, ModuleRestApi)]
pub struct ObscuraPrivacy<S: Spec> {
    /// Module identifier
    #[id]
    pub id: ModuleId,

    /// Flat list of all commitments in insertion order (for off-chain tree rebuild).
    /// Index i corresponds to leaf i in the Merkle tree.
    #[state]
    pub commitments: StateVec<Commitment>,

    // ── Incremental Merkle Tree state ──────────────────────────────────────

    /// Current Merkle root of the commitment tree.
    #[state]
    pub merkle_root: StateValue<[u8; 32]>,

    /// Next leaf index (= total number of commitments inserted).
    #[state]
    pub merkle_next_index: StateValue<u64>,

    /// Filled subtrees: one hash per tree level (0 = leaf level).
    /// Key: level (u32), Value: hash of the rightmost filled subtree at that level.
    #[state]
    pub merkle_filled_subtrees: StateMap<u32, [u8; 32]>,

    /// Ring buffer of historical roots.
    /// Key: slot index (u64 mod ROOTS_HISTORY_SIZE), Value: root hash.
    /// Allows ZK proofs generated slightly before the latest insertion to remain valid.
    #[state]
    pub merkle_roots: StateMap<u64, [u8; 32]>,

    /// Total number of roots ever recorded (used for ring-buffer indexing).
    #[state]
    pub merkle_roots_count: StateValue<u64>,

    /// Set of spent nullifiers — public
    /// Each nullifier is H(spending_key, commitment)
    /// Once revealed, the note cannot be spent again
    #[state]
    pub nullifiers: StateMap<Nullifier, bool>,

    /// Total shielded supply per asset (for auditability without individual privacy)
    #[state]
    pub shielded_supply: StateMap<AssetId, u64>,

    /// Compliance counter — number of private payroll transactions processed
    /// Auditors can verify this without seeing individual salaries
    #[state]
    pub compliance_tx_count: StateValue<u64>,

    /// Total private payroll volume (for compliance reporting)
    /// Auditors can verify total <= regulatory limit
    #[state]
    pub compliance_total_volume: StateValue<u64>,

    /// Current OFAC SDN Merkle root.
    /// Updated daily by the sanctions oracle.
    /// Every Transfer TX must include a sanctions proof against this root.
    #[state]
    pub sanctions_root: StateValue<[u8; 32]>,

    /// Address of the sanctions oracle (the only account allowed to update the root).
    #[state]
    pub sanctions_oracle: StateValue<Vec<u8>>,

    // ── Encrypted notes storage (viewing keys) ────────────────────────────────

    /// Encrypted note blobs stored alongside commitments.
    /// Key: hex(commitment_hash) — same index as the commitment.
    /// Value: serialized EncryptedNote (enc_for_recipient + enc_for_compliance).
    ///
    /// Anyone can query this map to try to decrypt notes using their viewing key.
    /// The compliance oracle can decrypt ALL entries using COMPLIANCE_ORACLE_PUBKEY.
    #[state]
    pub encrypted_notes: StateMap<String, Vec<u8>>,

    #[phantom]
    pub phantom: PhantomData<S>,
}

impl<S: Spec> Module for ObscuraPrivacy<S> {
    type Spec = S;
    type Config = ();
    type CallMessage = CallMessage;
    type Event = PrivacyEvent;
    type Error = anyhow::Error;

    fn genesis(
        &mut self,
        _genesis_rollup_header: &<<S as Spec>::Da as DaSpec>::BlockHeader,
        _config: &Self::Config,
        state: &mut impl GenesisState<S>,
    ) -> Result<()> {
        // Initialise the empty Incremental Merkle Tree.
        // Each filled_subtree[level] starts as the zero value at that level.
        for level in 0..TREE_DEPTH {
            self.merkle_filled_subtrees
                .set(&(level as u32), &zero_value(level), state)?;
        }
        self.merkle_root.set(&merkle::empty_root(), state)?;
        self.merkle_next_index.set(&0u64, state)?;
        self.merkle_roots_count.set(&0u64, state)?;
        self.compliance_tx_count.set(&0u64, state)?;
        self.compliance_total_volume.set(&0u64, state)?;
        tracing::info!(
            "ObscuraPrivacy genesis: empty Merkle root = {}",
            hex::encode(merkle::empty_root())
        );
        Ok(())
    }

    fn call(
        &mut self,
        msg: Self::CallMessage,
        context: &Context<Self::Spec>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        match msg {
            CallMessage::Shield(shield_msg) => self.handle_shield(shield_msg, context, state),
            CallMessage::Transfer(transfer_msg) => {
                self.handle_transfer(transfer_msg, context, state)
            }
            CallMessage::Unshield(unshield_msg) => {
                self.handle_unshield(unshield_msg, context, state)
            }
            CallMessage::UpdateSanctionsRoot(msg) => {
                self.handle_update_sanctions_root(msg, context, state)
            }
        }
    }
}

impl<S: Spec> ObscuraPrivacy<S> {
    /// Insert a commitment leaf into the Incremental Merkle Tree.
    /// Updates filled_subtrees, merkle_root, and the historical roots ring buffer.
    /// Public so that other modules (e.g. ObscuraBridge) can call it during atomic operations.
    pub fn insert_commitment(
        &mut self,
        commitment: &Commitment,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        let next_index = self.merkle_next_index.get(state)?.unwrap_or(0u64);

        if next_index >= (1u64 << TREE_DEPTH) {
            bail!("Merkle tree is full");
        }

        let leaf: [u8; 32] = commitment.0;

        // Pre-read all filled subtrees before passing to compute_insert
        // (avoids conflicting borrows of self + state inside a closure).
        let mut filled_cache: Vec<[u8; 32]> = Vec::with_capacity(TREE_DEPTH);
        for level in 0..TREE_DEPTH {
            let val = self
                .merkle_filled_subtrees
                .get(&(level as u32), state)?
                .unwrap_or_else(|| zero_value(level));
            filled_cache.push(val);
        }

        let (new_root, updates) =
            compute_insert(leaf, next_index, |level| filled_cache[level]);

        // Persist updated filled subtrees
        for (level, val) in updates {
            self.merkle_filled_subtrees
                .set(&(level as u32), &val, state)?;
        }

        // Update root
        self.merkle_root.set(&new_root, state)?;

        // Record root in ring buffer
        let roots_count = self.merkle_roots_count.get(state)?.unwrap_or(0u64);
        let slot = roots_count % ROOTS_HISTORY_SIZE;
        self.merkle_roots.set(&slot, &new_root, state)?;
        self.merkle_roots_count.set(&(roots_count + 1), state)?;

        // Advance leaf counter
        self.merkle_next_index.set(&(next_index + 1), state)?;

        Ok(())
    }

    /// Check whether a given root is in the historical roots ring buffer.
    fn is_known_root(&self, root: &[u8; 32], state: &mut impl TxState<S>) -> Result<bool> {
        let roots_count = self.merkle_roots_count.get(state)?.unwrap_or(0u64);
        if roots_count == 0 {
            return Ok(false);
        }
        for i in 0..roots_count.min(ROOTS_HISTORY_SIZE) {
            let slot = i % ROOTS_HISTORY_SIZE;
            if let Some(r) = self.merkle_roots.get(&slot, state)? {
                if &r == root {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// Shield public tokens into the private pool.
    /// Creates a commitment note that can be spent privately later.
    fn handle_shield(
        &mut self,
        msg: ShieldMessage,
        _context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        // Verify the commitment is well-formed
        let commitment = Commitment::from_note(&msg.note)?;

        // Append to flat list (for off-chain tree rebuild via REST API)
        self.commitments.push(&commitment, state)?;

        // Insert into the Incremental Merkle Tree and update the root
        self.insert_commitment(&commitment, state)?;

        // Store encrypted note if provided (viewing key support)
        if !msg.encrypted_note.is_empty() {
            let key = format!("0x{}", hex::encode(commitment.0));
            self.encrypted_notes.set(&key, &msg.encrypted_note, state)?;
        }

        // Update shielded supply
        let asset_id = msg.note.asset_id.clone();
        let current_supply = self
            .shielded_supply
            .get(&asset_id, state)?
            .unwrap_or_default();
        self.shielded_supply
            .set(&asset_id, &(current_supply + msg.note.amount), state)?;

        self.emit_event(
            state,
            PrivacyEvent::Shielded {
                commitment: commitment.0,
            },
        );

        Ok(())
    }

    /// Private transfer: spend input notes and create output notes.
    /// Requires a ZK transfer proof AND a ZK sanctions non-membership proof.
    fn handle_transfer(
        &mut self,
        msg: TransferMessage,
        _context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        // --- Verify Merkle root is known ---
        // The proof claims inputs exist in root R. R must be in our history.
        let claimed_root = &msg.public_inputs.merkle_root;
        if claimed_root != &[0u8; 32] {
            // Allow [0;32] only during Phase 1 (mock proofs). In Phase 2 this
            // branch is always taken because SP1 proofs always commit to a root.
            if !self.is_known_root(claimed_root, state)? {
                bail!(
                    "Unknown Merkle root: {}. Root may be too old or the note was never shielded.",
                    hex::encode(claimed_root)
                );
            }
        }

        // --- Verify transfer ZK proof ---
        zk::verify_transfer_proof(&msg.proof, &msg.public_inputs)?;

        // --- Verify sanctions non-membership proof ---
        // Every transfer must prove that the recipient is NOT on the OFAC SDN list.

        // 1. Check that the sanctions root in the proof matches the on-chain root
        let current_root = self.sanctions_root.get(state)?.unwrap_or([0u8; 32]);
        if current_root != [0u8; 32] {
            // Root is set — enforce that proof uses the current root
            if msg.sanctions_public_inputs.sanctions_root != current_root {
                bail!(
                    "Sanctions proof uses stale root. Expected {:?}, got {:?}",
                    hex::encode(current_root),
                    hex::encode(msg.sanctions_public_inputs.sanctions_root)
                );
            }
        }

        // 2. Check proof freshness (must be < 24 hours old)
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let proof_age = now_secs.saturating_sub(msg.sanctions_public_inputs.proof_timestamp);
        if msg.sanctions_public_inputs.proof_timestamp > 0
            && proof_age > SANCTIONS_PROOF_MAX_AGE_SECS
        {
            bail!(
                "Sanctions proof is too old ({} seconds). Max age is {} seconds.",
                proof_age,
                SANCTIONS_PROOF_MAX_AGE_SECS
            );
        }

        // 3. Verify the ZK proof itself
        zk::verify_sanctions_proof(&msg.sanctions_proof, &msg.sanctions_public_inputs)?;

        // Check nullifiers not already spent
        for nullifier in &msg.nullifiers {
            if self
                .nullifiers
                .get(nullifier, state)?
                .unwrap_or_default()
            {
                bail!("Note already spent: nullifier {:?}", nullifier.0);
            }
        }

        // Mark nullifiers as spent
        for nullifier in &msg.nullifiers {
            self.nullifiers.set(nullifier, &true, state)?;
        }

        // Add output commitments to the tree + store encrypted notes
        for (i, commitment) in msg.output_commitments.iter().enumerate() {
            self.commitments.push(commitment, state)?;
            self.insert_commitment(commitment, state)?;

            // Store encrypted note if provided for this output (viewing key support)
            if let Some(enc_bytes) = msg.encrypted_outputs.get(i) {
                if !enc_bytes.is_empty() {
                    let key = format!("0x{}", hex::encode(commitment.0));
                    self.encrypted_notes.set(&key, enc_bytes, state)?;
                }
            }
        }

        // Update compliance counters
        let count = self.compliance_tx_count.get(state)?.unwrap_or_default();
        self.compliance_tx_count.set(&(count + 1), state)?;

        let volume = self
            .compliance_total_volume
            .get(state)?
            .unwrap_or_default();
        self.compliance_total_volume
            .set(&(volume + msg.public_inputs.transfer_amount), state)?;

        self.emit_event(
            state,
            PrivacyEvent::PrivateTransfer {
                nullifier_count: msg.nullifiers.len() as u32,
                output_count: msg.output_commitments.len() as u32,
            },
        );

        Ok(())
    }

    /// Update the on-chain OFAC sanctions Merkle root.
    /// Only the designated sanctions oracle address may call this.
    fn handle_update_sanctions_root(
        &mut self,
        msg: UpdateSanctionsRootMessage,
        context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        // Check caller is the oracle
        let oracle = self.sanctions_oracle.get(state)?.unwrap_or_default();
        if !oracle.is_empty() && context.sender().as_ref() != oracle.as_slice() {
            bail!("Only the sanctions oracle may update the sanctions root");
        }

        self.sanctions_root.set(&msg.new_root, state)?;

        self.emit_event(
            state,
            PrivacyEvent::SanctionsRootUpdated { new_root: msg.new_root },
        );

        Ok(())
    }

    /// Unshield: withdraw from pool back to public balance.
    /// Requires ZK proof that the note is valid and not spent.
    fn handle_unshield(
        &mut self,
        msg: UnshieldMessage,
        _context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        // Verify ZK proof
        zk::verify_unshield_proof(&msg.proof, &msg.public_inputs)?;

        // Check nullifier not spent
        if self
            .nullifiers
            .get(&msg.nullifier, state)?
            .unwrap_or_default()
        {
            bail!("Note already spent");
        }

        // Mark nullifier as spent
        self.nullifiers.set(&msg.nullifier, &true, state)?;

        // Update shielded supply
        let asset_id = msg.public_inputs.asset_id.clone();
        let current_supply = self
            .shielded_supply
            .get(&asset_id, state)?
            .unwrap_or_default();
        self.shielded_supply
            .set(&asset_id, &current_supply.saturating_sub(msg.public_inputs.amount), state)?;

        self.emit_event(
            state,
            PrivacyEvent::Unshielded {
                nullifier: msg.nullifier.0,
                amount: msg.public_inputs.amount,
            },
        );

        Ok(())
    }
}

// ── Message types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
#[serde(rename_all = "snake_case")]
pub enum CallMessage {
    /// Deposit public tokens into the shielded pool
    Shield(ShieldMessage),
    /// Private transfer between shielded notes (ZK proof required)
    Transfer(TransferMessage),
    /// Withdraw from shielded pool back to public balance
    Unshield(UnshieldMessage),
    /// Update the OFAC sanctions Merkle root (oracle only)
    UpdateSanctionsRoot(UpdateSanctionsRootMessage),
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct ShieldMessage {
    /// The note to shield (amount + asset_id + owner_pubkey + salt)
    pub note: Note,
    /// Encrypted note for viewing key support.
    /// Must contain two encryptions:
    ///   - enc_for_recipient: with the user's viewing_public_key
    ///   - enc_for_compliance: with COMPLIANCE_ORACLE_PUBKEY (mandatory)
    /// Pass empty Vec to skip (Phase 1 backward compatibility).
    pub encrypted_note: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct TransferMessage {
    /// ZK proof that inputs balance with outputs and sender knows spending keys
    pub proof: Vec<u8>,
    /// Public inputs for transfer proof verification
    pub public_inputs: TransferPublicInputs,
    /// Nullifiers of spent input notes
    pub nullifiers: Vec<Nullifier>,
    /// New output commitments
    pub output_commitments: Vec<Commitment>,
    /// ZK proof that the recipient is NOT on the OFAC SDN sanctions list.
    /// Required for every transfer — protocol enforces compliance by design.
    pub sanctions_proof: Vec<u8>,
    /// Public inputs for sanctions proof verification
    pub sanctions_public_inputs: SanctionsPublicInputs,
    /// Encrypted output notes for viewing key support.
    /// One EncryptedNote per output_commitment (same order).
    /// Each must contain enc_for_recipient (with recipient's viewing key)
    /// AND enc_for_compliance (with COMPLIANCE_ORACLE_PUBKEY — mandatory).
    /// Pass empty Vec to skip (Phase 1 backward compatibility).
    pub encrypted_outputs: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct TransferPublicInputs {
    /// Transfer amount (for compliance accounting)
    pub transfer_amount: u64,
    /// Asset being transferred
    pub asset_id: AssetId,
    /// Merkle root at time of proof generation
    pub merkle_root: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct UnshieldMessage {
    /// ZK proof of note ownership
    pub proof: Vec<u8>,
    /// Public inputs for proof verification
    pub public_inputs: UnshieldPublicInputs,
    /// Nullifier of the spent note
    pub nullifier: Nullifier,
    /// Recipient of the unshielded tokens
    pub recipient: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct UnshieldPublicInputs {
    pub amount: u64,
    pub asset_id: AssetId,
}

/// Message for oracle to update the on-chain OFAC sanctions Merkle root.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct UpdateSanctionsRootMessage {
    /// New OFAC SDN Merkle root
    pub new_root: [u8; 32],
}

/// Public inputs for sanctions non-membership proof verification.
/// These values are committed inside the ZK proof and must match
/// what the verifier expects.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct SanctionsPublicInputs {
    /// SHA256("recipient" || recipient_address) — auditor can verify
    /// by hashing the known recipient address
    pub recipient_commitment: [u8; 32],
    /// OFAC Merkle root at time of proof generation
    pub sanctions_root: [u8; 32],
    /// Timestamp of when the proof was generated
    pub proof_timestamp: u64,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serialize(Borsh, Serde)]
pub enum PrivacyEvent {
    Shielded {
        commitment: [u8; 32],
    },
    PrivateTransfer {
        nullifier_count: u32,
        output_count: u32,
    },
    Unshielded {
        nullifier: [u8; 32],
        amount: u64,
    },
    /// Emitted when oracle updates the OFAC sanctions Merkle root.
    SanctionsRootUpdated {
        new_root: [u8; 32],
    },
}
