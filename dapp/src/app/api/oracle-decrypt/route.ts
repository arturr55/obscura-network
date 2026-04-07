import { NextRequest, NextResponse } from "next/server";

// Oracle decrypt key lives server-side only — never exposed to browser
const ORACLE_DECRYPT_KEY = process.env.ORACLE_DECRYPT_KEY;

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function decryptWithKey(blob: Uint8Array, keyHex: string): Promise<string | null> {
  if (blob.length < 13) return null;
  try {
    const keyBytes = fromHex(keyHex);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes.buffer as ArrayBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const iv = blob.slice(0, 12);
    const ciphertext = blob.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext.buffer as ArrayBuffer
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * POST /api/oracle-decrypt
 * Body: { notes: Array<{ commitment: string; enc_oracle: string; createdAt: number }> }
 * Returns: { decrypted: Array<NoteContent & { commitment: string }> }
 *
 * The oracle decryption key never leaves the server.
 */
export async function POST(req: NextRequest) {
  if (!ORACLE_DECRYPT_KEY) {
    return NextResponse.json({ error: "Oracle key not configured" }, { status: 503 });
  }

  const body = await req.json() as {
    notes: Array<{ commitment: string; enc_oracle: string; createdAt: number }>;
  };

  if (!Array.isArray(body?.notes)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const decrypted: unknown[] = [];

  for (const enc of body.notes) {
    try {
      const blob = fromHex(enc.enc_oracle);
      const plain = await decryptWithKey(blob, ORACLE_DECRYPT_KEY);
      if (plain) {
        const content = JSON.parse(plain);
        decrypted.push({ ...content, commitment: enc.commitment, decryptedBy: "oracle" });
      }
    } catch {
      // skip malformed notes
    }
  }

  return NextResponse.json({ decrypted });
}
