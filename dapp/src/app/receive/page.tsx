"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { saveNote, type StoredNote } from "@/lib/notes";
import { addHistoryEntry } from "@/lib/history";

interface ReceivedNote {
  commitment: string;
  nullifier: string;
  amount: string;
  asset_id: string;
  from?: string;   // optional sender hint
  message?: string; // optional message from sender
}

export default function ReceivePage() {
  const [state, setState] = useState<"loading" | "found" | "saved" | "invalid" | "empty">("loading");
  const [note, setNote] = useState<ReceivedNote | null>(null);
  const [alreadySaved, setAlreadySaved] = useState(false);

  useEffect(() => {
    const fragment = window.location.hash.slice(1); // remove #
    if (!fragment) {
      setState("empty");
      return;
    }
    try {
      const decoded = atob(fragment.replace(/-/g, "+").replace(/_/g, "/"));
      const parsed = JSON.parse(decoded) as ReceivedNote;
      if (!parsed.commitment || !parsed.nullifier || !parsed.amount) {
        setState("invalid");
        return;
      }
      setNote(parsed);
      setState("found");
    } catch {
      setState("invalid");
    }
  }, []);

  function handleSave() {
    if (!note) return;

    const stored: Omit<StoredNote, "id" | "createdAt" | "spent"> = {
      type: "transfer_out",
      commitment: note.commitment,
      nullifier: note.nullifier,
      amount: note.amount,
      asset_id: note.asset_id,
      label: note.from ? `Received from ${note.from.slice(0, 10)}...` : "Received via link",
    };
    saveNote(stored);
    addHistoryEntry({
      type: "transfer",
      status: "success",
      amount: note.amount,
      note: note.from ? `Received from ${note.from.slice(0, 10)}...` : "Received via link",
    });
    setAlreadySaved(true);
    setState("saved");
    // Clear fragment so reloading doesn't re-save
    window.history.replaceState(null, "", window.location.pathname);
  }

  const amount = note ? (Number(note.amount) / 1e9).toFixed(4) : "0";

  return (
    <main className="max-w-lg mx-auto px-4 py-24 text-center">
      {state === "loading" && (
        <div className="text-gray-400">Loading note...</div>
      )}

      {state === "empty" && (
        <>
          <div className="text-6xl mb-4">📭</div>
          <h1 className="text-2xl font-bold text-white mb-3">No note found</h1>
          <p className="text-gray-400 mb-6">
            This page is used to receive shielded notes. Ask the sender to share a note link.
          </p>
          <Link href="/send" className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors">
            Go to Send TX
          </Link>
        </>
      )}

      {state === "invalid" && (
        <>
          <div className="text-6xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-white mb-3">Invalid note link</h1>
          <p className="text-gray-400 mb-6">
            The link is corrupted or expired. Ask the sender to generate a new one.
          </p>
          <Link href="/send" className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors">
            Go to Send TX
          </Link>
        </>
      )}

      {state === "found" && note && (
        <>
          <div className="text-6xl mb-4">🎁</div>
          <h1 className="text-2xl font-bold text-white mb-2">You received a shielded note!</h1>
          <p className="text-gray-400 mb-6">
            Someone sent you <span className="text-white font-semibold">{amount} tokens</span> on Obscura Network.
            Save the note to spend it.
          </p>

          {note.message && (
            <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 mb-4 text-left">
              <div className="text-gray-400 text-xs mb-1">Message from sender:</div>
              <div className="text-white text-sm">{note.message}</div>
            </div>
          )}

          <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 mb-6 text-left">
            <div className="text-gray-400 text-xs mb-2">Note details:</div>
            <div className="space-y-1.5 text-xs font-mono text-gray-300">
              <div><span className="text-gray-500">amount: </span>{amount} tokens</div>
              <div className="truncate"><span className="text-gray-500">commitment: </span>{note.commitment.slice(0, 24)}...</div>
              <div className="truncate"><span className="text-gray-500">nullifier: </span>{note.nullifier.slice(0, 24)}...</div>
              {note.from && <div><span className="text-gray-500">from: </span>{note.from.slice(0, 14)}...</div>}
            </div>
          </div>

          <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-6">
            ⚠ Save the note now — this link works only once.
            After saving, you can use it in Transfer or Unshield.
          </div>

          <button
            onClick={handleSave}
            disabled={alreadySaved}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors mb-3"
          >
            Save Note to My Wallet
          </button>
          <Link href="/notes" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            View all my notes →
          </Link>
        </>
      )}

      {state === "saved" && (
        <>
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-white mb-2">Note saved!</h1>
          <p className="text-gray-400 mb-8">
            <span className="text-white font-semibold">{amount} tokens</span> are now in your note wallet.
            You can transfer or unshield them anytime.
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/notes" className="bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-semibold transition-colors block">
              View My Notes →
            </Link>
            <Link href="/send" className="border border-obscura-border text-gray-400 hover:text-white py-3 rounded-xl font-semibold transition-colors block text-sm">
              Send TX
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
