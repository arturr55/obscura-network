/**
 * Viewing key cryptography for Obscura Network dApp.
 *
 * Uses WebCrypto AES-256-GCM — universally supported in all modern browsers.
 *
 * DUAL ENCRYPTION MODEL:
 * Every note is encrypted twice:
 *   1. enc_user    — with the USER's viewing key (voluntary disclosure)
 *   2. enc_oracle  — with the COMPLIANCE ORACLE key (mandatory, always accessible)
 *
 * This means:
 * - Users share enc_user key voluntarily with private auditors
 * - Compliance oracle (ZKCompliance / regulator) can ALWAYS decrypt enc_oracle
 *   without any cooperation from the user
 *
 * Key format: 32 bytes as lowercase hex string (64 chars)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Oracle encryption key — used in the browser to encrypt notes for the compliance oracle.
 * Set via NEXT_PUBLIC_ORACLE_ENC_KEY env var. The matching decryption key lives
 * server-side only (ORACLE_DECRYPT_KEY) and is never sent to the browser.
 */
export const ORACLE_KEY_HEX =
  process.env.NEXT_PUBLIC_ORACLE_ENC_KEY ??
  "d47ee5dbcced129e126c8a6e54d369eaad0125e580f745ef94d74ed243b23678";

const STORAGE_KEY_VIEWING = "obscura_viewing_key";
const STORAGE_KEY_ENC_NOTES = "obscura_enc_notes";

/** Keys for wallet-derived viewing key (deterministic, same on all devices). */
const STORAGE_KEY_DERIVED_KEY  = "obscura_vk_derived";
const STORAGE_KEY_DERIVED_ADDR = "obscura_vk_address";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NoteContent {
  amount: string;      // human-readable (e.g. "5.0")
  amountRaw: string;   // raw token units
  assetId: string;
  commitment: string;
  memo: string;
  txHash?: string;
  createdAt: number;   // unix ms
  type: "shield" | "transfer" | "bridge";
}

export interface EncryptedNote {
  commitment: string;          // public identifier
  enc_user: string;            // hex — encrypted with user's viewing key
  enc_oracle: string;          // hex — encrypted with oracle key (always readable)
  createdAt: number;
}

export interface DecryptedNote extends NoteContent {
  commitment: string;
  decryptedBy: "user" | "oracle";
}

// ── Key management ────────────────────────────────────────────────────────────

/** Generate a new random 32-byte viewing key. */
export function generateViewingKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

/** Get or create the user's viewing key from localStorage. */
export function getOrCreateViewingKey(): string {
  if (typeof window === "undefined") return generateViewingKey();
  let key = localStorage.getItem(STORAGE_KEY_VIEWING);
  if (!key || key.length !== 64) {
    key = generateViewingKey();
    localStorage.setItem(STORAGE_KEY_VIEWING, key);
  }
  return key;
}

/** Save a new viewing key to localStorage (replaces existing). */
export function saveViewingKey(keyHex: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY_VIEWING, keyHex);
  }
}

// ── Encryption / Decryption ───────────────────────────────────────────────────

/**
 * Encrypt plaintext bytes with a 32-byte hex key using AES-256-GCM.
 * Returns: iv (12 bytes) || ciphertext+tag as Uint8Array.
 */
export async function encryptWithKey(
  plaintext: Uint8Array,
  keyHex: string
): Promise<Uint8Array> {
  const keyBytes = fromHex(keyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes).buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new Uint8Array(plaintext).buffer as ArrayBuffer
  );
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/**
 * Decrypt bytes with a 32-byte hex key.
 * Returns plaintext, or null if key is wrong or data is corrupted.
 */
export async function decryptWithKey(
  blob: Uint8Array,
  keyHex: string
): Promise<Uint8Array | null> {
  if (blob.length < 13) return null;
  try {
    const keyBytes = fromHex(keyHex);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyBytes).buffer as ArrayBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const iv = blob.slice(0, 12);
    const ciphertext = blob.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      new Uint8Array(ciphertext).buffer as ArrayBuffer
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

// ── Dual-encrypted note storage ───────────────────────────────────────────────

/**
 * Create a dual-encrypted note and save it to localStorage.
 * Both user key and oracle key encryptions are stored.
 */
export async function saveEncryptedNote(
  content: NoteContent,
  userKeyHex?: string
): Promise<void> {
  const key = userKeyHex ?? getOrCreateViewingKey();
  const plaintext = new TextEncoder().encode(JSON.stringify(content));

  const encUser = await encryptWithKey(plaintext, key);
  const encOracle = await encryptWithKey(plaintext, ORACLE_KEY_HEX);

  const enc: EncryptedNote = {
    commitment: content.commitment,
    enc_user: toHex(encUser),
    enc_oracle: toHex(encOracle),
    createdAt: content.createdAt,
  };

  const existing = loadEncryptedNotes();
  const idx = existing.findIndex((n) => n.commitment === content.commitment);
  if (idx >= 0) {
    existing[idx] = enc;
  } else {
    existing.unshift(enc);
  }
  localStorage.setItem(STORAGE_KEY_ENC_NOTES, JSON.stringify(existing));
}

/** Load all encrypted notes from localStorage. */
export function loadEncryptedNotes(): EncryptedNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENC_NOTES);
    return raw ? (JSON.parse(raw) as EncryptedNote[]) : [];
  } catch {
    return [];
  }
}

/**
 * Decrypt all notes using a viewing key (user key or oracle key).
 * Returns only the notes that successfully decrypt.
 */
export async function decryptNotes(
  viewingKeyHex: string
): Promise<DecryptedNote[]> {
  const notes = loadEncryptedNotes();
  const isOracle = viewingKeyHex.toLowerCase() === ORACLE_KEY_HEX.toLowerCase();
  const results: DecryptedNote[] = [];

  for (const enc of notes) {
    // Try user encryption first, then oracle encryption
    const blobUser = fromHex(enc.enc_user);
    const blobOracle = fromHex(enc.enc_oracle);

    let plaintext: Uint8Array | null = null;
    let decryptedBy: "user" | "oracle" = "user";

    if (isOracle) {
      // Oracle key: decrypt enc_oracle
      plaintext = await decryptWithKey(blobOracle, viewingKeyHex);
      decryptedBy = "oracle";
    } else {
      // User key: try enc_user
      plaintext = await decryptWithKey(blobUser, viewingKeyHex);
      if (!plaintext) {
        // Fallback: maybe they pasted the oracle key with user prefix
        plaintext = await decryptWithKey(blobOracle, viewingKeyHex);
        if (plaintext) decryptedBy = "oracle";
      }
    }

    if (plaintext) {
      try {
        const content = JSON.parse(new TextDecoder().decode(plaintext)) as NoteContent;
        results.push({ ...content, commitment: enc.commitment, decryptedBy });
      } catch {
        // malformed — skip
      }
    }
  }

  return results;
}

// ── Wallet-derived viewing key ────────────────────────────────────────────────

/**
 * Derive a deterministic 32-byte viewing key from a wallet signature.
 * The message "obscura-viewing-key-v1" is signed; the signature is hashed
 * with SHA-256, giving the same key on every device that holds the same wallet.
 */
export async function deriveViewingKeyFromSignature(signature: string): Promise<string> {
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  const sigBytes = fromHex(hex);
  const hash = await crypto.subtle.digest("SHA-256", sigBytes.buffer as ArrayBuffer);
  return toHex(new Uint8Array(hash));
}

/** Return the cached wallet-derived key for `address`, or null if not cached. */
export function getCachedDerivedKey(address: string): string | null {
  if (typeof window === "undefined") return null;
  const cachedAddr = localStorage.getItem(STORAGE_KEY_DERIVED_ADDR);
  if (cachedAddr?.toLowerCase() !== address.toLowerCase()) return null;
  return localStorage.getItem(STORAGE_KEY_DERIVED_KEY);
}

/** Persist a wallet-derived key for `address`. */
export function saveDerivedKey(address: string, keyHex: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_DERIVED_ADDR, address.toLowerCase());
  localStorage.setItem(STORAGE_KEY_DERIVED_KEY, keyHex);
}

// ── On-chain note encoding ────────────────────────────────────────────────────

/**
 * Encrypt a note with both user + oracle keys and return raw bytes
 * suitable for including in a Shield / Transfer rollup TX message.
 * Format on-chain: JSON-encoded EncryptedNote → UTF-8 bytes.
 */
export async function encodeNoteForChain(
  content: NoteContent,
  userKeyHex: string
): Promise<number[]> {
  const plaintext = new TextEncoder().encode(JSON.stringify(content));
  const encUser   = await encryptWithKey(plaintext, userKeyHex);
  const encOracle = await encryptWithKey(plaintext, ORACLE_KEY_HEX);

  const enc: EncryptedNote = {
    commitment: content.commitment,
    enc_user:   toHex(encUser),
    enc_oracle: toHex(encOracle),
    createdAt:  content.createdAt,
  };
  return Array.from(new TextEncoder().encode(JSON.stringify(enc)));
}

// ── Chain fetching & scanning ─────────────────────────────────────────────────

/**
 * Fetch a single encrypted note from the rollup by commitment hash.
 * Returns null if not found or the rollup doesn't expose it yet.
 */
export async function fetchEncryptedNoteFromChain(
  commitment: string
): Promise<EncryptedNote | null> {
  try {
    const key = commitment.startsWith("0x") ? commitment : `0x${commitment}`;
    const res = await fetch(
      `/api/node?path=/modules/obscura-privacy/state/encrypted_notes/${encodeURIComponent(key)}`
    );
    if (!res.ok) return null;
    const data = await res.json() as { value?: string };
    if (!data?.value) return null;
    // Sovereign SDK returns base64-encoded bytes for Vec<u8> state values
    const bytes = Uint8Array.from(atob(data.value), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as EncryptedNote;
  } catch {
    return null;
  }
}

/**
 * Fetch all commitment hashes from the rollup (paged, up to 1000).
 * Returns hex strings like "0xabc123…".
 */
export async function fetchAllCommitmentsFromChain(): Promise<string[]> {
  try {
    const res = await fetch(
      "/api/node?path=/modules/obscura-privacy/state/commitments?start=0&limit=1000"
    );
    if (!res.ok) return [];
    const data = await res.json() as { length?: number; items?: unknown[] };
    if (!data?.items?.length) return [];
    return (data.items as Array<string | { hash: string }>).map((c) =>
      typeof c === "string" ? c : c.hash
    );
  } catch {
    return [];
  }
}

/**
 * Scan the rollup for notes that can be decrypted with `viewingKeyHex`.
 * Newly found notes are also merged into localStorage for caching.
 * Returns the number of new notes discovered.
 */
export async function scanChainForMyNotes(
  viewingKeyHex: string
): Promise<{ found: number; total: number }> {
  const commitments = await fetchAllCommitmentsFromChain();
  const existing = loadEncryptedNotes();
  const existingSet = new Set(existing.map((n) => n.commitment));

  let found = 0;
  const merged = [...existing];

  for (const commitment of commitments) {
    if (existingSet.has(commitment)) continue; // already cached locally

    const enc = await fetchEncryptedNoteFromChain(commitment);
    if (!enc) continue;

    // Try decrypting with user's key — if it works, this note belongs to us
    const plain = await decryptWithKey(fromHex(enc.enc_user), viewingKeyHex);
    if (plain) {
      merged.unshift(enc);
      existingSet.add(commitment);
      found++;
    }
  }

  if (found > 0) {
    localStorage.setItem(STORAGE_KEY_ENC_NOTES, JSON.stringify(merged));
  }

  return { found, total: commitments.length };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Short display form of a key or hash: 0x1234…abcd */
export function shortKey(hex: string, chars = 8): string {
  const clean = hex.replace(/^0x/, "");
  return `0x${clean.slice(0, chars)}…${clean.slice(-chars)}`;
}
