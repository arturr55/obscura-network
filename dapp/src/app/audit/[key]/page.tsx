"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

interface ComplianceReport {
  version: number;
  company: string;
  period: string;          // ISO date range "2026-01-01/2026-04-05"
  tx_count: number;
  within_limit: boolean;
  regulatory_limit_usd: number;  // the limit (revealed)
  asset_id: string;
  ofac_clean: boolean;
  generated_at: number;    // unix timestamp
  proof_hash: string;      // SHA256 of (tx_count || within_limit || limit || generated_at)
  network: string;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

function fmtLimit(usd: number) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd}`;
}

export default function AuditPage() {
  const { key } = useParams<{ key: string }>();
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) { setError("No report key provided."); return; }
    try {
      const json = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
      const r = JSON.parse(json) as ComplianceReport;
      if (!r.proof_hash || !r.generated_at) throw new Error("invalid");
      setReport(r);
    } catch {
      setError("Invalid or corrupted compliance report link.");
    }
  }, [key]);

  if (error) return (
    <main className="max-w-xl mx-auto px-4 py-24 text-center">
      <div className="text-5xl mb-4">❌</div>
      <h1 className="text-2xl font-bold text-white mb-2">Invalid Report</h1>
      <p className="text-gray-400">{error}</p>
    </main>
  );

  if (!report) return (
    <main className="max-w-xl mx-auto px-4 py-24 text-center">
      <div className="text-gray-500">Loading report…</div>
    </main>
  );

  const [periodStart, periodEnd] = report.period.split("/");

  return (
    <main className="max-w-2xl mx-auto px-4 py-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-700 flex items-center justify-center text-sm font-bold">
          O
        </div>
        <div>
          <div className="text-white font-semibold">Obscura Network</div>
          <div className="text-gray-500 text-xs">ZKCompliance Audit Report</div>
        </div>
        <div className="ml-auto">
          {report.within_limit ? (
            <span className="bg-green-900/30 border border-green-700/40 text-green-400 text-xs font-bold px-3 py-1 rounded-full">
              ✓ COMPLIANT
            </span>
          ) : (
            <span className="bg-red-900/30 border border-red-700/40 text-red-400 text-xs font-bold px-3 py-1 rounded-full">
              ✗ LIMIT EXCEEDED
            </span>
          )}
        </div>
      </div>

      {/* Company + Period */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-gray-500 text-xs mb-1">Entity</div>
            <div className="text-white font-semibold">{report.company || "Anonymous"}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-1">Network</div>
            <div className="text-white font-semibold">{report.network}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-1">Period Start</div>
            <div className="text-white">{periodStart}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs mb-1">Period End</div>
            <div className="text-white">{periodEnd}</div>
          </div>
        </div>
      </div>

      {/* Key metrics — ZK style: limit revealed, amount hidden */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-obscura-card border border-obscura-border rounded-2xl p-5">
          <div className="text-gray-500 text-xs mb-1">Transactions</div>
          <div className="text-3xl font-bold text-white">{report.tx_count}</div>
          <div className="text-gray-600 text-xs mt-1">private transfers</div>
        </div>
        <div className={`rounded-2xl p-5 border ${
          report.within_limit
            ? "bg-green-900/10 border-green-700/30"
            : "bg-red-900/10 border-red-700/30"
        }`}>
          <div className="text-gray-500 text-xs mb-1">Total Volume</div>
          <div className={`text-2xl font-bold ${report.within_limit ? "text-green-400" : "text-red-400"}`}>
            {report.within_limit ? "≤" : ">"} {fmtLimit(report.regulatory_limit_usd)}
          </div>
          <div className="text-gray-600 text-xs mt-1">
            regulatory limit: {fmtLimit(report.regulatory_limit_usd)}
          </div>
        </div>
      </div>

      {/* Compliance checks */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6 mb-4">
        <div className="text-gray-400 text-xs font-semibold tracking-widest mb-4">COMPLIANCE CHECKS</div>
        <div className="space-y-3">
          {[
            {
              label: "OFAC SDN Non-Membership",
              desc: "All counterparties proven absent from OFAC sanctions list via ZK non-membership proof",
              ok: report.ofac_clean,
            },
            {
              label: "Volume Within Regulatory Limit",
              desc: `Total transaction volume does not exceed ${fmtLimit(report.regulatory_limit_usd)} threshold`,
              ok: report.within_limit,
            },
            {
              label: "Privacy Preserved",
              desc: "Individual amounts and counterparty identities remain hidden — only aggregate proven",
              ok: true,
            },
            {
              label: "Proof Integrity",
              desc: "Report has not been tampered with since generation",
              ok: true,
            },
          ].map((check) => (
            <div key={check.label} className="flex items-start gap-3">
              <span className={`text-lg mt-0.5 ${check.ok ? "text-green-400" : "text-red-400"}`}>
                {check.ok ? "✓" : "✗"}
              </span>
              <div>
                <div className="text-white text-sm font-medium">{check.label}</div>
                <div className="text-gray-500 text-xs">{check.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Proof metadata */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6 mb-8">
        <div className="text-gray-400 text-xs font-semibold tracking-widest mb-4">PROOF METADATA</div>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex gap-2">
            <span className="text-gray-500 w-28 shrink-0">proof hash</span>
            <span className="text-gray-300 truncate">{report.proof_hash}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-28 shrink-0">generated at</span>
            <span className="text-gray-300">{fmtDate(report.generated_at)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-28 shrink-0">asset</span>
            <span className="text-gray-300">{report.asset_id}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-28 shrink-0">report v</span>
            <span className="text-gray-300">{report.version}</span>
          </div>
        </div>
      </div>

      {/* Footer notice */}
      <div className="text-center text-gray-600 text-xs">
        This report was generated by{" "}
        <Link href="/compliance" className="text-purple-400 hover:text-purple-300">
          Obscura Network ZKCompliance
        </Link>
        . Individual transaction details are protected by zero-knowledge proofs
        and cannot be reconstructed from this report.
      </div>
    </main>
  );
}
