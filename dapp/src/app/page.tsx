"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { PLANS } from "@/lib/contracts";

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
          Private Transactions<br />
          <span className="bg-gradient-to-r from-purple-400 to-violet-500 bg-clip-text text-transparent">
            by Default
          </span>
        </h1>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          ZK Rollup on Celestia. Every transaction is shielded with zero-knowledge proofs.
          Pay per transaction or subscribe monthly.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {isConnected ? (
            <Link
              href="/dashboard"
              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
            >
              Open Dashboard
            </Link>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button
                  onClick={openConnectModal}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
                >
                  Connect Wallet
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

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Network", value: "Celestia DA" },
            { label: "ZK Proofs", value: "SP1 / Groth16" },
            { label: "Privacy", value: "Default ON" },
            { label: "Token", value: "OBSCURA" },
          ].map((s) => (
            <div key={s.label} className="bg-obscura-card border border-obscura-border rounded-xl p-4 text-center">
              <div className="text-white font-semibold">{s.value}</div>
              <div className="text-gray-500 text-sm mt-1">{s.label}</div>
            </div>
          ))}
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
