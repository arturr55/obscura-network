"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  loadEncryptedNotes,
  shortKey,
  type DecryptedNote,
  type EncryptedNote,
} from "@/lib/obscura-crypto";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OraclePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold tracking-widest mb-3">
          <span>🏛️</span> COMPLIANCE ORACLE
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Forced Compliance Audit</h1>
        <p className="text-gray-400 text-sm max-w-xl">
          The compliance oracle can decrypt <strong className="text-amber-400">any transaction</strong> on
          the Obscura network — no user consent required. This access is built into the protocol:
          every note is encrypted twice, once for the oracle.
        </p>
      </div>

      {/* Warning banner */}
      <div className="bg-red-900/10 border border-red-700/30 rounded-2xl p-4 mb-6 flex gap-3">
        <span className="text-red-400 text-lg shrink-0">⚠️</span>
        <div>
          <div className="text-red-400 text-sm font-semibold mb-1">
            Testnet — Oracle Key Is Public
          </div>
          <div className="text-gray-400 text-xs leading-relaxed">
            On testnet the oracle secret is derived from a known seed for transparency.
            On mainnet, the oracle key is held in a ZKCompliance multisig controlled by
            authorized regulators only. Testnet key is pre-filled below.
          </div>
        </div>
      </div>

      <OracleAuditPanel />
    </main>
  );
}

// ── Oracle audit panel ────────────────────────────────────────────────────────

function OracleAuditPanel() {
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTotalCount(loadEncryptedNotes().length);
  }, []);

  // Decryption happens server-side — oracle key never leaves the server
  const handleAudit = useCallback(async () => {
    setError(null);
    setLoading(true);
    setSearched(false);
    try {
      const encNotes: EncryptedNote[] = loadEncryptedNotes();
      const res = await fetch("/api/oracle-decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: encNotes }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json() as { decrypted: DecryptedNote[] };
      setNotes(data.decrypted);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decryption failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  const isTestnetKey = true; // server uses testnet key from env

  const totalAmount = notes.reduce((sum, n) => {
    try { return sum + parseFloat(n.amount || "0"); } catch { return sum; }
  }, 0);

  // Group notes by user (by commitment prefix as proxy — real impl would group by enc_user key)
  const byType = notes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Oracle audit trigger */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
        <div className="flex items-start justify-between mb-1">
          <div className="text-white font-semibold">Oracle Decryption</div>
          {isTestnetKey && (
            <span className="bg-amber-900/30 border border-amber-700/40 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
              TESTNET
            </span>
          )}
        </div>
        <div className="text-gray-500 text-xs mb-4">
          Decryption happens server-side — the oracle private key never leaves the server.
          On mainnet it will be stored in a hardware security module (HSM).
        </div>

        <button
          onClick={handleAudit}
          disabled={loading}
          className="bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-semibold text-sm transition-colors"
        >
          {loading ? "Decrypting…" : "Audit All Notes"}
        </button>

        {error && (
          <div className="mt-3 text-red-400 text-xs">{error}</div>
        )}
      </div>

      {/* How oracle access works */}
      {!searched && (
        <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
          <div className="text-gray-400 text-xs font-semibold tracking-widest mb-4">
            HOW FORCED COMPLIANCE WORKS
          </div>
          <div className="space-y-4">
            {[
              {
                icon: "🔐",
                title: "Every note is encrypted twice — by design",
                desc: "When any user shields or transfers funds, the protocol automatically creates two ciphertexts: enc_for_recipient (user key) and enc_for_compliance (oracle key). This is enforced at the circuit level.",
              },
              {
                icon: "🏛️",
                title: "Oracle holds the master key",
                desc: "The compliance oracle holds the secret key for COMPLIANCE_ORACLE_PUBKEY. It can decrypt the enc_for_compliance blob of any note on the network without any user involvement.",
              },
              {
                icon: "🔑",
                title: "User cooperation is optional",
                desc: "Users can share their personal viewing key for voluntary disclosure (see Audit page). But even if they refuse, the oracle can always access their transactions via enc_for_compliance.",
              },
              {
                icon: "⚖️",
                title: "Mainnet: multisig controlled",
                desc: "On mainnet, the oracle private key is stored in a ZKCompliance multisig. Access requires M-of-N signatures from authorized regulators. Testnet uses a published deterministic key for transparency.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="text-xl shrink-0 mt-0.5">{item.icon}</div>
                <div>
                  <div className="text-white text-sm font-medium mb-1">{item.title}</div>
                  <div className="text-gray-500 text-xs leading-relaxed">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-obscura-border flex items-center justify-between">
            <div className="text-gray-500 text-xs">
              Voluntary disclosure (user shares their key):
            </div>
            <Link
              href="/audit"
              className="text-purple-400 hover:text-purple-300 text-xs font-semibold transition-colors"
            >
              Audit with Viewing Key →
            </Link>
          </div>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="bg-obscura-card border border-obscura-border rounded-2xl overflow-hidden">
          {/* Summary bar */}
          <div className="px-6 py-4 border-b border-obscura-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-white font-semibold text-lg">{notes.length}</span>
                <span className="text-gray-400 text-sm">
                  {" "}of {totalCount} note{totalCount !== 1 ? "s" : ""} decrypted
                </span>
              </div>
              <span className="bg-amber-900/30 border border-amber-700/40 text-amber-400 text-xs font-bold px-3 py-1 rounded-full">
                🏛️ ORACLE ACCESS
              </span>
            </div>

            {notes.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-obscura-dark rounded-xl p-3 text-center">
                  <div className="text-white font-bold text-lg">{totalAmount.toFixed(2)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Total USDC</div>
                </div>
                <div className="bg-obscura-dark rounded-xl p-3 text-center">
                  <div className="text-white font-bold text-lg">{byType.shield ?? 0}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Shields</div>
                </div>
                <div className="bg-obscura-dark rounded-xl p-3 text-center">
                  <div className="text-white font-bold text-lg">{byType.transfer ?? 0}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Transfers</div>
                </div>
              </div>
            )}
          </div>

          {notes.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-3xl mb-3">📭</div>
              <div className="text-gray-400 text-sm">
                No notes found. Shield or transfer tokens first to create encrypted notes.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-obscura-border">
              {notes.map((note) => (
                <OracleNoteRow key={note.commitment} note={note} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Oracle note row ───────────────────────────────────────────────────────────

function OracleNoteRow({ note }: { note: DecryptedNote }) {
  const date = new Date(note.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const time = new Date(note.createdAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });

  const typeLabel: Record<string, string> = {
    shield: "Shield",
    transfer: "Transfer",
    bridge: "Bridge",
  };
  const typeColor: Record<string, string> = {
    shield: "text-blue-400",
    transfer: "text-purple-400",
    bridge: "text-green-400",
  };
  const typeIcon: Record<string, string> = {
    shield: "⬇",
    transfer: "→",
    bridge: "🌉",
  };

  return (
    <div className="px-6 py-4 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-obscura-dark border border-obscura-border flex items-center justify-center text-xs shrink-0">
            {typeIcon[note.type] ?? "?"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${typeColor[note.type] ?? "text-white"}`}>
                {typeLabel[note.type] ?? note.type}
              </span>
              {/* Oracle badge — always shown here since we're the oracle */}
              <span className="bg-amber-900/30 border border-amber-700/40 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                ORACLE
              </span>
            </div>
            <div className="text-gray-500 text-xs font-mono mt-0.5">
              {shortKey(note.commitment)}
            </div>
            {note.memo && (
              <div className="text-gray-400 text-xs mt-0.5 italic">{note.memo}</div>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-white font-semibold">{note.amount} USDC</div>
          <div className="text-gray-500 text-xs mt-0.5">
            {date} · {time}
          </div>
          {note.txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${note.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-amber-400 hover:text-amber-300 text-xs mt-0.5 block transition-colors"
            >
              View TX ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
