import Link from "next/link";
import { ViewingKeyGenerator } from "@/components/ViewingKeyGenerator";

export const metadata = {
  title: "ZKCompliance — Privacy + Compliance for Enterprise | Obscura Network",
  description:
    "The only privacy rollup with built-in compliance. ZK proofs let your business send private transactions while staying fully OFAC-compliant.",
};

const USE_CASES = [
  {
    icon: "💼",
    title: "Private Payroll",
    subtitle: "For crypto-native companies",
    body: "Pay salaries in stablecoins without exposing amounts on-chain. Each payment generates a ZK compliance proof: regulator sees that salary ≤ threshold — without seeing the actual number or recipient.",
  },
  {
    icon: "🏛",
    title: "DAO Treasury",
    subtitle: "Private vendor & contractor payments",
    body: "Treasury decisions shouldn't front-run your token price. Pay contractors privately. Auditors receive ZK compliance proofs, not raw transaction data.",
  },
  {
    icon: "🤝",
    title: "M&A & Investments",
    subtitle: "Confidential on-chain deals",
    body: "Crypto fund investments visible on-chain move markets. With Obscura, transfer funds privately. Generate proof of transaction post-close when disclosure is required.",
  },
  {
    icon: "🏦",
    title: "Institutional DeFi",
    subtitle: "Regulatory-friendly participation",
    body: "Banks and regulated entities can't touch Tornado Cash. Obscura's compliance oracle provides non-membership proofs against OFAC SDN list — every transfer is provably clean.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Shield",
    desc: "Bridge USDC into Obscura. Funds enter the shielded pool — your balance becomes a ZK note (commitment + nullifier), invisible on-chain.",
  },
  {
    step: "02",
    title: "Transfer Privately",
    desc: "Send shielded notes to any recipient. The OFAC oracle checks both addresses against the SDN list and attaches a non-membership proof to every transfer.",
  },
  {
    step: "03",
    title: "Compliance Proof",
    desc: "SP1 Groth16 proof certifies: transfer happened, parties are not sanctioned, amount is within limits. No raw data revealed — just the proof.",
  },
  {
    step: "04",
    title: "Unshield / Withdraw",
    desc: "Recipient unshields funds back to Ethereum. Bridge verifies the ZK proof on-chain. Full audit trail available — but only to authorized viewers.",
  },
];

const COMPARISON = [
  { feature: "Private by default", obscura: true, aztec: true, tornado: true, manta: true },
  { feature: "OFAC compliance proof", obscura: true, aztec: false, tornado: false, manta: false },
  { feature: "ZK non-membership proof", obscura: true, aztec: false, tornado: false, manta: false },
  { feature: "Viewing keys (auditor)", obscura: true, aztec: true, tornado: false, manta: false },
  { feature: "Full-stack (rollup+bridge+dApp+SDK)", obscura: true, aztec: false, tornado: false, manta: false },
  { feature: "DA on Celestia", obscura: true, aztec: false, tornado: false, manta: false },
  { feature: "Legally usable (not OFAC-blocked)", obscura: true, aztec: "?", tornado: false, manta: true },
];

function Check({ val }: { val: boolean | string }) {
  if (val === true) return <span className="text-green-400 font-bold">✓</span>;
  if (val === false) return <span className="text-red-500">✗</span>;
  return <span className="text-yellow-400">{val}</span>;
}

const TECH_STACK = [
  ["DA Layer", "Celestia (Mocha-4 testnet)"],
  ["Execution", "Sovereign SDK ZK Rollup"],
  ["ZK Proofs", "SP1 / Groth16 (Succinct)"],
  ["Compliance Oracle", "OFAC SDN Merkle tree, refreshed daily"],
  ["Bridge", "ObscuraBridge.sol on Ethereum Sepolia"],
  ["Privacy Module", "Shielded pool: Shield / Transfer / Unshield"],
  ["SDK", "@obscura-network/sdk (TypeScript)"],
  ["Chain ID", "9977"],
];

export default function CompliancePage() {
  return (
    <main className="bg-obscura-dark text-white">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-green-900/30 border border-green-700/40 rounded-full px-4 py-1.5 text-sm text-green-300 mb-6">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Protocol-native compliance — not a bolt-on
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Every blockchain gives you{" "}
          <span className="line-through text-gray-500">privacy OR compliance</span>
          <br />
          <span className="bg-gradient-to-r from-purple-400 to-green-400 bg-clip-text text-transparent">
            Obscura does both.
          </span>
        </h1>
        <p className="text-xl text-gray-400 mb-4 max-w-3xl mx-auto">
          ZK proofs shield your transactions from public view while proving OFAC compliance
          to regulators — without revealing amounts, addresses, or counterparties.
        </p>
        <p className="text-gray-500 mb-10 max-w-2xl mx-auto">
          Most privacy projects ship only a protocol. Obscura ships the full stack:
          rollup + bridge + dApp + compliance oracle + SDK.
          One integration. Everything included.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/send"
            className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            Try the Demo
          </Link>
          <a
            href="https://github.com/arturr55/obscura-network"
            target="_blank"
            rel="noreferrer"
            className="border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            Read the Whitepaper
          </a>
        </div>
      </section>

      {/* The Problem */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div className="grid md:grid-cols-3 gap-6 text-center">
          {[
            {
              label: "Tornado Cash",
              color: "red",
              verdict: "BLOCKED",
              desc: "Perfect privacy, zero compliance. OFAC-sanctioned in 2022. Unusable by any regulated entity.",
            },
            {
              label: "Aztec / Manta",
              color: "yellow",
              verdict: "RISKY",
              desc: "Privacy without compliance guarantees. Regulators have no way to verify you're not evading sanctions.",
            },
            {
              label: "Obscura",
              color: "green",
              verdict: "COMPLIANT",
              desc: "Privacy + ZK compliance proofs. Every transfer proves OFAC non-membership. Legally defensible.",
            },
          ].map((c) => (
            <div
              key={c.label}
              className={`rounded-2xl p-6 border ${
                c.color === "red"
                  ? "bg-red-900/10 border-red-700/30"
                  : c.color === "yellow"
                  ? "bg-yellow-900/10 border-yellow-700/30"
                  : "bg-green-900/10 border-green-700/30"
              }`}
            >
              <div
                className={`text-xs font-bold tracking-widest mb-3 ${
                  c.color === "red"
                    ? "text-red-400"
                    : c.color === "yellow"
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {c.verdict}
              </div>
              <div className="text-white font-semibold text-lg mb-2">{c.label}</div>
              <div className="text-gray-400 text-sm">{c.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-3">How ZKCompliance Works</h2>
        <p className="text-gray-400 text-center mb-12">
          Four steps. Every step generates a cryptographic proof.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {HOW_IT_WORKS.map((s) => (
            <div
              key={s.step}
              className="bg-obscura-card border border-obscura-border rounded-2xl p-6 flex gap-5"
            >
              <div className="text-3xl font-bold text-purple-500/50 shrink-0 w-10">{s.step}</div>
              <div>
                <div className="text-white font-semibold text-lg mb-1">{s.title}</div>
                <div className="text-gray-400 text-sm leading-relaxed">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-3">Enterprise Use Cases</h2>
        <p className="text-gray-400 text-center mb-12">
          Built for teams that need both financial privacy and regulatory standing.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {USE_CASES.map((u) => (
            <div
              key={u.title}
              className="bg-obscura-card border border-obscura-border rounded-2xl p-6"
            >
              <div className="text-3xl mb-3">{u.icon}</div>
              <div className="text-white font-semibold text-lg mb-0.5">{u.title}</div>
              <div className="text-purple-400 text-xs mb-3">{u.subtitle}</div>
              <div className="text-gray-400 text-sm leading-relaxed">{u.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12">Feature Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-obscura-border">
                <th className="text-left py-3 px-4 text-gray-400 font-normal">Feature</th>
                <th className="py-3 px-4 text-purple-400 font-semibold">Obscura</th>
                <th className="py-3 px-4 text-gray-500 font-normal">Aztec</th>
                <th className="py-3 px-4 text-gray-500 font-normal">Tornado</th>
                <th className="py-3 px-4 text-gray-500 font-normal">Manta</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-obscura-border/50 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3 px-4 text-gray-300">{row.feature}</td>
                  <td className="py-3 px-4 text-center">
                    <Check val={row.obscura} />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Check val={row.aztec} />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Check val={row.tornado} />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Check val={row.manta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Full Stack */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div className="bg-gradient-to-br from-purple-900/30 to-violet-900/10 border border-purple-700/30 rounded-3xl p-8 md:p-12 text-center">
          <h2 className="text-3xl font-bold mb-4">One integration. The entire stack.</h2>
          <p className="text-gray-400 text-lg mb-10 max-w-2xl mx-auto">
            Most privacy projects ship only a protocol. You build the rest.
            Obscura ships everything — connect once, get it all.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
            {[
              { label: "ZK Rollup", icon: "⚡" },
              { label: "ETH Bridge", icon: "🌉" },
              { label: "dApp", icon: "🖥" },
              { label: "Compliance Oracle", icon: "⚖" },
              { label: "TypeScript SDK", icon: "🔧" },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center gap-2"
              >
                <span className="text-2xl">{item.icon}</span>
                <span className="text-xs text-gray-300 text-center">{item.label}</span>
              </div>
            ))}
          </div>
          <Link
            href="/send"
            className="bg-purple-600 hover:bg-purple-700 text-white px-10 py-3.5 rounded-xl font-semibold transition-colors inline-block"
          >
            Try Live Demo →
          </Link>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12">Technical Architecture</h2>
        <div className="bg-obscura-card border border-obscura-border rounded-2xl overflow-hidden">
          {TECH_STACK.map(([key, val], i) => (
            <div
              key={key}
              className={`flex items-start gap-4 px-6 py-4 ${
                i < TECH_STACK.length - 1 ? "border-b border-obscura-border" : ""
              }`}
            >
              <div className="text-gray-500 text-sm w-40 shrink-0">{key}</div>
              <div className="text-gray-200 text-sm font-mono">{val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Viewing Key Generator */}
      <ViewingKeyGenerator />

      {/* Grants / Investors CTA */}
      <section className="max-w-5xl mx-auto px-4 pb-28 text-center">
        <h2 className="text-3xl font-bold mb-4">For Grantors & Investors</h2>
        <p className="text-gray-400 max-w-2xl mx-auto mb-8">
          Obscura is the first privacy rollup on Celestia with protocol-native compliance.
          Actively seeking grants from Celestia Foundation and Succinct Labs.
          All code is open source.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="https://github.com/arturr55/obscura-network"
            target="_blank"
            rel="noreferrer"
            className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            View on GitHub
          </a>
          <Link
            href="/#plans"
            className="border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            See Pricing
          </Link>
        </div>
        <p className="text-gray-600 text-sm mt-6">
          Currently on Ethereum Sepolia testnet. Mainnet launch pending security audit.
        </p>
      </section>
    </main>
  );
}
