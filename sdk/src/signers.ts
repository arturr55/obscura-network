/**
 * Obscura Network Signers
 *
 * Two modes:
 * - MetaMaskSigner  — browser, uses window.ethereum + EIP-712
 * - PrivateKeySigner — Node.js / testing, uses viem's local account
 */

import { privateKeyToAccount, signTypedData } from "viem/accounts";
import type { ObscuraSigner } from "./types";

const OBSCURA_CHAIN_ID = 9977;

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

  /** Sign an EIP-712 typed-data message (Sovereign SDK standard) */
  async signTransaction(tx: unknown, schema: unknown): Promise<string> {
    const typedData = buildEip712TypedData(tx, schema, OBSCURA_CHAIN_ID);

    const signature = await this.provider.request({
      method: "eth_signTypedData_v4",
      params: [this.address, JSON.stringify(typedData)],
    }) as string;

    return signature;
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
  private privateKey: `0x${string}`;
  private address: `0x${string}`;

  constructor(privateKey: `0x${string}`) {
    this.privateKey = privateKey;
    this.address = privateKeyToAccount(privateKey).address;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signTransaction(tx: unknown, schema: unknown): Promise<string> {
    const typedData = buildEip712TypedData(tx, schema, OBSCURA_CHAIN_ID);
    const account = privateKeyToAccount(this.privateKey);

    const signature = await signTypedData({
      privateKey: this.privateKey,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    void account; // used above
    return signature;
  }
}

// ─── EIP-712 helpers ────────────────────────────────────────────────────────

function buildEip712TypedData(tx: unknown, _schema: unknown, chainId: number) {
  return {
    domain: {
      name: "Obscura Network",
      version: "1",
      chainId: BigInt(chainId),
    } as const,
    types: {
      Transaction: [
        { name: "call", type: "bytes" },
        { name: "nonce", type: "uint64" },
      ],
    } as const,
    primaryType: "Transaction" as const,
    message: {
      call: encodeCall(tx) as `0x${string}`,
      nonce: BigInt(Date.now()),
    },
  };
}

function encodeCall(tx: unknown): string {
  const json = JSON.stringify(tx);
  const bytes = new TextEncoder().encode(json);
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
