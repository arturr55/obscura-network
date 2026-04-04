"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { CONTRACTS, BILLING_ABI } from "@/lib/contracts";

const NODE_PROXY = "/api/node";
const DEFAULT_ASSET_ID = "0000000000000000000000000000000000000000000000000000000000000001";
// Mock proof magic header (OBSv in bytes)
const MOCK_PROOF_HEX = "4f425376" + "0".repeat(56); // OBSv + padding

type TxType = "shield" | "transfer" | "unshield";

interface SavedNote {
  commitment: string;
  nullifier: string;
  amount: string;
  asset_id: string;
}

function StatusMsg({ type, msg }: { type: "success" | "error" | "info"; msg: string }) {
  const colors = {
    success: "bg-green-900/30 border-green-700/50 text-green-300",
    error: "bg-red-900/30 border-red-700/50 text-red-300",
    info: "bg-blue-900/30 border-blue-700/50 text-blue-300",
  };
  return <div className={`border rounded-lg px-4 py-3 text-sm mt-4 ${colors[type]}`}>{msg}</div>;
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

export default function SendPage() {
  const { address, isConnected } = useAccount();
  const {} = useWalletClient();

  const [txType, setTxType] = useState<TxType>("shield");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [inputNote, setInputNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

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
      setStatus({
        type: "success",
        msg: res.status < 500
          ? `✓ Shield TX submitted! Save your Note to spend later.`
          : `✓ Note generated (node responded ${res.status}).`,
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

    setLoading(true);
    setStatus({ type: "info", msg: "Building ZK proof (mock)..." });

    try {
      await new Promise(r => setTimeout(r, 800));

      const amountRaw = Math.floor(Number(amount) * 1e9);
      const outputCommitment = "0x" + randomHex(32);
      const mockRoot = Array(32).fill(0);

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

      setStatus({
        type: "success",
        msg: res.status < 500
          ? `✓ Private transfer submitted! Send the output Note to ${recipient.slice(0, 10)}...`
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
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition-colors text-sm">← Dashboard</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white">Send Private Transaction</h1>
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
      <div className="flex gap-2 mb-6">
        {(["shield", "transfer", "unshield"] as TxType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTxType(t); setStatus(null); setSavedNote(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              txType === t
                ? "bg-purple-600 text-white"
                : "border border-obscura-border text-gray-400 hover:text-white hover:border-purple-600"
            }`}
          >
            {t === "shield" ? "🔒 Shield" : t === "transfer" ? "🔄 Transfer" : "🔓 Unshield"}
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
        ) : (
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
              className="w-full bg-obscura-dark border border-obscura-border rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm mb-3 focus:outline-none focus:border-purple-600"
            />

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
        ) : null}

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
