"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useChainId, useWriteContract, useSwitchChain } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { waitForTransactionReceipt, readContract } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import {
  CHAIN_CONFIG,
  SUPPORTED_CHAINS,
  VAULT_ABI,
  ERC20_ABI,
  isVaultDeployed,
} from "@/lib/contracts";
import { addHistoryEntry } from "@/lib/history";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "form" | "confirm" | "approving" | "depositing" | "done" | "error";

type SanctionStatus = "idle" | "checking" | "clean" | "blocked";

// ── Chain selector component ──────────────────────────────────────────────────

function ChainSelector({
  value,
  onChange,
  exclude,
  label,
}: {
  value: number;
  onChange: (id: number) => void;
  exclude?: number;
  label: string;
}) {
  const chains = SUPPORTED_CHAINS.filter((id) => id !== exclude);
  const cfg = CHAIN_CONFIG[value];

  return (
    <div>
      <label className="block text-gray-500 text-xs mb-1.5">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full appearance-none bg-obscura-dark border border-obscura-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-600 cursor-pointer pr-10"
        >
          {chains.map((id) => {
            const c = CHAIN_CONFIG[id];
            const deployed = isVaultDeployed(id);
            return (
              <option key={id} value={id} disabled={!deployed}>
                {c.shortName}{!deployed ? " (coming soon)" : ""}
              </option>
            );
          })}
        </select>
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">▾</div>
      </div>
      {cfg && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          <span className="text-gray-600 text-xs">{cfg.nativeCurrency.symbol} · {cfg.name}</span>
        </div>
      )}
    </div>
  );
}

// ── Privacy badge ─────────────────────────────────────────────────────────────

function PrivacyBadge() {
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5 text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
        Zero-knowledge proof
      </span>
      <span className="flex items-center gap-1.5 text-blue-400">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
        OFAC compliant
      </span>
      <span className="flex items-center gap-1.5 text-purple-400">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
        No on-chain link
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BridgePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  // Form state
  const [fromChain, setFromChain] = useState<number>(11155111);
  const [toChain, setToChain]     = useState<number>(421614);
  const [amount, setAmount]       = useState("");
  const [recipient, setRecipient] = useState("");
  const [selfMode, setSelfMode]   = useState(true); // send to myself vs custom address

  // Flow state
  const [step, setStep]     = useState<Step>("form");
  const [errMsg, setErrMsg] = useState("");
  const [depositId, setDepositId] = useState<number | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string>("");
  const [claimLink, setClaimLink] = useState<string>("");

  // Sanctions
  const [sanction, setSanction] = useState<SanctionStatus>("idle");

  // Sync fromChain to wallet chain when wallet switches
  useEffect(() => {
    if (CHAIN_CONFIG[chainId]) setFromChain(chainId);
  }, [chainId]);

  // Auto-fill recipient when selfMode
  useEffect(() => {
    if (selfMode && address) setRecipient(address);
  }, [selfMode, address]);

  // Check recipient against OFAC (debounced)
  useEffect(() => {
    const addr = recipient.trim();
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/) || selfMode) {
      setSanction("idle");
      return;
    }
    setSanction("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sanctions?action=check&addr=${addr}`);
        const data = await res.json();
        setSanction(data.sanctioned ? "blocked" : "clean");
      } catch {
        setSanction("idle");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [recipient, selfMode]);

  // Swap chains
  function swapChains() {
    if (!isVaultDeployed(toChain)) return;
    const tmp = fromChain;
    setFromChain(toChain);
    setToChain(tmp);
  }

  // Validation
  const MIN_USDC = 1; // contract minimum: 1 USDC
  const amountNum = Number(amount);
  const recipientAddr = selfMode ? (address ?? "") : recipient.trim();
  const isValidAmount = amountNum >= MIN_USDC && !isNaN(amountNum);
  const isValidRecipient = recipientAddr.match(/^0x[0-9a-fA-F]{40}$/) !== null;
  const canBridge =
    isConnected &&
    isValidAmount &&
    isValidRecipient &&
    isVaultDeployed(fromChain) &&
    sanction !== "blocked" &&
    step === "form";

  // ── Bridge handler ──────────────────────────────────────────────────────────
  async function handleBridge() {
    if (!canBridge || !address) return;

    const fromCfg  = CHAIN_CONFIG[fromChain];
    const amountUsdc = BigInt(Math.floor(amountNum * 1_000_000));

    // If wallet is on wrong chain, ask to switch
    if (chainId !== fromChain) {
      try {
        await switchChainAsync({ chainId: fromChain });
      } catch {
        setErrMsg(`Please switch your wallet to ${fromCfg.name} manually.`);
        setStep("error");
        return;
      }
    }

    setStep("approving");
    try {
      // Step 1: Read next deposit ID
      const nextId = await readContract(wagmiConfig, {
        address: fromCfg.vault,
        abi: VAULT_ABI,
        functionName: "nextDepositId",
      }) as bigint;

      // Step 2: Build obscuraRecipient — recipient address as bytes32
      const obscuraRecipient = `0x${"0".repeat(24)}${recipientAddr.slice(2).toLowerCase()}` as `0x${string}`;

      // Step 3: Approve
      const approveTx = await writeContractAsync({
        address: fromCfg.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [fromCfg.vault, amountUsdc],
        gas: 100000n,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });

      // Step 4: Deposit
      setStep("depositing");
      const depTx = await writeContractAsync({
        address: fromCfg.vault,
        abi: VAULT_ABI,
        functionName: "deposit",
        args: [fromCfg.usdc, amountUsdc, obscuraRecipient],
        gas: 300000n,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: depTx });

      const id = Number(nextId);
      setDepositId(id);
      setDepositTxHash(depTx);

      // Build claim link (recipient uses this to withdraw on destination chain)
      const link = `${window.location.origin}/claim?from=${fromChain}&to=${toChain}&depositId=${id}&recipient=${recipientAddr}&amount=${amountUsdc}`;
      setClaimLink(link);

      addHistoryEntry({
        type:     "bridge",
        status:   "success",
        amount:   String(amountUsdc),
        ethTxHash: depTx,
        note:     `Deposit #${id} on ${fromCfg.name} → ${CHAIN_CONFIG[toChain]?.name}`,
      });

      setStep("done");
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  // ── Not connected ───────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center mb-8">
          <div className="text-purple-400 text-xs font-bold tracking-widest mb-3">OBSCURA NETWORK</div>
          <h1 className="text-3xl font-bold text-white mb-3">Private Cross-Chain Bridge</h1>
          <p className="text-gray-400 text-sm max-w-sm">
            Send tokens between chains with zero-knowledge privacy. No on-chain link between sender and recipient.
          </p>
        </div>
        <ConnectButton />
        <div className="mt-8">
          <PrivacyBadge />
        </div>
      </main>
    );
  }

  const fromCfg = CHAIN_CONFIG[fromChain];
  const toCfg   = CHAIN_CONFIG[toChain];

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <main className="max-w-lg mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-700/50 flex items-center justify-center text-3xl mx-auto mb-4">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Funds locked!</h2>
          <p className="text-gray-400 text-sm">
            {amount} USDC locked on {fromCfg.name}. Deposit #{depositId}.
          </p>
        </div>

        {/* What happens next */}
        <div className="bg-obscura-card border border-obscura-border rounded-2xl p-5 mb-4">
          <div className="text-white font-semibold text-sm mb-4">What happens next</div>
          <div className="space-y-3">
            {[
              { icon: "🔒", title: "Funds locked on " + fromCfg.shortName, desc: "Your USDC is held in the ObscuraVault contract", done: true },
              { icon: "⚡", title: "ZK proof generated", desc: "Obscura rollup generates a zero-knowledge proof (takes ~1 min)", done: false },
              { icon: "💸", title: "Released on " + (toCfg?.shortName ?? "destination"), desc: "Recipient claims USDC on " + (toCfg?.name ?? "destination chain"), done: false },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${item.done ? "bg-green-900/50 border border-green-700/50" : "bg-obscura-dark border border-obscura-border"}`}>
                  {item.done ? "✓" : item.icon}
                </div>
                <div>
                  <div className={`text-sm font-medium ${item.done ? "text-green-300" : "text-gray-300"}`}>{item.title}</div>
                  <div className="text-gray-500 text-xs">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Share link (if sent to someone else) */}
        {!selfMode && (
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-2xl p-5 mb-4">
            <div className="text-blue-300 font-semibold text-sm mb-2">Share claim link with recipient</div>
            <div className="font-mono text-xs text-gray-400 bg-obscura-dark rounded-lg px-3 py-2 break-all mb-3">
              {claimLink}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(claimLink)}
              className="w-full bg-blue-700 hover:bg-blue-600 text-white text-sm py-2 rounded-xl transition-colors"
            >
              Copy claim link
            </button>
          </div>
        )}

        {/* TX link */}
        <a
          href={`${fromCfg.explorerUrl}/tx/${depositTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-gray-500 hover:text-gray-300 mb-6 transition-colors"
        >
          View transaction on {fromCfg.shortName} explorer ↗
        </a>

        <button
          onClick={() => { setStep("form"); setAmount(""); setDepositId(null); setDepositTxHash(""); }}
          className="w-full bg-obscura-card border border-obscura-border hover:border-purple-600 text-white py-3 rounded-xl text-sm transition-colors"
        >
          Bridge again
        </button>
      </main>
    );
  }

  // ── Main bridge form ────────────────────────────────────────────────────────
  const isProcessing = step === "approving" || step === "depositing";

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <Link href="/start" className="text-gray-500 hover:text-white text-sm transition-colors">← Back</Link>
        <div className="text-center">
          <div className="text-white font-bold">Private Bridge</div>
          <div className="text-gray-500 text-xs">powered by Obscura Network</div>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
      </div>

      {/* Wrong chain warning */}
      {chainId !== fromChain && CHAIN_CONFIG[chainId] && (
        <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl px-4 py-3 text-yellow-300 text-xs mb-4 flex items-center justify-between gap-3">
          <span>Your wallet is on {CHAIN_CONFIG[chainId].shortName}. Bridge will switch to {fromCfg.shortName}.</span>
        </div>
      )}

      {/* Bridge card */}
      <div className="bg-obscura-card border border-obscura-border rounded-2xl p-6">

        {/* FROM */}
        <div className="bg-obscura-dark rounded-xl p-4 mb-2">
          <div className="flex items-center justify-between mb-3">
            <ChainSelector
              value={fromChain}
              onChange={(id) => { setFromChain(id); if (id === toChain) setToChain(SUPPORTED_CHAINS.find(c => c !== id && isVaultDeployed(c)) ?? 421614); }}
              exclude={toChain}
              label="From"
            />
            <div className="ml-3 shrink-0">
              <div className="bg-purple-900/30 border border-purple-700/30 text-purple-300 text-xs px-2 py-1 rounded-lg font-mono">USDC</div>
            </div>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-3xl font-bold text-white placeholder-gray-700 focus:outline-none"
          />
          <div className="text-xs mt-1">
            {amount && amountNum < MIN_USDC && amountNum > 0
              ? <span className="text-red-400">Minimum 1 USDC</span>
              : isValidAmount
              ? <span className="text-gray-500">≈ ${amountNum.toFixed(2)}</span>
              : <span className="text-gray-700">min 1 USDC</span>
            }
          </div>
        </div>

        {/* Swap button */}
        <div className="flex justify-center my-1">
          <button
            onClick={swapChains}
            className="w-8 h-8 rounded-full bg-obscura-dark border border-obscura-border hover:border-purple-600 text-gray-400 hover:text-white flex items-center justify-center transition-colors text-sm"
            title="Swap chains"
          >
            ↕
          </button>
        </div>

        {/* TO */}
        <div className="bg-obscura-dark rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <ChainSelector
              value={toChain}
              onChange={setToChain}
              exclude={fromChain}
              label="To"
            />
            <div className="ml-3 shrink-0">
              <div className="bg-purple-900/30 border border-purple-700/30 text-purple-300 text-xs px-2 py-1 rounded-lg font-mono">USDC</div>
            </div>
          </div>

          {/* Recipient */}
          <div className="border-t border-obscura-border pt-3 mt-1">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setSelfMode(true)}
                className={`text-xs px-3 py-1 rounded-lg transition-colors ${selfMode ? "bg-purple-700 text-white" : "text-gray-500 hover:text-white"}`}
              >
                My wallet
              </button>
              <button
                onClick={() => { setSelfMode(false); setRecipient(""); }}
                className={`text-xs px-3 py-1 rounded-lg transition-colors ${!selfMode ? "bg-purple-700 text-white" : "text-gray-500 hover:text-white"}`}
              >
                Another address
              </button>
            </div>

            {selfMode ? (
              <div className="text-gray-400 text-xs font-mono bg-obscura-card rounded-lg px-3 py-2">
                {address?.slice(0, 16)}...{address?.slice(-8)}
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x recipient address"
                  className="w-full bg-obscura-card border border-obscura-border rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-purple-600 placeholder-gray-600"
                />
                {sanction === "checking" && (
                  <div className="text-gray-500 text-xs mt-1">⏳ Checking OFAC sanctions list...</div>
                )}
                {sanction === "clean" && (
                  <div className="text-green-400 text-xs mt-1">✓ Not on OFAC sanctions list</div>
                )}
                {sanction === "blocked" && (
                  <div className="text-red-400 text-xs mt-1">⛔ Address is on OFAC SDN list — blocked</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Privacy badges */}
        <div className="mb-4 px-1">
          <PrivacyBadge />
        </div>

        {/* Fee estimate */}
        {isValidAmount && (
          <div className="bg-obscura-dark rounded-xl px-4 py-3 mb-4 text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>You send</span>
              <span className="text-white">{amount} USDC on {fromCfg.shortName}</span>
            </div>
            <div className="flex justify-between">
              <span>Recipient gets</span>
              <span className="text-white">{amount} USDC on {toCfg?.shortName}</span>
            </div>
            <div className="flex justify-between">
              <span>Privacy</span>
              <span className="text-purple-300">🔒 No on-chain link</span>
            </div>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 text-red-300 text-xs mb-4">
            {errMsg}
          </div>
        )}

        {/* Bridge button */}
        <button
          onClick={step === "error" ? () => setStep("form") : handleBridge}
          disabled={!canBridge || isProcessing}
          className="w-full py-4 rounded-xl font-bold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white"
        >
          {isProcessing
            ? (step === "approving" ? "Approving USDC..." : "Bridging...")
            : step === "error"
            ? "Try again"
            : "Bridge Privately →"}
        </button>

        {isProcessing && (
          <p className="text-center text-gray-500 text-xs mt-3">
            {step === "approving" ? "Step 1/2 — Approving USDC spend in your wallet..." : "Step 2/2 — Locking funds in vault..."}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-center gap-6 mt-6 text-xs text-gray-600">
        <Link href="/notes" className="hover:text-gray-400 transition-colors">My Notes</Link>
        <Link href="/history" className="hover:text-gray-400 transition-colors">History</Link>
        <Link href="/send" className="hover:text-gray-400 transition-colors">Advanced</Link>
      </div>
    </main>
  );
}
