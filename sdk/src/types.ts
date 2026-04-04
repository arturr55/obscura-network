// Core types for Obscura Network SDK

export interface Note {
  amount: bigint;
  assetId: Uint8Array; // 32 bytes
  ownerPubkey: Uint8Array; // 32 bytes
  salt: Uint8Array; // 32 bytes
}

export interface NoteSecret {
  spendingKey: Uint8Array; // 32 bytes
}

export interface ShieldedNote {
  note: Note;
  secret: NoteSecret;
  commitment: string; // hex
  nullifier: string; // hex
}

export interface ShieldParams {
  amount: bigint;
  assetId: string; // hex, 32 bytes
  nodeUrl?: string;
}

export interface TransferParams {
  inputNotes: ShieldedNote[];
  outputAmounts: bigint[];
  outputPubkeys: string[]; // hex, 32 bytes each
  nodeUrl?: string;
}

export interface UnshieldParams {
  note: ShieldedNote;
  recipient: string; // 0x address
  nodeUrl?: string;
}

export interface ComplianceReportParams {
  notes: ShieldedNote[];
  regulatoryLimit: bigint;
}

export interface ComplianceReport {
  txCount: number;
  totalVolume: bigint;
  withinLimit: boolean;
  proof: string; // hex
}

// Signer interface compatible with @sovereign-sdk/web3
// sign(bytes) + publicKey() — what the SDK expects under the hood
export interface ObscuraSigner {
  sign(message: Uint8Array): Promise<Uint8Array>;
  publicKey(): Promise<Uint8Array>;
  getAddress(): Promise<string>;
}

export interface OscuraClientConfig {
  nodeUrl: string; // e.g. "http://127.0.0.1:12346"
  chainId?: number;
  signer?: ObscuraSigner;
}
