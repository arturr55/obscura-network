"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useWalletClient, useWriteContract, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { waitForTransactionReceipt } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { CONTRACTS, BILLING_ABI, ERC20_ABI, BRIDGE_ABI } from "@/lib/contracts";
import { saveNote, markNoteSpent, loadNotes } from "@/lib/notes";
import { addHistoryEntry } from "@/lib/history";

const NODE_PROXY = "/api/node";
const DEFAULT_ASSET_ID = "0000000000000000000000000000000000000000000000000000000000000001";
// Mock proof magic header (OBSv in bytes)
const MOCK_PROOF_HEX = "4f425376" + "0".repeat(56); // OBSv + padding

const ORACLE_PROXY = "/api/sanctions";

type TxType = "shield" | "transfer" | "unshield" | "bridge" | "withdraw";

type SanctionsStatus = "idle" | "checking" | "clean" | "sanctioned" | "error";

interface SanctionsState {
  status: SanctionsStatus;
  msg?: string;
  // raw witness bytes to include in TX (null until fetched)
  sanctionsRoot: number[] | null;
  proofTimestamp: number;
}

interface SavedNote {
  commitment: string;
  nullifier: string;
  amount: string;
  asset_id: string;
}

function SanctionsBadge({ state }: { state: SanctionsState }) {
  if (state.status === "idle") return null;
  const cfg = {
    checking: { cls: "border-gray-600 bg-gray-900/30 text-gray-400", icon: "⏳", text: "Checking OFAC sanctions list..." },
    clean:     { cls: "border-green-700/50 bg-green-900/20 text-green-300", icon: "✓", text: "Recipient is not on OFAC sanctions list" },
    sanctioned:{ cls: "border-red-700/50 bg-red-900/30 text-red-300", icon: "⛔", text: "BLOCKED: Recipient is on OFAC SDN sanctions list" },
    error:     { cls: "border-yellow-700/40 bg-yellow-900/20 text-yellow-300", icon: "⚠", text: state.msg ?? "Sanctions check unavailable" },
  }[state.status];
  return (
    <div className={`border rounded-lg px-3 py-2 text-xs flex items-center gap-2 mb-3 ${cfg.cls}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.text}</span>
    </div>
  );
}

function StatusMsg({ type, msg }: { type: "success" | "error" | "info"; msg: string }) {
  const colors = {
    success: "bg-green-900/30 border-green-700/50 text-green-300",
    error: "bg-red-900/30 border-red-700/50 text-red-300",
    info: "bg-blue-900/30 border-blue-700/50 text-blue-300",
  };
  return <div className={`border rounded-lg px-4 py-3 text-sm mt-4 ${colors[type]}`}>{msg}</div>;
}

// Must match Rust: AssetId(*b"bridged-usdc-obscura-network-v01")
const BRIDGED_USDC_ASSET_ID = "627269646765642d757364632d6f6273637572612d6e6574776f726b2d763031";

/** Reconstruct bridge shield Note deterministically (mirrors relayer bridgeShieldSalt) */
async function reconstructBridgeNote(
  depositId: number,
  obscuraRecipient: string, // 0x address
  amountUsdc: bigint         // raw USDC micro-units (6 dec)
): Promise<{ commitment: string; nullifier: string; amount: string; asset_id: string }> {
  const enc = new TextEncoder();
  const prefix = enc.encode("obscura_bridge_shield_v1");
  const idBuf = new Uint8Array(8);
  new DataView(idBuf.buffer).setBigUint64(0, BigInt(depositId), true); // LE
  const recipientHex = obscuraRecipient.replace("0x", "").padStart(64, "0");
  const recipientBuf = Uint8Array.from(
    recipientHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  const combined = new Uint8Array(prefix.length + 8 + 32);
  combined.set(prefix);
  combined.set(idBuf, prefix.length);
  combined.set(recipientBuf, prefix.length + 8);

  // keccak256 via viem
  const { keccak256 } = await import("viem");
  const salt = keccak256(combined);

  // Deterministic commitment = keccak256(amount || asset_id || owner || salt)
  const commitment = keccak256(
    Uint8Array.from([
      ...new Uint8Array(new BigUint64Array([amountUsdc]).buffer),
      ...Uint8Array.from(BRIDGED_USDC_ASSET_ID.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
      ...recipientBuf,
      ...Uint8Array.from(salt.replace("0x", "").match(/.{2}/g)!.map((b) => parseInt(b, 16))),
    ])
  );
  const nullifier = keccak256(
    Uint8Array.from([
      ...Uint8Array.from(commitment.replace("0x", "").match(/.{2}/g)!.map((b) => parseInt(b, 16))),
      ...recipientBuf,
    ])
  );

  return {
    commitment,
    nullifier,
    amount: amountUsdc.toString(),
    asset_id: BRIDGED_USDC_ASSET_ID,
  };
}

function randomHex(n: number) {
  return Array.from({ length: n }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/^0x/, "");
  const result = [];
  for (let i = 0; i < clean.length; i += 2) {
    result.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return result;
}

function NotesBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(loadNotes().filter((n) => !n.spent).length);
  }, []);
  return (
    <Link
      href="/notes"
      className="flex items-center gap-1.5 border border-obscura-border text-gray-400 hover:text-white hover:border-purple-600 text-sm px-3 py-1.5 rounded-lg transition-colors"
    >
      My Notes
      {count > 0 && (
        <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">
          {count}
        </span>
      )}
    </Link>
  );
}

// address → bytes32: left-pad with zeros (0x + 24 zeros + 40-char address)
function addressToBytes32(addr: string): `0x${string}` {
  return `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

export default function SendPage() {
  const { address, isConnected } = useAccount();
  const {} = useWalletClient();
  const { writeContractAsync } = useWriteContract();

  const [txType, setTxType] = useState<TxType>("shield");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [inputNote, setInputNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [sanctions, setSanctions] = useState<SanctionsState>({
    status: "idle", sanctionsRoot: null, proofTimestamp: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bridgeRecipient, setBridgeRecipient] = useState("");
  const [withdrawDepositId, setWithdrawDepositId] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [claimDepositId, setClaimDepositId] = useState("");
  const [claimAmountUsdc, setClaimAmountUsdc] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);

  // Auto-check recipient address against OFAC oracle (debounced 600ms)
  useEffect(() => {
    if (txType !== "transfer") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const addr = recipient.trim();
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) {
      setSanctions({ status: "idle", sanctionsRoot: null, proofTimestamp: 0 });
      return;
    }

    setSanctions({ status: "checking", sanctionsRoot: null, proofTimestamp: 0 });
    debounceRef.current = setTimeout(async () => {
      try {
        // First: quick check
        const checkRes = await fetch(`${ORACLE_PROXY}?action=check&addr=${addr}`);
        const checkData = await checkRes.json();
        if (checkData.sanctioned) {
          setSanctions({ status: "sanctioned", sanctionsRoot: null, proofTimestamp: 0 });
          return;
        }
        // Then: fetch witness (for TX payload)
        const witRes = await fetch(`${ORACLE_PROXY}?action=witness&addr=${addr}`);
        const witData = await witRes.json();
        if (witData.error) {
          setSanctions({ status: "error", msg: witData.error, sanctionsRoot: null, proofTimestamp: 0 });
          return;
        }
        setSanctions({
          status: "clean",
          sanctionsRoot: witData.sanctions_root ?? null,
          proofTimestamp: Math.floor(Date.now() / 1000),
        });
      } catch {
        setSanctions({ status: "error", msg: "Oracle unreachable — proceeding without check", sanctionsRoot: null, proofTimestamp: 0 });
      }
    }, 600);
  }, [recipient, txType]);

  // Auto-fill recipients from connected wallet
  useEffect(() => {
    if (address) {
      if (!bridgeRecipient) setBridgeRecipient(address);
      if (!withdrawRecipient) setWithdrawRecipient(address);
    }
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill note from Notes page ("Use in Transfer/Unshield" button)
  useEffect(() => {
    const note = sessionStorage.getItem("obscura_selected_note");
    const tab = sessionStorage.getItem("obscura_selected_tab") as TxType | null;
    if (note && tab) {
      setInputNote(note);
      setTxType(tab);
      sessionStorage.removeItem("obscura_selected_note");
      sessionStorage.removeItem("obscura_selected_tab");
    }
  }, []);

  const { data: canSubmit } = useReadContract({
    address: CONTRACTS.billing,
    abi: BILLING_ABI,
    functionName: "canSubmitTx",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: remaining } = useReadContract({
    address: CONTRACTS.billing,
    abi: BILLING_ABI,
    functionName: "remainingTx",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const isUnlimited = remaining === MAX_UINT256;

  async function handleShield() {
    if (!amount || Number(amount) <= 0) {
      setStatus({ type: "error", msg: "Enter a valid amount" });
      return;
    }
    setLoading(true);
    setStatus({ type: "info", msg: "Building Shield transaction..." });
    try {
      const amountRaw = Math.floor(Number(amount) * 1e9);
      const callMsg = {
        obscura_privacy: {
          shield: {
            note: {
              amount: amountRaw.toString(),
              asset_id: DEFAULT_ASSET_ID,
              owner_pubkey: address
                ? Array.from(Buffer.from(address.slice(2).padStart(40, "0"), "hex"))
                : Array(20).fill(0),
              salt: Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
            },
          },
        },
      };

      setStatus({ type: "info", msg: "Submitting to Obscura node..." });
      const res = await fetch(NODE_PROXY + "?path=/sequencer/eip712_tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: callMsg }),
      });

      const note: SavedNote = {
        commitment: "0x" + randomHex(32),
        nullifier: "0x" + randomHex(32),
        amount: amountRaw.toString(),
        asset_id: DEFAULT_ASSET_ID,
      };
      setSavedNote(JSON.stringify(note, null, 2));
      saveNote({ type: "shield", ...note });
      addHistoryEntry({ type: "shield", status: "success", amount: amountRaw.toString() });
      setStatus({
        type: "success",
        msg: res.status < 500
          ? `✓ Shield TX submitted! Note saved to your Note manager.`
          : `✓ Note generated (node responded ${res.status}). Saved to Note manager.`,
      });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleTransfer() {
    if (!recipient || !amount) {
      setStatus({ type: "error", msg: "Enter recipient and amount" });
      return;
    }
    if (!inputNote) {
      setStatus({ type: "error", msg: "Paste your input Note (from previous Shield)" });
      return;
    }

    let parsedNote: SavedNote;
    try {
      parsedNote = JSON.parse(inputNote) as SavedNote;
      if (!parsedNote.nullifier || !parsedNote.commitment) throw new Error("missing fields");
    } catch {
      setStatus({ type: "error", msg: "Invalid Note format — paste JSON from your Shield TX" });
      return;
    }

    // Block if address is sanctioned
    if (sanctions.status === "sanctioned") {
      setStatus({ type: "error", msg: "⛔ Cannot transfer: recipient is on the OFAC SDN sanctions list." });
      return;
    }

    setLoading(true);
    setStatus({ type: "info", msg: "Building ZK proof (mock)..." });

    try {
      await new Promise(r => setTimeout(r, 800));

      const amountRaw = Math.floor(Number(amount) * 1e9);
      const outputCommitment = "0x" + randomHex(32);
      const mockRoot = Array(32).fill(0);

      // Sanctions public inputs — use oracle root if available, else zeros
      const sanctionsRoot = sanctions.sanctionsRoot ?? Array(32).fill(0);
      const recipientCommitment = Array(32).fill(0); // mock: circuit computes this
      const proofTimestamp = sanctions.proofTimestamp || Math.floor(Date.now() / 1000);

      const callMsg = {
        obscura_privacy: {
          transfer: {
            proof: hexToBytes(MOCK_PROOF_HEX),
            public_inputs: {
              transfer_amount: amountRaw.toString(),
              asset_id: DEFAULT_ASSET_ID,
              merkle_root: "0x" + mockRoot.map(b => b.toString(16).padStart(2, "0")).join(""),
            },
            nullifiers: [parsedNote.nullifier],
            output_commitments: [outputCommitment],
            // ZK sanctions non-membership proof (mock for testnet)
            sanctions_proof: hexToBytes(MOCK_PROOF_HEX),
            sanctions_public_inputs: {
              recipient_commitment: recipientCommitment,
              sanctions_root: sanctionsRoot,
              proof_timestamp: proofTimestamp,
            },
          },
        },
      };

      setStatus({ type: "info", msg: "Submitting private transfer to Obscura node..." });
      const res = await fetch(NODE_PROXY + "?path=/sequencer/eip712_tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: callMsg }),
      });

      // Output note for recipient
      const outputNote: SavedNote = {
        commitment: outputCommitment,
        nullifier: "0x" + randomHex(32),
        amount: amountRaw.toString(),
        asset_id: DEFAULT_ASSET_ID,
      };

      setSavedNote(JSON.stringify({
        message: "Send this Note to recipient so they can spend funds",
        recipient,
        note: outputNote,
      }, null, 2));

      // Save output note + mark input note spent
      saveNote({ type: "transfer_out", ...outputNote });
      addHistoryEntry({ type: "transfer", status: "success", amount: amountRaw.toString(), recipient });

      // Generate shareable receive link (fragment = base64url encoded note)
      const notePayload = JSON.stringify({
        commitment: outputNote.commitment,
        nullifier:  outputNote.nullifier,
        amount:     outputNote.amount,
        asset_id:   outputNote.asset_id,
        from:       address ?? "",
      });
      const b64 = btoa(notePayload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      setShareLink(`${window.location.origin}/receive#${b64}`);
      const allNotes = loadNotes();
      const inputNoteObj = allNotes.find(
        (n) => !n.spent && n.nullifier === parsedNote.nullifier
      );
      if (inputNoteObj) markNoteSpent(inputNoteObj.id);

      setStatus({
        type: "success",
        msg: res.status < 500
          ? `✓ Private transfer submitted! Output note saved to Note manager.`
          : `✓ Transfer built (node responded ${res.status}).`,
      });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleUnshield() {
    if (!inputNote) {
      setStatus({ type: "error", msg: "Paste your Note (from Shield or Transfer)" });
      return;
    }

    let parsedNote: SavedNote;
    try {
      // Support both raw Note and wrapped Output Note from Transfer
      const parsed = JSON.parse(inputNote);
      parsedNote = (parsed.note ?? parsed) as SavedNote;
      if (!parsedNote.nullifier || !parsedNote.commitment) throw new Error("missing fields");
    } catch {
      setStatus({ type: "error", msg: "Invalid Note format — paste JSON from your Shield or Transfer TX" });
      return;
    }

    setLoading(true);
    setStatus({ type: "info", msg: "Building Unshield transaction..." });

    try {
      await new Promise(r => setTimeout(r, 600));

      const mockRoot = Array(32).fill(0);

      const callMsg = {
        obscura_privacy: {
          unshield: {
            proof: hexToBytes(MOCK_PROOF_HEX),
            public_inputs: {
              amount: parsedNote.amount,
              asset_id: parsedNote.asset_id ?? DEFAULT_ASSET_ID,
              merkle_root: "0x" + mockRoot.map(b => b.toString(16).padStart(2, "0")).join(""),
              recipient: address,
            },
            nullifier: parsedNote.nullifier,
            input_commitment: parsedNote.commitment,
          },
        },
      };

      setStatus({ type: "info", msg: "Submitting Unshield to Obscura node..." });
      const res = await fetch(NODE_PROXY + "?path=/sequencer/eip712_tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: callMsg }),
      });

      addHistoryEntry({ type: "unshield", status: "success", amount: parsedNote.amount });
      // Mark note as spent
      const allNotes = loadNotes();
      const spentNote = allNotes.find(
        (n) => !n.spent && n.nullifier === parsedNote.nullifier
      );
      if (spentNote) markNoteSpent(spentNote.id);

      const amountDisplay = (Number(parsedNote.amount) / 1e9).toFixed(4);
      setStatus({
        type: "success",
        msg: res.status < 500
          ? `✓ Unshield submitted! ${amountDisplay} tokens will appear in your wallet after confirmation.`
          : `✓ Unshield built (node responded ${res.status}).`,
      });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimBridgeNote() {
    const depositId = parseInt(claimDepositId);
    const amountUsdc = parseFloat(claimAmountUsdc);
    if (isNaN(depositId) || isNaN(amountUsdc) || amountUsdc <= 0) {
      setStatus({ type: "error", msg: "Enter a valid Deposit ID and USDC amount" });
      return;
    }
    if (!address) {
      setStatus({ type: "error", msg: "Connect wallet first" });
      return;
    }
    setClaimLoading(true);
    try {
      const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));
      const note = await reconstructBridgeNote(depositId, address, amountRaw);
      saveNote({ type: "shield", ...note, label: `Bridge deposit #${depositId}` });
      addHistoryEntry({
        type: "bridge", status: "success",
        amountUsdc: amountRaw.toString(),
        depositId,
        note: "Shield note claimed",
      });
      setStatus({ type: "success", msg: `✓ Note saved! ${amountUsdc} bridged USDC ready to use in Transfer or Unshield.` });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleWithdraw() {
    const depositId = parseInt(withdrawDepositId);
    if (isNaN(depositId) || depositId < 0) {
      setStatus({ type: "error", msg: "Enter a valid deposit ID (number from the original Bridge TX)" });
      return;
    }
    if (!withdrawRecipient.match(/^0x[0-9a-fA-F]{40}$/)) {
      setStatus({ type: "error", msg: "Enter a valid Ethereum recipient address" });
      return;
    }

    setLoading(true);
    setStatus({ type: "info", msg: "Submitting withdrawal to relayer..." });
    try {
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit_id: depositId, eth_recipient: withdrawRecipient }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Relayer error");
      addHistoryEntry({
        type: "withdraw", status: "success",
        depositId,
        ethTxHash: data.ethTxHash,
        recipient: withdrawRecipient,
      });

      setStatus({
        type: "success",
        msg: `✓ Withdrawal submitted! ETH TX: ${String(data.ethTxHash).slice(0, 18)}... — USDC will arrive in your wallet after confirmation.`,
      });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleBridge() {
    if (!amount || Number(amount) <= 0) {
      setStatus({ type: "error", msg: "Enter a valid USDC amount" });
      return;
    }
    if (!address) {
      setStatus({ type: "error", msg: "Connect your wallet first" });
      return;
    }

    const amountUsdc = BigInt(Math.floor(Number(amount) * 1_000_000));

    setLoading(true);
    try {
      // ── Step 0: Read next deposit ID to pre-compute commitment ─────────
      setStatus({ type: "info", msg: "Step 0/3 — Reading deposit ID..." });
      const { readContract } = await import("wagmi/actions");
      const nextId = await readContract(wagmiConfig, {
        address: CONTRACTS.bridge,
        abi: BRIDGE_ABI,
        functionName: "nextDepositId",
      }) as bigint;
      const depositId = Number(nextId);

      // Pre-compute Note + commitment that the rollup will auto-shield
      const noteData = await reconstructBridgeNote(depositId, address, amountUsdc);
      // commitment is 0x-prefixed 32-byte hex → strip prefix for bytes32
      const commitmentBytes = noteData.commitment.replace(/^0x/, "");
      const commitmentBytes32 = `0x${commitmentBytes.padStart(64, "0")}` as `0x${string}`;

      // ── Step 1: Approve USDC spend ─────────────────────────────────────
      setStatus({ type: "info", msg: "Step 1/3 — Approving USDC spend..." });
      const approveTx = await writeContractAsync({
        address: CONTRACTS.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.bridge, amountUsdc],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });

      // ── Step 2: Lock USDC — commitment is the obscura_recipient ────────
      setStatus({ type: "info", msg: "Step 2/3 — Locking USDC in bridge (commitment as recipient)..." });
      const depositTx = await writeContractAsync({
        address: CONTRACTS.bridge,
        abi: BRIDGE_ABI,
        functionName: "deposit",
        args: [amountUsdc, commitmentBytes32],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: depositTx });

      // ── Step 3: Auto-save Note ─────────────────────────────────────────
      saveNote({
        type: "shield",
        commitment: noteData.commitment,
        nullifier: noteData.nullifier,
        amount: noteData.amount,
        asset_id: noteData.asset_id,
        label: `Bridge deposit #${depositId} (${amount} USDC)`,
      });
      addHistoryEntry({
        type: "bridge", status: "success",
        amount: String(amountUsdc),
        ethTxHash: depositTx,
        note: `Deposit #${depositId} — commitment pre-shielded`,
      });

      setStatus({
        type: "success",
        msg: `✓ Bridged ${amount} USDC as deposit #${depositId}! Note saved. Relayer will add it to the shielded pool in ~1 min — then use it in Transfer/Unshield.`,
      });
    } catch (e: unknown) {
      setStatus({ type: "error", msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h1 className="text-3xl font-bold text-white mb-4">Send Private TX</h1>
        <p className="text-gray-400 mb-8">Connect your wallet to send private transactions.</p>
        <ConnectButton />
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-500 hover:text-white transition-colors text-sm">← Dashboard</Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-xl font-bold text-white">Send Private Transaction</h1>
        </div>
        <div className="flex items-center gap-2">
          <NotesBadge />
          <Link
            href="/history"
            className="border border-obscura-border text-gray-400 hover:text-white hover:border-purple-600 text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            History
          </Link>
        </div>
      </div>

      {/* Subscription status */}
      <div className={`border rounded-xl p-4 mb-6 flex items-center justify-between ${
        canSubmit ? "border-green-700/40 bg-green-900/20" : "border-red-700/40 bg-red-900/20"
      }`}>
        <div>
          <div className={`text-sm font-medium ${canSubmit ? "text-green-300" : "text-red-300"}`}>
            {canSubmit ? "✓ Active subscription" : "✗ No active subscription"}
          </div>
          <div className="text-gray-400 text-xs mt-0.5">
            {canSubmit
              ? `${isUnlimited ? "Unlimited" : remaining?.toString()} TX remaining`
              : "Subscribe on Dashboard to send transactions"}
          </div>
        </div>
        {!canSubmit && (
          <Link href="/dashboard" className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
            Subscribe
          </Link>
        )}
      </div>

      {/* TX Type */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["shield", "transfer", "unshield", "bridge", "withdraw"] as TxType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTxType(t); setStatus(null); setSavedNote(null); setShareLink(null); setSanctions({ status: "idle", sanctionsRoot: null, proofTimestamp: 0 }); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              txType === t
                ? t === "withdraw" ? "bg-orange-600 text-white" : "bg-purple-600 text-white"
                : "border border-obscura-border text-gray-400 hover:text-white hover:border-purple-600"
            }`}
          >
            {t === "shield" ? "🔒 Shield" : t === "transfer" ? "🔄 Transfer" : t === "unshield" ? "🔓 Unshield" : t === "bridge" ? "🌉 Bridge USDC" : "↩ Withdraw to ETH"}
          </button>
        ))}
      </div>

      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">
        {txType === "shield" ? (
          <>
            <h2 className="text-white font-semibold mb-1">Shield Tokens</h2>
            <p className="text-gray-400 text-sm mb-4">
              Move tokens into the private shielded pool. You&apos;ll receive a secret Note — save it to spend later.
            </p>
            <label className="block text-gray-400 text-xs mb-1.5">Amount (tokens)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-4 focus:outline-none focus:border-purple-600"
            />
            <button
              onClick={handleShield}
              disabled={loading || !canSubmit}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? "Processing..." : "Shield Tokens"}
            </button>
          </>
        ) : txType === "transfer" ? (
          <>
            <h2 className="text-white font-semibold mb-1">Private Transfer</h2>
            <p className="text-gray-400 text-sm mb-4">
              Transfer shielded tokens privately. No public record of amount or recipient. Paste your Note from a previous Shield.
            </p>

            <label className="block text-gray-400 text-xs mb-1.5">Your Input Note (JSON from Shield TX)</label>
            <textarea
              value={inputNote}
              onChange={(e) => setInputNote(e.target.value)}
              placeholder={'{\n  "commitment": "0x...",\n  "nullifier": "0x...",\n  "amount": "...",\n  "asset_id": "..."\n}'}
              rows={5}
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-xs mb-3 focus:outline-none focus:border-purple-600 font-mono"
            />

            <label className="block text-gray-400 text-xs mb-1.5">Recipient address</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-2 focus:outline-none focus:border-purple-600"
            />
            <SanctionsBadge state={sanctions} />

            <label className="block text-gray-400 text-xs mb-1.5">Amount to transfer</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50"
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-4 focus:outline-none focus:border-purple-600"
            />

            <button
              onClick={handleTransfer}
              disabled={loading || !canSubmit}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? "Processing..." : "Send Private TX"}
            </button>
          </>
        ) : txType === "unshield" ? (
          <>
            <h2 className="text-white font-semibold mb-1">Unshield Tokens</h2>
            <p className="text-gray-400 text-sm mb-4">
              Withdraw tokens from the private pool back to your wallet. Paste the Note you received from a Shield or Transfer transaction.
            </p>

            <label className="block text-gray-400 text-xs mb-1.5">Your Note (JSON from Shield or Transfer TX)</label>
            <textarea
              value={inputNote}
              onChange={(e) => setInputNote(e.target.value)}
              placeholder={'{\n  "commitment": "0x...",\n  "nullifier": "0x...",\n  "amount": "...",\n  "asset_id": "..."\n}'}
              rows={6}
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-xs mb-4 focus:outline-none focus:border-purple-600 font-mono"
            />

            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-3 py-2 text-blue-300 text-xs mb-4">
              Tokens will be sent to your connected wallet: <span className="font-mono text-white">{address?.slice(0, 10)}...{address?.slice(-6)}</span>
            </div>

            <button
              onClick={handleUnshield}
              disabled={loading || !canSubmit}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? "Processing..." : "Unshield Tokens"}
            </button>
          </>
        ) : txType === "bridge" ? (
          <>
            <h2 className="text-white font-semibold mb-1">Bridge USDC → Obscura (Auto-Shield)</h2>
            <p className="text-gray-400 text-sm mb-4">
              Lock USDC on Ethereum Sepolia. A ZK Note is pre-computed from your wallet address and automatically added to the shielded pool by the relayer — no separate Shield step needed.
            </p>

            <div className="bg-green-900/20 border border-green-700/30 rounded-lg px-3 py-2 text-green-300 text-xs mb-4 flex items-start gap-2">
              <span className="mt-0.5">✓</span>
              <div>
                <strong>Privacy by default:</strong> your Note commitment is computed client-side and passed directly to the bridge contract. The rollup auto-shields on claim — your funds go straight into the shielded pool.
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-3 py-2 text-blue-300 text-xs mb-4 flex items-start gap-2">
              <span className="mt-0.5">ℹ</span>
              <div>
                USDC on Sepolia: <span className="font-mono text-white">{CONTRACTS.usdc.slice(0, 10)}...</span><br/>
                Bridge contract: <span className="font-mono text-white">{CONTRACTS.bridge.slice(0, 10)}...</span>
              </div>
            </div>

            <label className="block text-gray-400 text-xs mb-1.5">USDC amount (e.g. 10 = 10 USDC)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 10"
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-4 focus:outline-none focus:border-purple-600"
            />

            <button
              onClick={handleBridge}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? "Processing..." : "Approve & Bridge →"}
            </button>

            <p className="text-gray-600 text-xs mt-3 text-center">
              Your shielded Note is saved automatically. Find it in{" "}
              <Link href="/notes" className="text-purple-400 hover:text-purple-300">My Notes</Link>{" "}
              after the relayer confirms (~1 min).
            </p>

            {/* Fallback: Claim Note for older deposits */}
            <div className="mt-6 pt-5 border-t border-obscura-border">
              <h3 className="text-gray-500 font-medium text-sm mb-1">Recover Note for older deposit</h3>
              <p className="text-gray-600 text-xs mb-3">
                If you bridged before the auto-shield upgrade, enter the deposit ID and amount to reconstruct your Note.
              </p>
              <div className="flex gap-2 mb-2">
                <div className="flex-1">
                  <label className="block text-gray-500 text-xs mb-1">Deposit ID</label>
                  <input
                    type="number" min="0"
                    value={claimDepositId}
                    onChange={(e) => setClaimDepositId(e.target.value)}
                    placeholder="e.g. 1"
                    className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-purple-600"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 text-xs mb-1">Amount (USDC)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={claimAmountUsdc}
                    onChange={(e) => setClaimAmountUsdc(e.target.value)}
                    placeholder="e.g. 10"
                    className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-purple-600"
                  />
                </div>
              </div>
              <button
                onClick={handleClaimBridgeNote}
                disabled={claimLoading}
                className="w-full border border-obscura-border text-gray-500 hover:border-purple-600 hover:text-purple-300 disabled:opacity-50 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                {claimLoading ? "Reconstructing..." : "Recover Note →"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-white font-semibold mb-1">Withdraw USDC → Ethereum</h2>
            <p className="text-gray-400 text-sm mb-4">
              Unlock your original USDC deposit back to an Ethereum address. The relayer will call the bridge contract and release your USDC.
            </p>

            <div className="bg-orange-900/20 border border-orange-700/30 rounded-lg px-3 py-2 text-orange-300 text-xs mb-4 flex items-start gap-2">
              <span className="mt-0.5">ℹ</span>
              <div>
                You need the <strong>Deposit ID</strong> from your original Bridge TX.
                Each deposit can only be withdrawn once.
              </div>
            </div>

            <label className="block text-gray-400 text-xs mb-1.5">Deposit ID (from Bridge TX)</label>
            <input
              type="number"
              min="0"
              value={withdrawDepositId}
              onChange={(e) => setWithdrawDepositId(e.target.value)}
              placeholder="e.g. 1"
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-4 focus:outline-none focus:border-orange-500"
            />

            <label className="block text-gray-400 text-xs mb-1.5">Ethereum recipient address</label>
            <input
              type="text"
              value={withdrawRecipient}
              onChange={(e) => setWithdrawRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-4 focus:outline-none focus:border-orange-500"
            />

            <button
              onClick={handleWithdraw}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? "Processing..." : "Withdraw to Ethereum"}
            </button>
          </>
        )}

        {shareLink && (
          <div className="mt-4 border border-green-700/40 bg-green-900/20 rounded-xl p-4">
            <div className="text-green-300 text-sm font-semibold mb-2">
              🔗 Share this link with the recipient
            </div>
            <p className="text-gray-400 text-xs mb-3">
              The note is encoded in the URL fragment — it never leaves the browser and is not stored on any server.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareLink}
                className="flex-1 bg-obscura-dark border border-obscura-border rounded-lg px-3 py-2 text-xs text-gray-300 font-mono min-w-0"
              />
              <button
                onClick={() => navigator.clipboard.writeText(shareLink)}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                Copy link
              </button>
            </div>
          </div>
        )}

        {status && <StatusMsg type={status.type} msg={status.msg} />}

        {savedNote && (
          <div className="mt-4">
            <div className="text-yellow-400 text-sm font-semibold mb-2">
              {txType === "shield" ? "⚠️ Save your Note — needed to spend funds!" : "📤 Output Note — send this to recipient!"}
            </div>
            <pre className="bg-obscura-dark border border-yellow-700/40 rounded-lg p-3 text-xs text-gray-300 overflow-auto max-h-48">
              {savedNote}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(savedNote)}
              className="mt-2 text-xs text-purple-400 hover:text-purple-300"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-3">
          <div className="text-gray-400 text-xs mb-1">Node RPC</div>
          <div className="text-white text-xs font-mono">49.13.23.128:12346</div>
        </div>
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-3">
          <div className="text-gray-400 text-xs mb-1">Network</div>
          <div className="text-white text-xs">Obscura Testnet</div>
        </div>
      </div>
    </main>
  );
}
