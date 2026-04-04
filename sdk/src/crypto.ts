// Cryptographic primitives for Obscura Network
// Note: uses WebCrypto (browser) or Node.js crypto

import { Note, NoteSecret, ShieldedNote } from "./types";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.crypto !== "undefined") {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
  }
  // Node.js fallback
  const { createHash } = await import("crypto");
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function bigintToBytes(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Node.js
    const { randomFillSync } = require("crypto");
    randomFillSync(buf);
  }
  return buf;
}

/** Compute note commitment = SHA256(amount || assetId || ownerPubkey || salt) */
export async function computeCommitment(note: Note): Promise<Uint8Array> {
  const data = concat(
    bigintToBytes(note.amount),
    note.assetId,
    note.ownerPubkey,
    note.salt
  );
  return sha256(data);
}

/** Compute nullifier = SHA256(spendingKey || commitment) */
export async function computeNullifier(
  secret: NoteSecret,
  note: Note
): Promise<Uint8Array> {
  const commitment = await computeCommitment(note);
  const data = concat(secret.spendingKey, commitment);
  return sha256(data);
}

/** Generate a new private note with random salt and spending key */
export async function generateNote(
  amount: bigint,
  assetId: string
): Promise<ShieldedNote> {
  const salt = randomBytes(32);
  const spendingKey = randomBytes(32);

  // ownerPubkey = SHA256(spendingKey)
  const ownerPubkey = await sha256(spendingKey);

  const note: Note = {
    amount,
    assetId: fromHex(assetId),
    ownerPubkey,
    salt,
  };

  const secret: NoteSecret = { spendingKey };

  const commitment = toHex(await computeCommitment(note));
  const nullifier = toHex(await computeNullifier(secret, note));

  return { note, secret, commitment, nullifier };
}

/** Build a Phase-1 shield proof (mock, for testnet) */
export async function buildShieldProof(shieldedNote: ShieldedNote): Promise<Uint8Array> {
  const commitment = fromHex(shieldedNote.commitment);
  const keyHash = await sha256(shieldedNote.secret.spendingKey);

  const prefix = new TextEncoder().encode("obscura-shield-v1");
  const hash = await sha256(concat(prefix, commitment, keyHash));

  // Proof = "OBSv" + hash
  const proof = new Uint8Array(36);
  proof.set(new TextEncoder().encode("OBSv"), 0);
  proof.set(hash, 4);
  return proof;
}

/** Build a Phase-1 transfer proof (mock, for testnet) */
export async function buildTransferProof(
  inputs: ShieldedNote[],
  outputs: ShieldedNote[],
  merkleRoot: Uint8Array
): Promise<Uint8Array> {
  const prefix = new TextEncoder().encode("obscura-transfer-v1");
  const inputSum = inputs.reduce((s, n) => s + n.note.amount, 0n);

  const parts: Uint8Array[] = [prefix, merkleRoot, bigintToBytes(inputSum)];
  for (const inp of inputs) {
    parts.push(fromHex(inp.commitment));
    parts.push(fromHex(inp.nullifier));
  }
  for (const out of outputs) {
    parts.push(fromHex(out.commitment));
  }

  const hash = await sha256(concat(...parts));
  const proof = new Uint8Array(36);
  proof.set(new TextEncoder().encode("OBSv"), 0);
  proof.set(hash, 4);
  return proof;
}
