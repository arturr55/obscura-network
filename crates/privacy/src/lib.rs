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
    Context, EventEmitter, Module, ModuleId, ModuleInfo, ModuleRestApi, Spec,
    StateMap, StateValue, StateVec, TxState,
};
use std::marker::PhantomData;

pub mod types;
pub mod zk;

/// SP1 proof generation (Phase 2, requires `sp1` feature).
/// Use prove_transfer(), prove_unshield(), prove_compliance() to generate real ZK proofs.
#[cfg(feature = "sp1")]
pub mod sp1_prover;

use types::{AssetId, Commitment, Note, Nullifier};

/// Obscura Privacy Module — shielded pool for private transactions on Celestia DA.
#[derive(Clone, ModuleInfo, ModuleRestApi)]
pub struct ObscuraPrivacy<S: Spec> {
    /// Module identifier
    #[id]
    pub id: ModuleId,

    /// Set of all commitments (Merkle leaf nodes) — public, but hiding
    /// Each commitment is H(amount, asset_id, owner_pubkey, salt)
    #[state]
    pub commitments: StateVec<Commitment>,

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

    #[phantom]
    pub phantom: PhantomData<S>,
}

impl<S: Spec> Module for ObscuraPrivacy<S> {
    type Spec = S;
    type Config = ();
    type CallMessage = CallMessage;
    type Event = PrivacyEvent;
    type Error = anyhow::Error;

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
        }
    }
}

impl<S: Spec> ObscuraPrivacy<S> {
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

        // Record the commitment in state (appended to Merkle tree)
        self.commitments.push(&commitment, state)?;

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
    /// Requires a ZK proof of validity.
    fn handle_transfer(
        &mut self,
        msg: TransferMessage,
        _context: &Context<S>,
        state: &mut impl TxState<S>,
    ) -> Result<()> {
        // Verify ZK proof
        zk::verify_transfer_proof(&msg.proof, &msg.public_inputs)?;

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

        // Add output commitments to the tree
        for commitment in &msg.output_commitments {
            self.commitments.push(commitment, state)?;
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
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct ShieldMessage {
    /// The note to shield (amount + asset_id + owner_pubkey + salt)
    pub note: Note,
}

#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct TransferMessage {
    /// ZK proof that inputs balance with outputs and sender knows spending keys
    pub proof: Vec<u8>,
    /// Public inputs for proof verification
    pub public_inputs: TransferPublicInputs,
    /// Nullifiers of spent input notes
    pub nullifiers: Vec<Nullifier>,
    /// New output commitments
    pub output_commitments: Vec<Commitment>,
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
}
