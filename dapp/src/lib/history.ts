/**
 * TX History — localStorage-based transaction log
 */

export type TxHistoryType =
  | "shield"
  | "transfer"
  | "unshield"
  | "bridge"
  | "withdraw";

export type TxHistoryStatus = "success" | "pending" | "failed";

export interface TxHistoryEntry {
  id: string;
  type: TxHistoryType;
  status: TxHistoryStatus;
  timestamp: number;       // unix ms
  amount?: string;         // raw units
  amountUsdc?: string;     // for bridge/withdraw (6 decimals)
  txHash?: string;         // Obscura TX hash
  ethTxHash?: string;      // Ethereum TX hash
  depositId?: number;      // for bridge/withdraw
  recipient?: string;      // for transfer/withdraw
  note?: string;           // brief label
}

const STORAGE_KEY = "obscura_history";

export function loadHistory(): TxHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TxHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function addHistoryEntry(
  entry: Omit<TxHistoryEntry, "id" | "timestamp">
): TxHistoryEntry {
  const full: TxHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  const history = loadHistory();
  history.unshift(full);
  // Keep last 200 entries
  if (history.length > 200) history.splice(200);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return full;
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

const TYPE_LABELS: Record<TxHistoryType, string> = {
  shield: "🔒 Shield",
  transfer: "🔄 Transfer",
  unshield: "🔓 Unshield",
  bridge: "🌉 Bridge",
  withdraw: "↩ Withdraw",
};

export function typeLabel(type: TxHistoryType): string {
  return TYPE_LABELS[type];
}

/** Format raw nano-token amount */
export function fmtAmount(raw: string): string {
  const n = Number(raw) / 1e9;
  return (n % 1 === 0 ? n.toString() : n.toFixed(4)) + " tokens";
}

/** Format USDC micro-amount (6 decimals) */
export function fmtUsdc(raw: string): string {
  const n = Number(raw) / 1e6;
  return (n % 1 === 0 ? n.toString() : n.toFixed(2)) + " USDC";
}
