//! # Obscura ZK Bridge — Ethereum → Obscura Network
//!
//! This crate implements the bridge module for the Obscura rollup.
//! It allows users to lock USDC on Ethereum and receive bridged-USDC
//! inside the Obscura privacy rollup.
//!
//! ## Architecture
//!
//! ```text
//!  Ethereum (Sepolia/Mainnet)         Obscura Rollup
//! ┌─────────────────────────┐        ┌──────────────────────────────┐
//! │  User calls             │        │  BridgeModule.call(          │
//! │  ObscuraBridge.deposit()│        │    ClaimDeposit { proof, .. })│
//! │         │               │        │         │                    │
//! │  USDC locked in         │        │  ZK proof verified (SP1)     │
//! │  deposits[id] storage   │  ZK    │         │                    │
//! │         │               │───────▶│  bridged-USDC minted to      │
//! │  DepositLocked event    │ proof  │  obscura_recipient           │
//! └─────────────────────────┘        └──────────────────────────────┘
//!         ▲                                   │
//!         │         Relayer                   │
//!         └── fetch deposit ← submit proof ───┘
//! ```
//!
//! ## Components
//!
//! - **`module.rs`**: Sovereign SDK module — handles `ClaimDeposit` call messages,
//!   verifies ZK proofs, mints bridged-USDC tokens, tracks processed deposits.
//!
//! - **`verifier.rs`**: SP1 proof verifier.
//!   Testnet: accepts mock proofs (`OBSbridge` prefix).
//!   Mainnet: verifies Groth16 proofs from the SP1 eth_deposit circuit.
//!
//! - **`relayer.rs`**: Off-chain relayer service.
//!   Watches Ethereum for DepositLocked events, generates SP1 proofs,
//!   submits ClaimDeposit transactions to the Obscura rollup.
//!
//! - **`types.rs`**: Shared types (BridgePublicInputs, ClaimDeposit, BridgeConfig).
//!
//! ## SP1 Circuit (crates/provers/sp1/guest-bridge/)
//!
//! The `eth_deposit` circuit proves:
//!   1. A finalized Ethereum block header is valid (beacon_block_root)
//!   2. ObscuraBridge.sol account exists in the state trie (MPT account proof)
//!   3. `deposits[depositId]` exists in the storage trie (MPT storage proof)
//!   4. The deposit is locked (status == 1) with amount > 0
//!
//! Public outputs committed: eth_block_hash, beacon_block_root,
//!   deposit_id, obscura_recipient, amount, bridge_contract.
//!
//! ## Phase 1 (current): Trusted relayer + mock ZK proofs
//!
//! The relayer is a single trusted operator (multisig in Phase 2).
//! ZK proofs are mocked on testnet for development speed.
//! The on-chain security model relies on the relayer's integrity.
//!
//! ## Phase 2: Full ZK with SP1 Helios
//!
//! SP1 Helios (by Succinct) proves Ethereum beacon chain consensus.
//! Combined with our storage proofs, this gives trustless verification:
//! - No trusted relayer needed — anyone can submit proofs
//! - Groth16 proofs verified on-chain in the Obscura STF
//! - Compatible with Celestia's Lazybridging initiative (ZK-IBC)

pub mod module;
pub mod types;
pub mod verifier;
pub mod helios;
pub mod helios_types;

#[cfg(feature = "relayer")]
pub mod beacon_api;
#[cfg(feature = "relayer")]
pub mod relayer;
