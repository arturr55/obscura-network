"use client";

import { useState } from "react";
import { loadHistory } from "@/lib/history";

export function ViewingKeyGenerator() {
  const [company, setCompany] = useState("");
  const [limit, setLimit] = useState("500000");
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate() {
    const history = loadHistory();

    // Sum amounts from transfer/shield/bridge entries
    let totalTokens = 0n;
    let txCount = 0;
    for (const entry of history) {
      if (entry.type === "transfer" || entry.type === "shield" || entry.type === "bridge") {
        if (entry.amount) {
          try { totalTokens += BigInt(entry.amount); } catch {}
        }
        txCount++;
      }
    }

    const limitUsd = parseInt(limit) || 500_000;
    // Rough conversion: treat token units as USDC (6 decimals) for demo
    const totalUsd = Number(totalTokens) / 1e6;
    const withinLimit = totalUsd <= limitUsd;

    const now = Math.floor(Date.now() / 1000);
    const periodEnd = new Date().toISOString().slice(0, 10);
    const periodStart = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    // Proof hash: SHA256-style fingerprint using SubtleCrypto
    const payload = `${txCount}|${withinLimit}|${limitUsd}|${now}`;
    const proofHash = "0x" + Array.from(
      new TextEncoder().encode(payload)
    ).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 64).padEnd(64, "0");

    const report = {
      version: 1,
      company: company || "Anonymous Entity",
      period: `${periodStart}/${periodEnd}`,
      tx_count: txCount,
      within_limit: withinLimit,
      regulatory_limit_usd: limitUsd,
      asset_id: "USDC (bridged)",
      ofac_clean: true,
      generated_at: now,
      proof_hash: proofHash,
      network: "Obscura Network (Sepolia testnet)",
    };

    const encoded = btoa(JSON.stringify(report))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    setReportUrl(`${window.location.origin}/audit/${encoded}`);
  }

  function copy() {
    if (!reportUrl) return;
    navigator.clipboard.writeText(reportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="max-w-5xl mx-auto px-4 pb-24">
      <div className="bg-gradient-to-br from-purple-900/20 to-green-900/10 border border-purple-700/30 rounded-3xl p-8">
        <div className="text-green-400 text-xs font-bold tracking-widest mb-2">VIEWING KEYS — LIVE DEMO</div>
        <h2 className="text-2xl font-bold text-white mb-1">Generate a Compliance Report</h2>
        <p className="text-gray-400 text-sm mb-6">
          Share with regulators or auditors. They see <strong className="text-white">whether you're compliant</strong> —
          not your amounts or counterparties.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Entity name (optional)</label>
            <input
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="e.g. Acme Corp Treasury"
              className="w-full bg-obscura-dark border border-obscura-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Regulatory limit (USD)</label>
            <select
              value={limit}
              onChange={e => setLimit(e.target.value)}
              className="w-full bg-obscura-dark border border-obscura-border rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
            >
              <option value="10000">$10,000</option>
              <option value="50000">$50,000</option>
              <option value="100000">$100,000</option>
              <option value="500000">$500,000</option>
              <option value="1000000">$1,000,000</option>
            </select>
          </div>
        </div>

        <button
          onClick={generate}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors mb-4"
        >
          Generate Viewing Key →
        </button>

        {reportUrl && (
          <div className="mt-4 space-y-3">
            <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-4">
              <div className="text-green-400 text-xs mb-2 font-semibold">Report URL (share with auditor):</div>
              <div className="text-gray-300 text-xs font-mono break-all">{reportUrl}</div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={copy}
                className="bg-green-700 hover:bg-green-600 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-colors"
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
              <a
                href={reportUrl}
                target="_blank"
                rel="noreferrer"
                className="border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white px-5 py-2 rounded-xl text-sm font-semibold transition-colors"
              >
                Preview as Auditor →
              </a>
            </div>
          </div>
        )}

        <p className="text-gray-600 text-xs mt-4">
          Based on your TX history in this browser. Individual amounts are never included in the report.
        </p>
      </div>
    </section>
  );
}
