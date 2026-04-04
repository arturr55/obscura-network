# Obscura Network — Whitepaper v0.1

**Privacy-first ZK Rollup on Celestia**
*Shielded transactions. Compliance by design.*

---

## Abstract

Obscura Network is a modular ZK rollup built on Celestia's data availability layer. It provides
private-by-default transactions with selective compliance disclosure — enabling institutions
to transact privately while satisfying regulatory requirements without compromising user privacy.

---

## 1. The Problem

Existing blockchains face an irreconcilable tension:

| Property | Public chains | Privacy coins | Obscura |
|---|---|---|---|
| Transaction privacy | ❌ All visible | ✅ Hidden | ✅ Hidden |
| Compliance proofs | ✅ Trivial (all visible) | ❌ Impossible | ✅ ZK proofs |
| Institutional adoption | ❌ Privacy concerns | ❌ Regulatory risk | ✅ Both |
| Scalability | ❌ L1 limits | ❌ L1 limits | ✅ Rollup |

Companies cannot put payroll, treasury, or supply chain payments on public blockchains because
competitors and employees can see exact amounts. Privacy coins (Monero, Zcash) solve this
but create regulatory nightmares — auditors cannot verify compliance.

**Obscura solves both problems simultaneously.**

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Obscura Network                     │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         EVM Execution Layer                  │    │
│  │   (standard Ethereum-compatible contracts)   │    │
│  └─────────────────────────────────────────────┘    │
│                       +                              │
│  ┌─────────────────────────────────────────────┐    │
│  │         Obscura Privacy Module               │    │
│  │   Shielded Pool  │  Compliance Oracle        │    │
│  │   ZK Transfers   │  Selective Disclosure     │    │
│  └─────────────────────────────────────────────┘    │
│                       │                              │
│              Sovereign SDK Runtime                   │
└───────────────────────┼─────────────────────────────┘
                        │ DA
              ┌─────────▼─────────┐
              │   Celestia DA     │
              │  (Mocha Testnet)  │
              └───────────────────┘
                        │ Settlement
              ┌─────────▼─────────┐
              │ Ethereum Sepolia  │
              │  ZK Proof Verify  │
              └───────────────────┘
```

### 2.1 Data Availability — Celestia

Obscura posts transaction data to Celestia's Mocha testnet.
Celestia provides cheap, scalable DA without requiring full nodes to re-execute every transaction.

Namespace: `obscura--b` (transactions), `obscura--p` (ZK proofs)
Chain ID: `9977`

### 2.2 Execution — Sovereign SDK + EVM

The execution environment is EVM-compatible (all Ethereum tools work).
Built on Sovereign SDK — the same infrastructure powering production rollups with:
- 1.2ms transaction confirmations
- 30,000+ user operations per second

### 2.3 Privacy Layer — Shielded Pool

The Obscura Privacy Module implements a UTXO-based shielded pool:

**Notes** — private balance units (kept secret by owner)
```
Note = { amount, asset_id, owner_pubkey, salt }
```

**Commitments** — public fingerprints of notes (safe to publish)
```
Commitment = SHA256(amount || asset_id || owner_pubkey || salt)
```

**Nullifiers** — revealed when spending (prevents double-spend)
```
Nullifier = SHA256(spending_key || commitment)
```

### 2.4 ZK Proofs — SP1 (Succinct)

Private transfers require a ZK proof verifying:
1. Sender knows `spending_key` for each input note
2. `sum(inputs) == sum(outputs)` — no inflation
3. Each input commitment is in the Merkle tree
4. Nullifiers are correctly derived

Proof generation runs off-chain (user's device or prover service).
Verification runs on-chain in O(1) time regardless of transaction complexity.

**Phase 1:** Mock verifier (testnet)
**Phase 2:** SP1 groth16 proofs, verified on Ethereum Sepolia

---

## 3. Compliance Disclosure

### The core innovation: you can be private AND compliant simultaneously.

An auditor (regulator, tax authority, employer) can request a ZK proof proving:
- "Total payroll for Q1 = $X" — without seeing individual salaries
- "All transfers are within FATF Travel Rule limits" — without seeing sender/receiver
- "No single transaction > $10,000" — without seeing any transaction

```
User/Company                    Auditor
     │                              │
     │   Request compliance proof   │
     │◄─────────────────────────────│
     │                              │
     │   Generate ZK proof off-chain│
     │   (using private key + notes)│
     │                              │
     │   Submit proof               │
     │──────────────────────────────►│
     │                              │
     │         ✅ Verified           │
     │         (without seeing any  │
     │          individual txs)     │
```

This directly implements FATF Recommendation 16 (Travel Rule) and GDPR Article 25
(Privacy by Design) simultaneously.

---

## 4. Use Cases

### 4.1 Corporate Payroll (ZKCompliance Protocol)
- Companies pay salaries in stablecoins, privately
- Auditors verify payroll compliance via ZK proofs
- Employees cannot see each other's salaries

### 4.2 DAO Treasury Management
- DAO votes on budget allocation
- Execution is private (prevents front-running)
- Compliance proof available to governance participants

### 4.3 Supply Chain Finance
- B2B payments hidden from competitors
- Regulators can audit without seeing business intelligence

### 4.4 DeFi Institutional
- Institutional traders execute without market impact
- Portfolio privacy with exchange compliance

---

## 5. Tokenomics

**OBS Token** (native gas token)

| Allocation | % | Vesting |
|---|---|---|
| Community & Ecosystem | 40% | 4 years linear |
| Team | 20% | 1 year cliff + 3 years |
| Investors | 15% | 6 month cliff + 2 years |
| Treasury | 15% | DAO governed |
| Initial liquidity | 10% | Unlocked at launch |

Gas fees on Obscura are paid in OBS.
10% of base fees are burned (EIP-1559 model).

---

## 6. Roadmap

### Phase 1 — Testnet (Q2 2026)
- [x] Sovereign SDK rollup node
- [x] Obscura Privacy Module (shielded pool)
- [x] ZKCompliance killer app
- [ ] Celestia Mocha testnet deployment
- [ ] Mock ZK proofs (testnet only)
- [ ] Block explorer

### Phase 2 — ZK Integration (Q3 2026)
- [ ] SP1 real ZK proofs
- [ ] Ethereum Sepolia settlement
- [ ] @obscura/sdk npm package
- [ ] FATF Travel Rule compliance proofs
- [ ] Gnosis Safe module

### Phase 3 — Mainnet (Q4 2026)
- [ ] Celestia mainnet
- [ ] Ethereum mainnet settlement
- [ ] OBS token launch
- [ ] Exchange listings

---

## 7. Team

**Artur Akhmedshin** — Founder & Lead Developer
- ZKCompliance Protocol (38/38 tests, live demo)
- 5+ years full-stack development
- Contact: tirionartur@gmail.com

---

## 8. Grant Request

Seeking **$30,000 - $50,000** from:
- Celestia Foundation (modular rollup infrastructure)
- Ethereum Foundation ESP (privacy + compliance tooling)
- Succinct Labs (SP1 proof system integration)

**Deliverables:**
1. Production-ready Obscura Network testnet
2. @obscura/sdk TypeScript package
3. ZKCompliance as reference app
4. Open-source under MIT license

---

## References

- Sovereign SDK: https://sovereign.xyz
- Celestia DA: https://celestia.org
- SP1 Prover: https://succinct.xyz
- ZKCompliance Protocol: https://github.com/arturr55/zkcompliance-protocol
- FATF Travel Rule: https://www.fatf-gafi.org/en/publications/Fatfrecommendations/R16.html
