"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export default function StartPage() {
  const { isConnected } = useAccount();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Logo / title */}
      <div className="mb-3 flex items-center gap-2 text-purple-400 text-xs font-semibold tracking-widest">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
        OBSCURA NETWORK
      </div>
      <h1 className="text-4xl font-bold text-white mb-3 text-center">
        Private transactions.<br />Built-in compliance.
      </h1>
      <p className="text-gray-400 text-sm mb-10 text-center max-w-md">
        Shield your funds, transfer privately, stay compliant — all in one place.
      </p>

      {!isConnected && (
        <div className="mb-10">
          <ConnectButton />
        </div>
      )}

      {/* Role cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
        <RoleCard
          icon="💸"
          title="I want to send privately"
          desc="Bridge tokens → Shield → Transfer to any address. The link between sender and recipient is invisible on-chain."
          steps={["Bridge USDC from Ethereum", "Shield into private pool", "Transfer to recipient"]}
          href="/send"
          cta="Start sending →"
          color="purple"
        />
        <RoleCard
          icon="📥"
          title="I received a payment"
          desc="Someone sent you a private Note. Claim your funds and withdraw to your wallet."
          steps={["Paste the Note you received", "See your balance", "Unshield to your wallet"]}
          href="/receive"
          cta="Claim funds →"
          color="green"
        />
        <RoleCard
          icon="🔍"
          title="I'm an auditor"
          desc="View transactions with a viewing key shared by the user, or use oracle access for compliance checks."
          steps={["Get viewing key from user", "Paste key to decrypt notes", "Or use compliance oracle"]}
          href="/audit"
          cta="Open audit →"
          color="blue"
        />
      </div>

      {/* Footer links */}
      <div className="flex gap-6 mt-12 text-xs text-gray-600">
        <Link href="/dashboard" className="hover:text-gray-400 transition-colors">Dashboard</Link>
        <Link href="/notes" className="hover:text-gray-400 transition-colors">My Notes</Link>
        <Link href="/history" className="hover:text-gray-400 transition-colors">History</Link>
        <Link href="/compliance/oracle" className="hover:text-gray-400 transition-colors">Compliance Oracle</Link>
        <a
          href="https://github.com/arturr55/obscura-network"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-400 transition-colors"
        >
          GitHub
        </a>
      </div>
    </main>
  );
}

function RoleCard({
  icon,
  title,
  desc,
  steps,
  href,
  cta,
  color,
}: {
  icon: string;
  title: string;
  desc: string;
  steps: string[];
  href: string;
  cta: string;
  color: "purple" | "green" | "blue";
}) {
  const borderColor = {
    purple: "border-purple-700/40 hover:border-purple-500/60",
    green:  "border-green-700/40 hover:border-green-500/60",
    blue:   "border-blue-700/40 hover:border-blue-500/60",
  }[color];

  const iconBg = {
    purple: "bg-purple-900/40",
    green:  "bg-green-900/40",
    blue:   "bg-blue-900/40",
  }[color];

  const ctaColor = {
    purple: "bg-purple-600 hover:bg-purple-500",
    green:  "bg-green-700 hover:bg-green-600",
    blue:   "bg-blue-700 hover:bg-blue-600",
  }[color];

  const stepColor = {
    purple: "text-purple-400",
    green:  "text-green-400",
    blue:   "text-blue-400",
  }[color];

  return (
    <Link
      href={href}
      className={`group flex flex-col bg-obscura-card border ${borderColor} rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5`}
    >
      <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center text-2xl mb-4`}>
        {icon}
      </div>
      <div className="text-white font-semibold text-base mb-2">{title}</div>
      <p className="text-gray-500 text-xs leading-relaxed mb-4 flex-1">{desc}</p>

      {/* Steps */}
      <div className="space-y-1.5 mb-5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
            <span className={`${stepColor} font-bold shrink-0`}>{i + 1}.</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      <div className={`${ctaColor} text-white text-sm font-semibold px-4 py-2 rounded-xl text-center transition-colors`}>
        {cta}
      </div>
    </Link>
  );
}
