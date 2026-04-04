"use client";

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { CONTRACTS, BILLING_ABI, ERC20_ABI, PLANS } from "@/lib/contracts";
import { formatUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

function formatExpiry(ts: bigint) {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleDateString();
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${active ? "bg-green-900/40 text-green-400" : "bg-gray-800 text-gray-500"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-green-400" : "bg-gray-600"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [buyTxCount, setBuyTxCount] = useState(10);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [step, setStep] = useState<"idle" | "approving" | "subscribing" | "buying">("idle");

  const { data: userState } = useReadContract({
    address: CONTRACTS.billing,
    abi: BILLING_ABI,
    functionName: "users",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

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

  const { data: obscuraBalance } = useReadContract({
    address: CONTRACTS.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: usdcBalance } = useReadContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContractAsync } = useWriteContract();
  const { isLoading: isTxPending } = useWaitForTransactionReceipt({ hash: txHash });

  const planName = ["—", "Starter", "Business", "Enterprise"][userState?.[1] ?? 0] ?? "—";
  const hasDiscount = (obscuraBalance ?? 0n) >= 1000n * 10n ** 18n;
  const isUnlimited = remaining === MAX_UINT256;

  async function approveAndSubscribe(planId: number) {
    if (!address) return;
    const plan = PLANS.find((p) => p.id === planId)!;
    const price = hasDiscount ? (plan.priceRaw * 6000n) / 10000n : plan.priceRaw;
    try {
      setStep("approving");
      const approveTx = await writeContractAsync({
        address: CONTRACTS.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.billing, price],
      });
      setTxHash(approveTx);
      // Wait for approve to be mined before subscribing
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });
      setStep("subscribing");
      const subTx = await writeContractAsync({
        address: CONTRACTS.billing,
        abi: BILLING_ABI,
        functionName: "subscribe",
        args: [planId],
      });
      setTxHash(subTx);
      setStep("idle");
    } catch (e) {
      console.error(e);
      setStep("idle");
    }
  }

  async function buyCredits() {
    if (!address) return;
    const pricePerTx = 100_000n;
    const total = pricePerTx * BigInt(buyTxCount);
    const price = hasDiscount ? (total * 6000n) / 10000n : total;
    try {
      setStep("approving");
      const approveTx = await writeContractAsync({
        address: CONTRACTS.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.billing, price],
      });
      // Wait for approve to be mined before buying
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });
      setStep("buying");
      const tx = await writeContractAsync({
        address: CONTRACTS.billing,
        abi: BILLING_ABI,
        functionName: "payForTx",
        args: [BigInt(buyTxCount)],
      });
      setTxHash(tx);
      setStep("idle");
    } catch (e) {
      console.error(e);
      setStep("idle");
    }
  }

  if (!isConnected) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-24 text-center">
        <h1 className="text-3xl font-bold text-white mb-4">Connect your wallet</h1>
        <p className="text-gray-400 mb-8">Connect to manage your Obscura Network subscription.</p>
        <ConnectButton />
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-white mb-8">Dashboard</h1>

      {/* Status cards */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Status</div>
          <StatusBadge active={!!canSubmit} />
        </div>
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Plan</div>
          <div className="text-white font-semibold">{planName}</div>
        </div>
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Remaining TX</div>
          <div className="text-white font-semibold">
            {isUnlimited ? "Unlimited" : (remaining ?? 0n).toString()}
          </div>
        </div>
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Plan Expiry</div>
          <div className="text-white font-semibold">{formatExpiry(userState?.[2] ?? 0n)}</div>
        </div>
      </div>

      {/* Balances */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 flex justify-between items-center">
          <div>
            <div className="text-gray-400 text-xs mb-1">USDC Balance</div>
            <div className="text-white font-semibold">
              ${formatUnits(usdcBalance ?? 0n, 6)}
            </div>
          </div>
          <div className="text-gray-600 text-2xl">💵</div>
        </div>
        <div className="bg-obscura-card border border-obscura-border rounded-xl p-4 flex justify-between items-center">
          <div>
            <div className="text-gray-400 text-xs mb-1">OBSCURA Balance</div>
            <div className="text-white font-semibold">
              {parseFloat(formatUnits(obscuraBalance ?? 0n, 18)).toLocaleString()} OBSCURA
            </div>
          </div>
          <div>
            {hasDiscount ? (
              <span className="bg-purple-900/40 text-purple-300 text-xs px-2 py-1 rounded-full">40% off</span>
            ) : (
              <span className="text-gray-600 text-xs">Need 1,000 for discount</span>
            )}
          </div>
        </div>
      </div>

      {/* Subscription plans */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Subscribe to a Plan</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan, i) => {
            const isActive = userState?.[1] === plan.id;
            const discountedPrice = hasDiscount
              ? `$${(Number(plan.priceRaw / 1_000_000n) * 0.6).toFixed(2)}`
              : plan.price;
            return (
              <div
                key={plan.id}
                className={`bg-obscura-card border rounded-xl p-5 flex flex-col ${
                  isActive ? "border-purple-500" : "border-obscura-border"
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-white font-semibold">{plan.name}</h3>
                    <div className="text-xl font-bold text-white mt-1">
                      {hasDiscount ? (
                        <>
                          <span className="line-through text-gray-600 text-sm mr-1">{plan.price}</span>
                          {discountedPrice}
                        </>
                      ) : plan.price}
                      <span className="text-gray-500 text-sm font-normal">/mo</span>
                    </div>
                  </div>
                  {isActive && <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full">Active</span>}
                </div>
                <p className="text-gray-400 text-sm mb-4">
                  {plan.txLimit === 0 ? "Unlimited" : plan.txLimit.toLocaleString()} tx/month
                </p>
                <button
                  onClick={() => approveAndSubscribe(plan.id)}
                  disabled={step !== "idle" || isTxPending}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                    i === 1
                      ? "bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                      : "border border-obscura-border hover:border-purple-600 text-gray-300 hover:text-white disabled:opacity-50"
                  }`}
                >
                  {step === "approving" ? "Approving..." : step === "subscribing" ? "Subscribing..." : isActive ? "Renew" : "Subscribe"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pay per tx */}
      <div className="bg-obscura-card border border-obscura-border rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Buy Transaction Credits</h2>
        <p className="text-gray-400 text-sm mb-4">
          $0.10 per tx{hasDiscount ? " → $0.06 (40% off)" : ""}. Credits never expire.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBuyTxCount(Math.max(1, buyTxCount - 10))}
              className="w-8 h-8 rounded-lg border border-obscura-border text-white hover:border-purple-600 transition-colors"
            >−</button>
            <input
              type="number"
              value={buyTxCount}
              onChange={(e) => setBuyTxCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 bg-obscura-dark border border-obscura-border rounded-lg px-3 py-2 text-white text-center text-sm"
            />
            <button
              onClick={() => setBuyTxCount(buyTxCount + 10)}
              className="w-8 h-8 rounded-lg border border-obscura-border text-white hover:border-purple-600 transition-colors"
            >+</button>
          </div>
          <div className="text-gray-400 text-sm">
            = <span className="text-white font-semibold">
              ${hasDiscount ? (buyTxCount * 0.06).toFixed(2) : (buyTxCount * 0.10).toFixed(2)}
            </span> USDC
          </div>
          <button
            onClick={buyCredits}
            disabled={step !== "idle" || isTxPending}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {step === "buying" ? "Buying..." : "Buy Credits"}
          </button>
        </div>
      </div>
    </main>
  );
}
