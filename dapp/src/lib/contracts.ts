import { type Address } from "viem";

// ── Obscura Network contracts (chain-independent) ─────────────────────────────

export const CONTRACTS = {
  token:   "0x36cEa233ECc93919D8261d840b2D5918031E7fDA" as Address,
  billing: "0xb14dF903CA08622840706Ea79396b614E2Ea3e27" as Address,
  // USDC used for billing payments (Ethereum Sepolia)
  usdc:    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
};

// ── Multi-chain bridge config ─────────────────────────────────────────────────
//
// ObscuraVault is deployed on each source chain.
// Users deposit tokens here → get bridged tokens on Obscura rollup.
//
// To add a new chain: add an entry to CHAIN_CONFIG and to SUPPORTED_CHAINS.

export type ChainConfig = {
  chainId:       number;
  name:          string;
  shortName:     string;
  rpcUrl:        string;
  explorerUrl:   string;
  vault:         Address;   // ObscuraVault contract
  usdc:          Address;   // USDC on this chain
  nativeCurrency: { name: string; symbol: string; decimals: number };
  testnet:       boolean;
};

export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  // ── Ethereum Sepolia ──────────────────────────────────────────────────────
  11155111: {
    chainId:     11155111,
    name:        "Ethereum Sepolia",
    shortName:   "Ethereum",
    rpcUrl:      "https://eth-sepolia.g.alchemy.com/v2/XvxRMo30ODDpcwJroO83b",
    explorerUrl: "https://sepolia.etherscan.io",
    vault:       "0x25E5ea4b67394Ad2c2cfC69de20f01C2Df88cec1" as Address,
    usdc:        "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    testnet:     true,
  },

  // ── Arbitrum Sepolia ──────────────────────────────────────────────────────
  421614: {
    chainId:     421614,
    name:        "Arbitrum Sepolia",
    shortName:   "Arbitrum",
    rpcUrl:      "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    vault:       "0xA16591631B3eb7e77A89Fd146060B54d50d01a72" as Address,
    usdc:        "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    testnet:     true,
  },

  // ── Base Sepolia ──────────────────────────────────────────────────────────
  84532: {
    chainId:     84532,
    name:        "Base Sepolia",
    shortName:   "Base",
    rpcUrl:      "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    vault:       "0xA16591631B3eb7e77A89Fd146060B54d50d01a72" as Address,
    usdc:        "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    testnet:     true,
  },

  // ── Optimism Sepolia ──────────────────────────────────────────────────────
  11155420: {
    chainId:     11155420,
    name:        "Optimism Sepolia",
    shortName:   "Optimism",
    rpcUrl:      "https://sepolia.optimism.io",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
    vault:       "0xA38e90adf5d9A28Bb554d8253F1e07DFfeb4C8b5" as Address,
    usdc:        "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" as Address,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    testnet:     true,
  },

  // ── Polygon Amoy ─────────────────────────────────────────────────────────
  80002: {
    chainId:     80002,
    name:        "Polygon Amoy",
    shortName:   "Polygon",
    rpcUrl:      "https://rpc-amoy.polygon.technology",
    explorerUrl: "https://amoy.polygonscan.com",
    vault:       "0x0000000000000000000000000000000000000000" as Address, // TODO: deploy
    usdc:        "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" as Address,
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    testnet:     true,
  },

  // ── BSC Testnet ───────────────────────────────────────────────────────────
  97: {
    chainId:     97,
    name:        "BSC Testnet",
    shortName:   "BSC",
    rpcUrl:      "https://data-seed-prebsc-1-s1.binance.org:8545",
    explorerUrl: "https://testnet.bscscan.com",
    vault:       "0x0000000000000000000000000000000000000000" as Address, // TODO: deploy
    usdc:        "0x64544969ed7EBf5f083679233325356EbE738930" as Address,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    testnet:     true,
  },
};

// Chains shown in the bridge UI (source chains — where user sends FROM)
export const SUPPORTED_CHAINS = [11155111, 421614, 84532, 11155420, 80002, 97] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number];

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_CONFIG[chainId];
}

export function isVaultDeployed(chainId: number): boolean {
  const cfg = CHAIN_CONFIG[chainId];
  return !!cfg && cfg.vault !== "0x0000000000000000000000000000000000000000";
}

// ── ObscuraVault ABI ──────────────────────────────────────────────────────────
// Covers the full multi-token vault interface

export const VAULT_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",            type: "address" },
      { name: "amount",           type: "uint256" },
      { name: "obscuraRecipient", type: "bytes32" },
    ],
    outputs: [{ name: "depositId", type: "uint256" }],
  },
  {
    name: "releaseWithProof",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "depositId",       type: "uint256" },
      { name: "recipient",       type: "address" },
      { name: "withdrawalNonce", type: "bytes32" },
      { name: "proofBytes",      type: "bytes"   },
      { name: "publicValues",    type: "bytes"   },
    ],
    outputs: [],
  },
  {
    name: "getDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "sender",           type: "address" },
          { name: "token",            type: "address" },
          { name: "obscuraRecipient", type: "bytes32" },
          { name: "amount",           type: "uint256" },
          { name: "timestamp",        type: "uint64"  },
          { name: "status",           type: "uint8"   },
        ],
      },
    ],
  },
  {
    name: "totalLockedOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "nextDepositId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getSupportedTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  // Events
  {
    name: "DepositLocked",
    type: "event",
    inputs: [
      { name: "depositId",        type: "uint256", indexed: true  },
      { name: "sender",           type: "address", indexed: true  },
      { name: "token",            type: "address", indexed: true  },
      { name: "obscuraRecipient", type: "bytes32", indexed: false },
      { name: "amount",           type: "uint256", indexed: false },
      { name: "timestamp",        type: "uint64",  indexed: false },
    ],
  },
  {
    name: "DepositReleasedZK",
    type: "event",
    inputs: [
      { name: "depositId",   type: "uint256", indexed: true  },
      { name: "recipient",   type: "address", indexed: true  },
      { name: "token",       type: "address", indexed: true  },
      { name: "amount",      type: "uint256", indexed: false },
      { name: "stateRoot",   type: "bytes32", indexed: false },
      { name: "ethBlockHash",type: "bytes32", indexed: false },
    ],
  },
] as const;

// ── Legacy bridge ABI (V2, still on Sepolia) ──────────────────────────────────
// Keep for backward compatibility with existing deposits

export const BRIDGE_V2_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount",           type: "uint256" },
      { name: "obscuraRecipient", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "totalLocked",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "nextDepositId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ── ERC-20 ABI ────────────────────────────────────────────────────────────────

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
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// ── Billing ABI ───────────────────────────────────────────────────────────────

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
      { name: "txCredits",  type: "uint256" },
      { name: "activePlan", type: "uint8"   },
      { name: "planExpiry", type: "uint256" },
      { name: "planTxUsed", type: "uint256" },
    ],
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
