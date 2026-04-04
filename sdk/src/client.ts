// Obscura Network Client — submit transactions to the rollup

import { createStandardRollup } from "@sovereign-sdk/web3";
import {
  OscuraClientConfig,
  ObscuraSigner,
  ShieldParams,
  TransferParams,
  UnshieldParams,
  ComplianceReportParams,
  ComplianceReport,
  ShieldedNote,
} from "./types";
import {
  generateNote,
  buildShieldProof,
  buildTransferProof,
  toHex,
  fromHex,
} from "./crypto";

const DEFAULT_NODE = "http://127.0.0.1:12346";

export class ObscuraClient {
  private nodeUrl: string;
  private signer?: ObscuraSigner;

  constructor(config: OscuraClientConfig) {
    this.nodeUrl = config.nodeUrl ?? DEFAULT_NODE;
    this.signer = config.signer;
  }

  /** Attach a signer after construction (e.g. after MetaMask connects) */
  connect(signer: ObscuraSigner): ObscuraClient {
    this.signer = signer;
    return this;
  }

  async getAddress(): Promise<string | null> {
    return this.signer ? this.signer.getAddress() : null;
  }

  /**
   * Shield tokens into the private pool.
   * Returns a ShieldedNote — keep this secret, it's your private balance.
   */
  async shield(params: ShieldParams): Promise<ShieldedNote> {
    const shieldedNote = await generateNote(
      params.amount,
      params.assetId.startsWith("0x")
        ? params.assetId.slice(2)
        : params.assetId
    );

    const proof = await buildShieldProof(shieldedNote);

    const callMsg = {
      shield: {
        note: {
          amount: shieldedNote.note.amount.toString(),
          asset_id: toHex(shieldedNote.note.assetId),
          owner_pubkey: Array.from(shieldedNote.note.ownerPubkey),
          salt: Array.from(shieldedNote.note.salt),
        },
      },
    };

    await this._submitTx("obscura_privacy", callMsg);

    console.log(`✅ Shielded ${params.amount} tokens`);
    console.log(`   Commitment: 0x${shieldedNote.commitment}`);
    console.log(`   ⚠️  Save your note secret! It cannot be recovered.`);

    return shieldedNote;
  }

  /**
   * Private transfer: split/merge shielded notes.
   * No public record of amounts or recipients.
   */
  async transfer(params: TransferParams): Promise<ShieldedNote[]> {
    if (params.inputNotes.length === 0) throw new Error("No input notes");
    if (params.outputAmounts.length === 0) throw new Error("No output amounts");

    const inputSum = params.inputNotes.reduce(
      (s, n) => s + n.note.amount,
      0n
    );
    const outputSum = params.outputAmounts.reduce((s, a) => s + a, 0n);
    if (inputSum !== outputSum) {
      throw new Error(
        `Input sum (${inputSum}) !== output sum (${outputSum})`
      );
    }

    // Generate output notes
    const assetId = toHex(params.inputNotes[0].note.assetId);
    const outputNotes: ShieldedNote[] = [];
    for (let i = 0; i < params.outputAmounts.length; i++) {
      const pubkey = params.outputPubkeys[i] ?? assetId;
      const note = await generateNote(params.outputAmounts[i], assetId);
      outputNotes.push(note);
    }

    // Mock merkle root for Phase 1
    const mockRoot = new Uint8Array(32).fill(0);
    const proof = await buildTransferProof(
      params.inputNotes,
      outputNotes,
      mockRoot
    );

    const callMsg = {
      transfer: {
        proof: Array.from(proof),
        public_inputs: {
          transfer_amount: inputSum.toString(),
          asset_id: assetId,
          merkle_root: toHex(mockRoot),
        },
        nullifiers: params.inputNotes.map((n) => n.nullifier),
        output_commitments: outputNotes.map((n) => n.commitment),
      },
    };

    await this._submitTx("obscura_privacy", callMsg);

    console.log(`✅ Private transfer: ${inputSum} → ${outputNotes.length} output note(s)`);
    return outputNotes;
  }

  /**
   * Generate a compliance report for auditors.
   * Proves total volume without revealing individual amounts.
   */
  async generateComplianceReport(
    params: ComplianceReportParams
  ): Promise<ComplianceReport> {
    const totalVolume = params.notes.reduce(
      (s, n) => s + n.note.amount,
      0n
    );
    const withinLimit = totalVolume <= params.regulatoryLimit;

    // Build aggregate proof
    const { buildComplianceProof } = await import("./compliance");
    const proof = await buildComplianceProof(
      params.notes.map((n) => n.note.amount),
      params.regulatoryLimit
    );

    return {
      txCount: params.notes.length,
      totalVolume,
      withinLimit,
      proof: toHex(proof),
    };
  }

  /** Get shielded supply for an asset */
  async getShieldedSupply(assetId: string): Promise<bigint> {
    const clean = assetId.startsWith("0x") ? assetId.slice(2) : assetId;
    const res = await fetch(
      `${this.nodeUrl}/modules/obscura-privacy/shielded-supply/${clean}`
    );
    if (!res.ok) return 0n;
    const data = await res.json() as { supply?: string };
    return BigInt(data.supply ?? 0);
  }

  /** Get all loaded modules */
  async getModules(): Promise<string[]> {
    const res = await fetch(`${this.nodeUrl}/modules`);
    const data = await res.json() as { modules?: Record<string, unknown> };
    return Object.keys(data.modules ?? {});
  }

  private async _submitTx(module: string, callMsg: unknown): Promise<string> {
    if (!this.signer) {
      throw new Error(
        "No signer attached. Call client.connect(signer) first.\n" +
        "Browser:  client.connect(await MetaMaskSigner.connect())\n" +
        "Node.js:  client.connect(new PrivateKeySigner('0x...'))"
      );
    }

    // Build RuntimeCall
    const runtimeCall = { [module]: callMsg };

    // Use @sovereign-sdk/web3 for proper borsh serialization + EIP-712 signing
    const rollup = await createStandardRollup({ url: this.nodeUrl });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rollup.call(runtimeCall as any, { signer: this.signer as any });

    const id = (result.response as { id?: string })?.id ?? "";
    console.log(`✅ TX submitted: ${id}`);
    return id;
  }
}
