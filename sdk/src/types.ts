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

// Signer interface — works with MetaMask (browser) or private key (Node.js)
export interface ObscuraSigner {
  getAddress(): Promise<string>;
  signTransaction(tx: unknown, schema: unknown): Promise<string>;
}

export interface OscuraClientConfig {
  nodeUrl: string; // e.g. "http://127.0.0.1:12346"
  chainId?: number;
  signer?: ObscuraSigner;
}
