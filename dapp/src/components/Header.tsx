"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-obscura-border bg-obscura-dark/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-violet-700 flex items-center justify-center text-sm font-bold">
            O
          </div>
          <span className="font-semibold text-white text-lg">Obscura Network</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
          <Link href="/#plans" className="hover:text-white transition-colors">Plans</Link>
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <Link href="/send" className="hover:text-white transition-colors text-purple-400 hover:text-purple-300">Send TX</Link>
          <Link href="/notes" className="hover:text-white transition-colors">Notes</Link>
          <Link href="/history" className="hover:text-white transition-colors">History</Link>
          <Link href="/audit" className="hover:text-white transition-colors text-purple-400 hover:text-purple-300">Audit</Link>
          <Link href="/compliance" className="hover:text-white transition-colors text-green-400 hover:text-green-300">ZKCompliance</Link>
          <a href="https://github.com/arturr55/obscura-network" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Docs</a>
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
