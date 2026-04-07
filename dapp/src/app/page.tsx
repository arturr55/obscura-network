"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { PLANS } from "@/lib/contracts";
import { useEffect, useState } from "react";

interface NetworkStats {
  slot: number | null;
  nodeOnline: boolean;
  oracleOnline: boolean;
  sanctionsAddresses: number | null;
  ts: number;
}

function LiveStats() {
  const [stats, setStats] = useState<NetworkStats | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch("/api/stats");
        if (r.ok) setStats(await r.json());
      } catch {}
    }
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const dot = (on: boolean) => (
    <span
      className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
        on ? "bg-green-400 animate-pulse" : "bg-gray-600"
      }`}
    />
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 text-center">
        <div className="text-white font-semibold">
          {stats === null ? (
            <span className="text-gray-600">—</span>
          ) : stats.slot !== null ? (
            <>#{stats.slot.toLocaleString()}</>
          ) : (
            <span className="text-gray-600">offline</span>
          )}
        </div>
        <div className="text-gray-500 text-sm mt-1 flex items-center justify-center">
          {dot(!!stats?.nodeOnline)}
          Rollup Slot
        </div>
      </div>

      <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 text-center">
        <div className="text-white font-semibold">Celestia DA</div>
        <div className="text-gray-500 text-sm mt-1">DA Layer</div>
      </div>

      <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 text-center">
        <div className="text-white font-semibold">
          {stats?.sanctionsAddresses != null
            ? stats.sanctionsAddresses.toLocaleString()
            : "87"}
        </div>
        <div className="text-gray-500 text-sm mt-1 flex items-center justify-center">
          {dot(!!stats?.oracleOnline)}
          OFAC Addresses
        </div>
      </div>

      <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 text-center">
        <div className="text-white font-semibold">SP1 / Groth16</div>
        <div className="text-gray-500 text-sm mt-1">ZK Proofs</div>
      </div>
    </div>
  );
}

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <main>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-900/30 border border-purple-700/40 rounded-full px-4 py-1.5 text-sm text-purple-300 mb-6">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          Live on Ethereum Sepolia Testnet
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
          Bridge across chains.<br />
          <span className="bg-gradient-to-r from-purple-400 to-violet-500 bg-clip-text text-transparent">
            Privately. Legally.
          </span>
        </h1>
        <p className="text-xl text-gray-400 mb-4 max-w-2xl mx-auto">
          Send USDC from Ethereum — receive on Arbitrum from a fresh address.
          The link between sender and recipient is invisible on-chain.
        </p>
        <p className="text-sm text-green-400 mb-10 max-w-xl mx-auto">
          Unlike Tornado Cash — every transfer includes a ZK compliance proof.
          Regulators see you&apos;re clean. They don&apos;t see amounts or addresses.
        </p>

        {/* Bridge flow illustration */}
        <div className="flex items-center justify-center gap-3 mb-10 flex-wrap text-sm">
          <div className="bg-obscura-card border border-obscura-border rounded-xl px-4 py-2 text-gray-300">
            Ethereum <span className="text-gray-500 text-xs ml-1">your KYC address</span>
          </div>
          <div className="text-purple-400 font-bold text-lg">→ Obscura →</div>
          <div className="bg-obscura-card border border-obscura-border rounded-xl px-4 py-2 text-gray-300">
            Arbitrum <span className="text-gray-500 text-xs ml-1">fresh address</span>
          </div>
          <div className="bg-green-900/30 border border-green-700/40 rounded-xl px-4 py-2 text-green-400 text-xs font-semibold">
            ✓ ZK Compliance Proof
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {isConnected ? (
            <Link
              href="/send"
              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
            >
              Bridge Now →
            </Link>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button
                  onClick={openConnectModal}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
                >
                  Connect Wallet to Bridge
                </button>
              )}
            </ConnectButton.Custom>
          )}
          <a
            href="https://github.com/arturr55/obscura-network"
            target="_blank"
            rel="noreferrer"
            className="border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { step: "1", title: "Deposit on any chain", desc: "Send USDC (or ETH, USDT) from Ethereum, Arbitrum, Base, Polygon — any EVM chain.", icon: "⬇" },
            { step: "2", title: "Obscura shields it", desc: "Funds enter a ZK shielded pool. Your deposit address and amount become private.", icon: "🔒" },
            { step: "3", title: "Withdraw anywhere", desc: "Receive on any chain to a fresh address. On-chain link between deposit and withdrawal is invisible.", icon: "✓" },
          ].map((item) => (
            <div key={item.step} className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
              <div className="w-10 h-10 rounded-full bg-purple-900/40 border border-purple-700/40 flex items-center justify-center text-lg mb-4">
                {item.icon}
              </div>
              <div className="text-gray-500 text-xs font-bold tracking-widest mb-1">STEP {item.step}</div>
              <div className="text-white font-semibold mb-2">{item.title}</div>
              <div className="text-gray-500 text-sm leading-relaxed">{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <LiveStats />
      </section>

      {/* ZKCompliance Banner */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-gradient-to-br from-green-900/20 to-purple-900/20 border border-green-700/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="text-green-400 text-xs font-bold tracking-widest mb-2">WHY WE&apos;RE DIFFERENT FROM TORNADO CASH</div>
            <h2 className="text-2xl font-bold text-white mb-2">Privacy AND compliance. Not a trade-off.</h2>
            <p className="text-gray-400 max-w-lg">
              Tornado Cash was blocked by OFAC because it had no compliance layer.
              Obscura includes a ZK sanctions proof in every transfer — regulators see you&apos;re clean,
              without seeing your amounts or addresses.
            </p>
          </div>
          <Link
            href="/compliance"
            className="bg-green-700 hover:bg-green-600 text-white px-7 py-3 rounded-xl font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Learn ZKCompliance →
          </Link>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="max-w-6xl mx-auto px-4 pb-24">
        <h2 className="text-3xl font-bold text-white text-center mb-3">Choose Your Plan</h2>
        <p className="text-gray-400 text-center mb-10">
          Hold 1,000+ OBSCURA tokens for 40% discount on all plans.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map((plan, i) => (
            <div
              key={plan.id}
              className={`relative bg-obscura-card border rounded-2xl p-6 flex flex-col ${
                i === 1
                  ? "border-purple-500 shadow-lg shadow-purple-900/30"
                  : "border-obscura-border"
              }`}
            >
              {i === 1 && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <div className="mb-4">
                <h3 className="text-white font-bold text-lg">{plan.name}</h3>
                <div className="text-3xl font-bold text-white mt-2">
                  {plan.price}
                  <span className="text-gray-500 text-sm font-normal">/mo</span>
                </div>
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-gray-300 text-sm">
                    <span className="text-purple-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className={`w-full text-center py-2.5 rounded-xl font-semibold transition-colors text-sm ${
                  i === 1
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white"
                }`}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>

        {/* Pay per tx */}
        <div className="mt-6 bg-obscura-card border border-obscura-border rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-semibold">Pay-per-Transaction</h3>
            <p className="text-gray-400 text-sm mt-1">No subscription needed. Pay $0.10 per transaction.</p>
          </div>
          <Link
            href="/dashboard"
            className="border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white px-6 py-2.5 rounded-xl font-semibold transition-colors text-sm whitespace-nowrap"
          >
            Buy Credits
          </Link>
        </div>
      </section>
    </main>
  );
}
