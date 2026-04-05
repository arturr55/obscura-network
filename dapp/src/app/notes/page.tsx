"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  loadNotes,
  markNoteSpent,
  deleteNote,
  exportNotes,
  importNotes,
  formatAmount,
  type StoredNote,
} from "@/lib/notes";

export default function NotesPage() {
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [filter, setFilter] = useState<"all" | "unspent" | "spent">("unspent");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    setNotes(loadNotes());
  }, []);

  function refresh() {
    setNotes(loadNotes());
  }

  function handleMarkSpent(id: string) {
    markNoteSpent(id);
    refresh();
  }

  function handleDelete(id: string) {
    if (confirm("Delete this note permanently?")) {
      deleteNote(id);
      refresh();
    }
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const count = importNotes(ev.target?.result as string);
        setImportMsg(`Imported ${count} new note(s)`);
        refresh();
      } catch {
        setImportMsg("Import failed — invalid file");
      }
      setTimeout(() => setImportMsg(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function useInSend(note: StoredNote, mode: "transfer" | "unshield") {
    const noteJson = JSON.stringify({
      commitment: note.commitment,
      nullifier: note.nullifier,
      amount: note.amount,
      asset_id: note.asset_id,
    });
    sessionStorage.setItem("obscura_selected_note", noteJson);
    sessionStorage.setItem("obscura_selected_tab", mode);
    router.push("/send");
  }

  const filtered = notes.filter((n) => {
    if (filter === "unspent") return !n.spent;
    if (filter === "spent") return n.spent;
    return true;
  });

  const unspentCount = notes.filter((n) => !n.spent).length;

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/send" className="text-gray-500 hover:text-white transition-colors text-sm">← Send TX</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white">My Notes</h1>
        <span className="ml-2 bg-purple-600/30 text-purple-300 text-xs px-2 py-0.5 rounded-full">
          {unspentCount} unspent
        </span>
      </div>

      {/* Warning */}
      <div className="border border-yellow-700/40 bg-yellow-900/20 rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
        <span className="text-yellow-400 text-lg mt-0.5">⚠</span>
        <div className="text-yellow-300 text-sm">
          <strong>Notes are stored only in this browser.</strong> If you clear cache or switch browsers they will be lost.
          <button onClick={exportNotes} className="ml-2 underline hover:no-underline text-yellow-200">
            Export backup →
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={exportNotes}
          className="border border-obscura-border text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Export JSON
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="border border-obscura-border text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Import JSON
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        {importMsg && (
          <span className="text-green-400 text-sm py-2 px-2">{importMsg}</span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(["unspent", "all", "spent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? "bg-purple-600 text-white"
                : "border border-obscura-border text-gray-400 hover:text-white"
            }`}
          >
            {f === "unspent" ? "Unspent" : f === "spent" ? "Spent" : "All"}
          </button>
        ))}
      </div>

      {/* Notes list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {filter === "unspent"
            ? "No unspent notes. Shield some tokens to create a note."
            : "No notes found."}
          {filter === "unspent" && (
            <div className="mt-4">
              <Link href="/send" className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                Shield Tokens →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onMarkSpent={handleMarkSpent}
              onDelete={handleDelete}
              onUse={useInSend}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function NoteCard({
  note,
  onMarkSpent,
  onDelete,
  onUse,
}: {
  note: StoredNote;
  onMarkSpent: (id: string) => void;
  onDelete: (id: string) => void;
  onUse: (note: StoredNote, mode: "transfer" | "unshield") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const amount = formatAmount(note.amount);
  const date = new Date(note.createdAt).toLocaleString();

  return (
    <div className={`bg-obscura-card border rounded-xl p-4 transition-all ${
      note.spent ? "border-gray-700/40 opacity-60" : "border-obscura-border"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              note.spent
                ? "bg-gray-700/50 text-gray-400"
                : "bg-green-900/40 text-green-300"
            }`}>
              {note.spent ? "spent" : "unspent"}
            </span>
            <span className="text-xs text-gray-500">
              {note.type === "shield" ? "🔒 Shield" : "🔄 Transfer"}
            </span>
            <span className="text-xs text-gray-600">{date}</span>
          </div>
          <div className="text-white font-semibold text-lg">{amount} tokens</div>
          <div className="text-gray-500 text-xs font-mono truncate mt-0.5">
            commitment: {note.commitment.slice(0, 18)}...
          </div>
          {note.txHash && (
            <div className="text-gray-600 text-xs font-mono truncate">
              tx: {note.txHash.slice(0, 18)}...
            </div>
          )}
        </div>

        {!note.spent && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => onUse(note, "transfer")}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >
              Transfer →
            </button>
            <button
              onClick={() => onUse(note, "unshield")}
              className="border border-obscura-border text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >
              Unshield →
            </button>
          </div>
        )}
      </div>

      {/* Expand/collapse full JSON */}
      <div className="mt-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? "▲ Hide JSON" : "▼ Show full note JSON"}
        </button>
        {expanded && (
          <div className="mt-2 relative">
            <pre className="bg-obscura-dark border border-obscura-border rounded-lg p-3 text-xs text-gray-300 overflow-auto max-h-40 font-mono">
              {JSON.stringify(
                { commitment: note.commitment, nullifier: note.nullifier, amount: note.amount, asset_id: note.asset_id },
                null,
                2
              )}
            </pre>
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  JSON.stringify({
                    commitment: note.commitment,
                    nullifier: note.nullifier,
                    amount: note.amount,
                    asset_id: note.asset_id,
                  }, null, 2)
                )
              }
              className="absolute top-2 right-2 text-xs text-purple-400 hover:text-purple-300 bg-obscura-dark px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Secondary actions */}
      <div className="flex gap-3 mt-2">
        {!note.spent && (
          <button
            onClick={() => onMarkSpent(note.id)}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Mark as spent
          </button>
        )}
        <button
          onClick={() => onDelete(note.id)}
          className="text-xs text-red-800 hover:text-red-500 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
