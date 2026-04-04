# Obscura Network

> Privacy-first ZK Rollup on Celestia — shielded transactions with compliance by design.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chain ID](https://img.shields.io/badge/Chain%20ID-9977-purple.svg)](docs/WHITEPAPER.md)
[![DA](https://img.shields.io/badge/DA-Celestia-orange.svg)](https://celestia.org)

## What is Obscura?

Obscura Network is a modular ZK rollup where transactions are **private by default**,
but auditors can verify compliance using **zero-knowledge proofs** — without seeing
individual transaction amounts or participants.

```
User A ──[shield 1000 USDC]──► Shielded Pool ──[ZK proof]──► User B
                                     │
                            Auditor requests compliance proof
                                     │
                            ✅ "Total payroll = $X, within limits"
                            (without seeing individual salaries)
```

## Architecture

| Layer | Technology |
|---|---|
| Data Availability | Celestia (namespace: `obscura--b`) |
| Execution | Sovereign SDK + EVM (Chain ID: 9977) |
| Privacy | Obscura Privacy Module (shielded pool) |
| ZK Proofs | SP1 (Succinct) — Phase 2 |
| Settlement | Ethereum (Phase 2) |

## Getting Started

### Prerequisites

- Rust 1.93+
- Node.js 20+

### Run locally (mock DA)

```bash
git clone https://github.com/arturr55/obscura-network
cd obscura-network
cargo run
```

The node starts at `http://127.0.0.1:12346`

### Run on Celestia Mocha testnet

See [GETTING_STARTED_WITH_CELESTIA.md](GETTING_STARTED_WITH_CELESTIA.md)

## Modules

### `crates/privacy` — Obscura Privacy Module

The core privacy module implementing:
- **Shielded Pool** — deposit tokens, get private Notes
- **Private Transfers** — spend Notes with ZK proofs
- **Compliance Oracle** — generate ZK compliance proofs for auditors

```rust
// Shield tokens into the private pool
CallMessage::Shield(ShieldMessage { note })

// Transfer privately (ZK proof required)
CallMessage::Transfer(TransferMessage { proof, nullifiers, output_commitments, .. })

// Withdraw back to public balance
CallMessage::Unshield(UnshieldMessage { proof, nullifier, recipient, .. })
```

### `crates/stf` — State Transition Function

Standard Sovereign SDK STF with EVM execution + Obscura Privacy Module.

## Killer App: ZKCompliance

The first application built on Obscura Network is [ZKCompliance Protocol](https://github.com/arturr55/zkcompliance-protocol) — private corporate payroll with compliance proofs.

## Roadmap

- [x] Phase 1: Rollup node + Privacy Module (testnet)
- [ ] Phase 2: SP1 ZK proofs + Ethereum settlement
- [ ] Phase 3: Mainnet + OBS token

## Whitepaper

See [docs/WHITEPAPER.md](docs/WHITEPAPER.md)

## License

MIT
