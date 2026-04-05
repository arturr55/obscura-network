/// Types shared by the bridge SP1 circuit and the Obscura bridge module.
///
/// The circuit proves that a USDC deposit was locked in ObscuraBridge.sol
/// on Ethereum and is now eligible for minting bridged-USDC on Obscura.

use serde::{Deserialize, Serialize};

/// A single RLP-encoded node in an Ethereum Merkle-Patricia Trie.
pub type MptNode = Vec<u8>;

/// Ethereum account proof — proves an account exists in the state trie.
/// Each element is an RLP-encoded trie node from root to leaf.
pub type AccountProof = Vec<MptNode>;

/// Ethereum storage proof — proves a single storage slot value.
pub type StorageProof = Vec<MptNode>;

/// A simplified Ethereum block header (only fields needed for the ZK circuit).
/// We prove this header is final by checking it against a trusted beacon root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EthBlockHeader {
    /// keccak256 of the parent block header
    pub parent_hash: [u8; 32],
    /// Merkle root of the state trie at this block
    pub state_root: [u8; 32],
    /// Block number
    pub number: u64,
    /// Block timestamp (Unix seconds)
    pub timestamp: u64,
    /// RLP-encoded full header bytes (for computing the block hash)
    pub rlp_encoded: Vec<u8>,
}

/// The full witness given to the bridge ZK circuit.
///
/// Prover must supply:
/// - The finalized Ethereum block header (state_root used for proof verification)
/// - Ethereum beacon block root that finalizes this execution block
///   (this root is posted on-chain via EIP-4788, available to any smart contract)
/// - MPT account proof: proves ObscuraBridge.sol has the given storage root
/// - MPT storage proof: proves deposits[depositId] slot has the given value
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeDepositWitness {
    /// Finalized Ethereum execution block header
    pub eth_block: EthBlockHeader,

    /// EIP-4788 beacon block root that finalizes `eth_block`.
    /// The relayer fetches this from the beacon chain API.
    /// In Phase 1 (testnet) this is trusted; Phase 2 uses SP1 Helios.
    pub beacon_block_root: [u8; 32],

    /// Address of ObscuraBridge.sol (20 bytes, left-padded to 32)
    pub bridge_contract: [u8; 20],

    /// MPT proof: eth_block.state_root → bridge_contract account
    pub account_proof: AccountProof,

    /// Storage root of the bridge contract (from the account proof leaf)
    pub storage_root: [u8; 32],

    /// Deposit ID being claimed
    pub deposit_id: u64,

    /// MPT proof: storage_root → deposits[deposit_id] slot
    pub storage_proof: StorageProof,

    /// Packed storage value for deposits[deposit_id]:
    ///   slot 0 (bytes 0..20):  sender address
    ///   slot 1 (bytes 32..64): obscuraRecipient
    ///   slot 2 (bytes 64..96): amount
    ///   slot 3 (bytes 96..104): timestamp (u64)
    ///   slot 3 (byte 104):     status (u8, must == 1 = locked)
    pub deposit_data: DepositData,
}

/// Decoded deposit fields from the storage slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositData {
    pub sender: [u8; 20],
    pub obscura_recipient: [u8; 32],
    pub amount: u64,   // USDC in 6-decimal units (max ~1M USDC fits u64)
    pub timestamp: u64,
    pub status: u8,    // must be 1 (locked) for a valid claim
}

/// Public outputs committed by the ZK circuit.
/// The Obscura rollup reads these to mint bridged-USDC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgePublicOutputs {
    /// keccak256 of the finalized Ethereum block header
    pub eth_block_hash: [u8; 32],

    /// The beacon block root that finalizes this execution block
    pub beacon_block_root: [u8; 32],

    /// Deposit ID (unique per bridge contract)
    pub deposit_id: u64,

    /// Recipient on Obscura Network
    pub obscura_recipient: [u8; 32],

    /// USDC amount to mint (6 decimals)
    pub amount: u64,

    /// The bridge contract address whose storage was proved
    pub bridge_contract: [u8; 20],
}
