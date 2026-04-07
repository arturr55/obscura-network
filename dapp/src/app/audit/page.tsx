"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import {
  decryptNotes,
  loadEncryptedNotes,
  shortKey,
  getCachedDerivedKey,
  saveDerivedKey,
  deriveViewingKeyFromSignature,
  type DecryptedNote,
} from "@/lib/obscura-crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "my-key" | "audit";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>("my-key");

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold tracking-widest mb-3">
          <span>🔑</span> VIEWING KEYS
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Audit & Disclosure</h1>
        <p className="text-gray-400 text-sm max-w-xl">
          Share your viewing key with any auditor for voluntary disclosure.
          The{" "}
          <Link href="/compliance/oracle" className="text-purple-400 hover:underline">
            compliance oracle
          </Link>{" "}
          can audit anyone — even without a shared key.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-obscura-card border border-obscura-border rounded-xl p-1 mb-6 w-fit">
        {(["my-key", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? "bg-purple-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "my-key" ? "My Viewing Key" : "Audit with Key"}
          </button>
        ))}
      </div>

      {tab === "my-key" ? <MyKeyTab /> : <AuditTab />}
    </main>
  );
}

// ── Tab: My Viewing Key ───────────────────────────────────────────────────────

function MyKeyTab() {
  const [viewingKey, setViewingKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [noteCount, setNoteCount] = useState(0);
  const [showFullKey, setShowFullKey] = useState(false);
  const [signing, setSigning] = useState(false);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  useEffect(() => {
    setNoteCount(loadEncryptedNotes().length);
    if (address) {
      const cached = getCachedDerivedKey(address);
      if (cached) setViewingKey(cached);
    }
  }, [address]);

  async function deriveKey() {
    if (!walletClient || !address) return;
    setSigning(true);
    try {
      const sig = await walletClient.signMessage({ message: "obscura-viewing-key-v1" });
      const key = await deriveViewingKeyFromSignature(sig);
      saveDerivedKey(address, key);
      setViewingKey(key);
    } catch {
      // user rejected
    } finally {
      setSigning(false);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(viewingKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Key card */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-white font-semibold mb-1">Your Viewing Key</div>
            <div className="text-gray-500 text-xs">
              X25519 · {noteCount} note{noteCount !== 1 ? "s" : ""} encrypted with this key
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-violet-800 flex items-center justify-center text-lg">
            🔑
          </div>
        </div>

        {/* Key display or derive prompt */}
        {viewingKey ? (
          <>
            <div className="bg-obscura-dark border border-obscura-border rounded-xl p-4 mb-4">
              <div className="text-gray-500 text-xs mb-2 font-semibold tracking-widest">
                SECRET KEY · derived from wallet signature
              </div>
              <div className="font-mono text-sm text-green-400 break-all">
                {showFullKey ? viewingKey : shortKey(viewingKey, 12)}
              </div>
              <button
                onClick={() => setShowFullKey((v) => !v)}
                className="text-gray-500 hover:text-gray-300 text-xs mt-2 transition-colors"
              >
                {showFullKey ? "Hide" : "Show full key"}
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={copyKey}
                className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                {copied ? "✓ Copied!" : "Copy Key (Share with Auditor)"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <div className="text-gray-400 text-sm">
              Sign a message with your wallet to derive a deterministic viewing key.
              The same key is always derived from the same wallet — no need to save it.
            </div>
            <button
              onClick={deriveKey}
              disabled={signing || !walletClient}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            >
              {signing ? "Waiting for signature…" : !walletClient ? "Connect wallet first" : "Sign to reveal key"}
            </button>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
        <div className="text-gray-400 text-xs font-semibold tracking-widest mb-4">HOW IT WORKS</div>
        <div className="space-y-4">
          {[
            {
              icon: "🔐",
              title: "Every transaction is encrypted twice",
              desc: "When you shield or transfer, Obscura creates two encrypted copies — one for you, one for the compliance oracle.",
            },
            {
              icon: "👁️",
              title: "Share your key for voluntary disclosure",
              desc: "Copy your viewing key above and send it to any auditor. They can then see all your transactions in the Audit tab.",
            },
            {
              icon: "🏛️",
              title: "Oracle can always audit — no permission needed",
              desc: "The compliance oracle holds a master key that decrypts any note on the network. Auditors with oracle access never need your cooperation.",
            },
            {
              icon: "✅",
              title: "Same key on every device",
              desc: "The key is derived from your wallet signature — sign on any device with the same wallet to get the identical key. Obscura never sees your signature.",
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
      </div>

      {/* Oracle link */}
      <div className="bg-amber-900/10 border border-amber-700/30 rounded-2xl p-5 flex items-center justify-between">
        <div>
          <div className="text-amber-400 text-sm font-semibold mb-1">
            Are you a regulator or compliance officer?
          </div>
          <div className="text-gray-400 text-xs">
            Use the Compliance Oracle to access any user&apos;s transactions without their viewing key.
          </div>
        </div>
        <Link
          href="/compliance/oracle"
          className="bg-amber-800/40 hover:bg-amber-800/60 border border-amber-700/40 text-amber-400 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
        >
          Oracle Access →
        </Link>
      </div>
    </div>
  );
}

// ── Tab: Audit with Key ───────────────────────────────────────────────────────

function AuditTab() {
  const [inputKey, setInputKey] = useState("");
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTotalCount(loadEncryptedNotes().length);
  }, []);

  const handleAudit = useCallback(async () => {
    const key = inputKey.trim().replace(/^0x/, "");
    if (key.length !== 64) {
      setError("Viewing key must be 64 hex characters (32 bytes).");
      return;
    }
    setError(null);
    setLoading(true);
    setSearched(false);
    try {
      const decrypted = await decryptNotes(key);
      setNotes(decrypted);
      setSearched(true);
    } catch {
      setError("Failed to decrypt notes. Check the key and try again.");
    } finally {
      setLoading(false);
    }
  }, [inputKey]);

  const totalAmount = notes.reduce((sum, n) => {
    try { return sum + parseFloat(n.amount || "0"); } catch { return sum; }
  }, 0);

  return (
    <div className="space-y-5">
      {/* Key input */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
        <div className="text-white font-semibold mb-1">Enter Viewing Key</div>
        <div className="text-gray-500 text-xs mb-4">
          Paste a viewing key shared by a user to see their transactions.
          Or go to{" "}
          <Link href="/compliance/oracle" className="text-purple-400 hover:underline">
            Oracle Access
          </Link>{" "}
          to audit without a key.
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAudit()}
            placeholder="Paste 64-char hex viewing key…"
            className="flex-1 bg-obscura-dark border border-obscura-border rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-purple-500 placeholder-gray-600"
          />
          <button
            onClick={handleAudit}
            disabled={loading || inputKey.trim().length < 64}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap"
          >
            {loading ? "Decrypting…" : "Decrypt Notes"}
          </button>
        </div>

        {error && (
          <div className="mt-3 text-red-400 text-xs">{error}</div>
        )}
      </div>

      {/* Results */}
      {searched && (
        <div className="bg-obscura-card border border-obscura-border rounded-2xl overflow-hidden">
          {/* Summary bar */}
          <div className="px-6 py-4 border-b border-obscura-border flex items-center justify-between">
            <div>
              <span className="text-white font-semibold">{notes.length}</span>
              <span className="text-gray-400 text-sm">
                {" "}of {totalCount} note{totalCount !== 1 ? "s" : ""} decrypted
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-gray-400">
                Total volume:{" "}
                <span className="text-white font-semibold">
                  {totalAmount.toFixed(4)} USDC
                </span>
              </div>
              {notes.length > 0 && (
                <span className="bg-green-900/30 border border-green-700/40 text-green-400 text-xs font-bold px-3 py-1 rounded-full">
                  ✓ KEY VALID
                </span>
              )}
            </div>
          </div>

          {notes.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-3xl mb-3">🔒</div>
              <div className="text-gray-400 text-sm">
                No notes decrypted. This key doesn&apos;t match any stored notes,
                or there are no notes yet.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-obscura-border">
              {notes.map((note) => (
                <NoteRow key={note.commitment} note={note} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state (before search) */}
      {!searched && totalCount === 0 && (
        <div className="bg-obscura-card border border-obscura-border rounded-2xl px-6 py-10 text-center">
          <div className="text-3xl mb-3">📭</div>
          <div className="text-gray-400 text-sm mb-2">No encrypted notes found in this browser.</div>
          <div className="text-gray-600 text-xs">
            Shield or transfer tokens first to create encrypted notes.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Note row component ────────────────────────────────────────────────────────

function NoteRow({ note }: { note: DecryptedNote }) {
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

  return (
    <div className="px-6 py-4 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-obscura-dark border border-obscura-border flex items-center justify-center text-xs shrink-0">
            {note.type === "shield" ? "⬇" : note.type === "bridge" ? "🌉" : "→"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${typeColor[note.type] ?? "text-white"}`}>
                {typeLabel[note.type] ?? note.type}
              </span>
              {note.decryptedBy === "oracle" && (
                <span className="bg-amber-900/30 border border-amber-700/40 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  ORACLE
                </span>
              )}
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
              className="text-purple-400 hover:text-purple-300 text-xs mt-0.5 block transition-colors"
            >
              View TX ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
