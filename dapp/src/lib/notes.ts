/**
 * Note manager — localStorage-based storage for shielded notes
 */

export interface StoredNote {
  id: string;
  type: "shield" | "transfer_out";
  commitment: string;
  nullifier: string;
  amount: string;       // raw units (nano-tokens)
  asset_id: string;
  createdAt: number;    // unix ms
  spent: boolean;
  txHash?: string;
  label?: string;
}

const STORAGE_KEY = "obscura_notes";

export function loadNotes(): StoredNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredNote[]) : [];
  } catch {
    return [];
  }
}

export function saveNote(note: Omit<StoredNote, "id" | "createdAt" | "spent">): StoredNote {
  const full: StoredNote = {
    ...note,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    spent: false,
  };
  const notes = loadNotes();
  notes.unshift(full);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  return full;
}

export function markNoteSpent(id: string): void {
  const notes = loadNotes();
  const note = notes.find((n) => n.id === id);
  if (note) {
    note.spent = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }
}

export function deleteNote(id: string): void {
  const notes = loadNotes().filter((n) => n.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export function exportNotes(): void {
  const notes = loadNotes();
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `obscura-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importNotes(json: string): number {
  const incoming = JSON.parse(json) as StoredNote[];
  const existing = loadNotes();
  const existingIds = new Set(existing.map((n) => n.id));
  const newNotes = incoming.filter((n) => !existingIds.has(n.id));
  const merged = [...newNotes, ...existing];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return newNotes.length;
}

/** Format raw amount to human-readable (divides by 1e9) */
export function formatAmount(raw: string): string {
  const n = Number(raw) / 1e9;
  return n % 1 === 0 ? n.toString() : n.toFixed(4);
}
