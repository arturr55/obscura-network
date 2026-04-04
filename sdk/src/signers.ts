/**
 * Obscura Network Signers
 *
 * Two modes:
 * - MetaMaskSigner  — browser, uses window.ethereum + Eip712Signer
 * - PrivateKeySigner — Node.js / testing, uses @sovereign-sdk/signers Secp256k1Signer
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Secp256k1Signer } = require("@sovereign-sdk/signers");
import { getPublicKey } from "@noble/secp256k1";
import type { ObscuraSigner } from "./types";

// Minimal EIP-1193 provider interface
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

// ─── MetaMask (browser) ────────────────────────────────────────────────────

export class MetaMaskSigner implements ObscuraSigner {
  private provider: Eip1193Provider;
  private address: string;

  constructor(provider: Eip1193Provider, address: string) {
    this.provider = provider;
    this.address = address;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  /** Used by @sovereign-sdk/web3 internally via Eip712Signer */
  async sign(message: Uint8Array): Promise<Uint8Array> {
    const hex = "0x" + Array.from(message).map((b) => b.toString(16).padStart(2, "0")).join("");
    const sig = await this.provider.request({
      method: "personal_sign",
      params: [hex, this.address],
    }) as string;
    return Uint8Array.from(Buffer.from(sig.slice(2), "hex"));
  }

  async publicKey(): Promise<Uint8Array> {
    // MetaMask doesn't expose public keys directly; return compressed from address recovery
    // For EIP-712 the Eip712Signer from @sovereign-sdk/signers/wasm handles this
    throw new Error("Use Eip712Signer from @sovereign-sdk/signers/wasm for MetaMask");
  }

  /** Connect MetaMask and return a signer (browser only) */
  static async connect(): Promise<MetaMaskSigner> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (globalThis as any).window?.ethereum as Eip1193Provider | undefined;
    if (!eth) throw new Error("MetaMask not installed");

    const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
    if (!accounts[0]) throw new Error("No accounts found");
    return new MetaMaskSigner(eth, accounts[0]);
  }
}

// ─── Private Key (Node.js / testing) ──────────────────────────────────────

export class PrivateKeySigner implements ObscuraSigner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inner: any;
  private privBytes: Uint8Array;

  constructor(privateKey: `0x${string}`) {
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    this.privBytes = Uint8Array.from(Buffer.from(hex, "hex"));
    this.inner = new Secp256k1Signer(this.privBytes);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.inner.sign(message);
  }

  async publicKey(): Promise<Uint8Array> {
    return this.inner.publicKey();
  }

  async getAddress(): Promise<string> {
    // Derive Ethereum address from secp256k1 public key
    const pubKey = getPublicKey(this.privBytes, false); // uncompressed
    const { keccak256 } = await import("viem");
    const hash = keccak256(pubKey.slice(1)); // remove 0x04 prefix
    return "0x" + hash.slice(-40);
  }
}
