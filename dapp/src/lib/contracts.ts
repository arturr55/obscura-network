import { type Address } from "viem";

export const CONTRACTS = {
  token: "0x36cEa233ECc93919D8261d840b2D5918031E7fDA" as Address,
  billing: "0xb14dF903CA08622840706Ea79396b614E2Ea3e27" as Address,
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
};

export const BILLING_ABI = [
  {
    name: "payForTx",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "txCount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "subscribe",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "plan", type: "uint8" }],
    outputs: [],
  },
  {
    name: "canSubmitTx",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "remainingTx",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "pricePerTx",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "planPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "plan", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "planTxLimit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "plan", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "users",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "txCredits", type: "uint256" },
      { name: "activePlan", type: "uint8" },
      { name: "planExpiry", type: "uint256" },
      { name: "planTxUsed", type: "uint256" },
    ],
  },
  {
    name: "DISCOUNT_THRESHOLD",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const PLANS = [
  {
    id: 1,
    name: "Starter",
    price: "$99",
    priceRaw: 99_000_000n,
    txLimit: 500,
    features: ["500 transactions/month", "Privacy shield", "Basic analytics"],
  },
  {
    id: 2,
    name: "Business",
    price: "$499",
    priceRaw: 499_000_000n,
    txLimit: 5000,
    features: ["5,000 transactions/month", "Priority sequencing", "Full analytics", "API access"],
  },
  {
    id: 3,
    name: "Enterprise",
    price: "$1,999",
    priceRaw: 1_999_000_000n,
    txLimit: 0,
    features: ["Unlimited transactions", "Dedicated sequencer", "SLA guarantee", "Custom compliance"],
  },
] as const;
