"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  loadHistory,
  clearHistory,
  typeLabel,
  fmtAmount,
  fmtUsdc,
  type TxHistoryEntry,
  type TxHistoryType,
} from "@/lib/history";

const STATUS_CFG = {
  success: { cls: "bg-green-900/40 text-green-300", icon: "✓" },
  pending: { cls: "bg-yellow-900/40 text-yellow-300", icon: "⏳" },
  failed:  { cls: "bg-red-900/30 text-red-400",      icon: "✗" },
};

const TYPE_COLOR: Record<TxHistoryType, string> = {
  shield:   "text-purple-300",
  transfer: "text-blue-300",
  unshield: "text-indigo-300",
  bridge:   "text-cyan-300",
  withdraw: "text-orange-300",
};

export default function HistoryPage() {
  const [entries, setEntries] = useState<TxHistoryEntry[]>([]);
  const [filter, setFilter] = useState<TxHistoryType | "all">("all");

  useEffect(() => {
    setEntries(loadHistory());
  }, []);

  function handleClear() {
    if (confirm("Clear all transaction history?")) {
      clearHistory();
      setEntries([]);
    }
  }

  const filtered = filter === "all"
    ? entries
    : entries.filter((e) => e.type === filter);

  const counts = entries.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/send" className="text-gray-500 hover:text-white transition-colors text-sm">← Send TX</Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-xl font-bold text-white">Transaction History</h1>
        </div>
        {entries.length > 0 && (
          <button
            onClick={handleClear}
            className="text-xs text-red-800 hover:text-red-500 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Stats */}
      {entries.length > 0 && (
        <div className="grid grid-cols-5 gap-2 mb-6">
          {(["shield", "transfer", "unshield", "bridge", "withdraw"] as TxHistoryType[]).map((t) => (
            <div
              key={t}
              onClick={() => setFilter(filter === t ? "all" : t)}
              className={`bg-obscura-card border rounded-xl p-3 text-center cursor-pointer transition-all ${
                filter === t ? "border-purple-600" : "border-obscura-border hover:border-gray-600"
              }`}
            >
              <div className={`text-lg font-bold ${TYPE_COLOR[t]}`}>{counts[t] ?? 0}</div>
              <div className="text-gray-500 text-xs mt-0.5">{typeLabel(t).split(" ")[1]}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {entries.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              filter === "all" ? "bg-purple-600 text-white" : "border border-obscura-border text-gray-400 hover:text-white"
            }`}
          >
            All ({entries.length})
          </button>
          {(["shield", "transfer", "unshield", "bridge", "withdraw"] as TxHistoryType[]).map((t) =>
            (counts[t] ?? 0) > 0 ? (
              <button
                key={t}
                onClick={() => setFilter(filter === t ? "all" : t)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  filter === t ? "bg-purple-600 text-white" : "border border-obscura-border text-gray-400 hover:text-white"
                }`}
              >
                {typeLabel(t)} ({counts[t]})
              </button>
            ) : null
          )}
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {entries.length === 0
            ? "No transactions yet. Start by bridging or shielding tokens."
            : "No transactions of this type."}
          {entries.length === 0 && (
            <div className="mt-4">
              <Link href="/send" className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                Go to Send TX →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((entry) => (
            <HistoryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </main>
  );
}

function HistoryCard({ entry }: { entry: TxHistoryEntry }) {
  const status = STATUS_CFG[entry.status];
  const date = new Date(entry.timestamp).toLocaleString();
  const [expanded, setExpanded] = useState(false);

  const amountStr = entry.amountUsdc
    ? fmtUsdc(entry.amountUsdc)
    : entry.amount
    ? fmtAmount(entry.amount)
    : null;

  return (
    <div className="bg-obscura-card border border-obscura-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-sm font-medium ${TYPE_COLOR[entry.type]}`}>
              {typeLabel(entry.type)}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${status.cls}`}>
              {status.icon} {entry.status}
            </span>
            <span className="text-xs text-gray-600">{date}</span>
          </div>

          {amountStr && (
            <div className="text-white font-semibold">{amountStr}</div>
          )}

          {entry.note && (
            <div className="text-gray-400 text-xs mt-0.5">{entry.note}</div>
          )}

          {entry.depositId !== undefined && (
            <div className="text-gray-500 text-xs">Deposit ID: {entry.depositId}</div>
          )}

          {entry.recipient && (
            <div className="text-gray-500 text-xs font-mono truncate">
              → {entry.recipient.slice(0, 20)}...
            </div>
          )}
        </div>
      </div>

      {/* TX hashes */}
      {(entry.txHash || entry.ethTxHash) && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            {expanded ? "▲ Hide details" : "▼ Show TX details"}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {entry.txHash && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs w-20 shrink-0">Obscura TX:</span>
                  <span className="text-gray-300 text-xs font-mono truncate">{entry.txHash}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(entry.txHash!)}
                    className="text-purple-500 hover:text-purple-400 text-xs shrink-0"
                  >
                    Copy
                  </button>
                </div>
              )}
              {entry.ethTxHash && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs w-20 shrink-0">ETH TX:</span>
                  <span className="text-gray-300 text-xs font-mono truncate">{entry.ethTxHash}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(entry.ethTxHash!)}
                    className="text-purple-500 hover:text-purple-400 text-xs shrink-0"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
