/// Public types for the Obscura ZK Bridge.
///
/// These types mirror the SP1 guest circuit's BridgePublicOutputs
/// but live in the Obscura rollup crate (no SP1 dependency).

use schemars::JsonSchema;
use sov_modules_api::macros::{serialize, UniversalWallet};

/// Public outputs committed by the SP1 bridge circuit.
/// Submitted by the relayer together with the ZK proof.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct BridgePublicInputs {
    /// keccak256 of the finalized Ethereum block header
    pub eth_block_hash: [u8; 32],

    /// EIP-4788 beacon block root that finalizes the execution block
    pub beacon_block_root: [u8; 32],

    /// Original deposit ID from ObscuraBridge.sol
    pub deposit_id: u64,

    /// Recipient address on Obscura Network (32 bytes)
    pub obscura_recipient: [u8; 32],

    /// USDC amount to mint (6 decimal places)
    pub amount: u64,

    /// ObscuraBridge.sol contract address (20 bytes)
    pub bridge_contract: [u8; 20],
}

/// A claimed deposit ready to be processed by the rollup.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct ClaimDeposit {
    /// SP1 proof bytes (Groth16 or Plonk for production, mock for testnet)
    pub proof: Vec<u8>,
    /// Public inputs committed by the circuit
    pub public_inputs: BridgePublicInputs,
}

/// A withdrawal request: burn bridged-USDC on Obscura, release USDC on Ethereum.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, UniversalWallet)]
#[serialize(Borsh, Serde)]
pub struct WithdrawBridge {
    /// The original deposit ID on Ethereum to unlock.
    pub deposit_id: u64,
    /// Ethereum address to receive the unlocked USDC (20 bytes).
    pub eth_recipient: [u8; 20],
}

/// Stored record of a pending/completed withdrawal.
#[derive(
    Debug, Clone, PartialEq,
    serde::Serialize, serde::Deserialize,
    borsh::BorshSerialize, borsh::BorshDeserialize,
    schemars::JsonSchema,
)]
pub struct WithdrawalRecord {
    pub withdrawal_id: u64,
    pub deposit_id: u64,
    pub eth_recipient: [u8; 20],
    pub amount: u64,
    pub relayed: bool,
}

/// Token denomination for bridged USDC on Obscura.
pub const BRIDGED_USDC_TOKEN_ID: &str = "bridged-usdc";

/// Obscura bridge config stored in rollup genesis.
#[derive(
    Debug, Clone, PartialEq,
    serde::Serialize, serde::Deserialize,
    borsh::BorshSerialize, borsh::BorshDeserialize,
    schemars::JsonSchema,
)]
pub struct BridgeConfig {
    /// ObscuraBridge.sol address on Ethereum (20 bytes, hex-encoded with 0x prefix)
    pub bridge_contract_address: String,

    /// SP1 verification key hash for the eth_deposit circuit
    pub vk_hash: [u8; 32],

    /// Maximum age of a beacon block root we accept (seconds).
    /// Prevents processing very old deposits. Default: 7 days.
    pub max_proof_age_secs: u64,

    /// Admin address that can update the config
    pub admin: Vec<u8>,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            bridge_contract_address: "0x0000000000000000000000000000000000000000".to_string(),
            vk_hash: [0u8; 32],
            max_proof_age_secs: 7 * 24 * 3600, // 7 days
            admin: vec![],
        }
    }
}
