/// Public types for the Helios light client module in the Obscura ZK Bridge.
///
/// These types are used on the rollup (host) side to track trusted Ethereum
/// beacon state. They mirror the SP1 guest circuit's `HeliosPublicOutputs`.

use schemars::JsonSchema;
use sov_modules_api::macros::{serialize, UniversalWallet};

/// Public inputs committed by the SP1 Helios circuit.
///
/// Submitted by the relayer together with the Helios ZK proof.
/// The rollup verifies:
///   1. `prev_trusted_root` matches the stored `trusted_beacon_root`
///   2. The ZK proof is valid
///   3. Updates `trusted_beacon_root` to `new_beacon_root`
///   4. Marks `execution_block_hash` as finalized (bridge can now use it)
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct HeliosPublicInputs {
    /// The previous trusted beacon root — must match rollup's current trusted root.
    /// Acts as a chain link to prevent out-of-order or replayed updates.
    pub prev_trusted_root: [u8; 32],

    /// The new finalized beacon root (= hash_tree_root of the finalized beacon header).
    /// The rollup updates its `trusted_beacon_root` to this after proof verification.
    pub new_beacon_root: [u8; 32],

    /// The slot number of the newly finalized beacon block.
    /// Must be strictly greater than the rollup's current `trusted_slot`.
    pub new_slot: u64,

    /// The Ethereum execution block hash proven to be finalized.
    /// The rollup adds this to `finalized_eth_blocks` set.
    /// The bridge then accepts deposits proven in this execution block trustlessly.
    pub execution_block_hash: [u8; 32],
}

/// A Helios head update — submitted by the relayer to advance the trusted beacon root.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct UpdateHeliosHead {
    /// SP1 Helios proof bytes (mock prefix on testnet, real Groth16 on mainnet).
    pub proof: Vec<u8>,

    /// Public inputs committed by the circuit (verified against proof).
    pub public_inputs: HeliosPublicInputs,
}

/// Helios module configuration stored in rollup genesis.
#[derive(
    Debug, Clone, PartialEq,
    serde::Serialize, serde::Deserialize,
    borsh::BorshSerialize, borsh::BorshDeserialize,
    schemars::JsonSchema,
)]
pub struct HeliosConfig {
    /// The initial trusted beacon root (from a known checkpoint at genesis).
    /// Must be obtained from a trusted source (e.g., a recently finalized block
    /// on the Ethereum beacon chain that you verified manually).
    pub initial_trusted_beacon_root: [u8; 32],

    /// The slot corresponding to the initial trusted beacon root.
    pub initial_trusted_slot: u64,

    /// Maximum number of slots allowed between consecutive Helios updates.
    /// If this limit is exceeded, deposits using the old trusted root are rejected.
    /// Default: 8192 slots (~27 hours at 12s/slot).
    pub max_slot_gap: u64,
}

impl Default for HeliosConfig {
    fn default() -> Self {
        Self {
            initial_trusted_beacon_root: [0u8; 32],
            initial_trusted_slot: 0,
            max_slot_gap: 8192,
        }
    }
}
