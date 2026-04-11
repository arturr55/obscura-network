/**
 * Obscura Vault Relayer — ZK + Trusted hybrid mode
 *
 * Watches ObscuraVault on all chains for DepositLocked events.
 *
 * Release strategy (auto-detected per dest vault):
 *   1. ZK mode:      vaultVKey != 0x00 → calls releaseWithProof() with mock publicValues
 *   2. Trusted mode: vaultVKey == 0x00 → calls releaseFromLiquidity() (legacy)
 *
 * ZK mock proof flow (testnet):
 *   - Computes correct publicValues (depositHash, recipient, nonce, amount, token, …)
 *   - Passes 0x00 as proofBytes (MockSP1Verifier accepts any bytes)
 *   - Tests the full on-chain validation logic without Succinct Prover Network
 */

import {
  createPublicClient, createWalletClient, http,
  parseAbiItem, parseAbi,
  keccak256, encodeAbiParameters, encodePacked,
  pad, toHex, hexToBytes, bytesToHex,
} from "viem";
import { sepolia, arbitrumSepolia, baseSepolia, optimismSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";

const PRIVATE_KEY = process.env.DEPLOY_PRIVATE_KEY || "0x39ffa6690b679b0af4efe7e9e7e67dcdae578a9de0891d31e2debc525299ead6";
const STATE_FILE  = "/root/relayer/vault-relayer-state.json";

const VAULT_ABI = parseAbi([
  "event DepositLocked(uint256 indexed depositId, address indexed sender, address indexed token, bytes32 obscuraRecipient, uint256 amount, uint64 timestamp)",
  "function releaseFromLiquidity(address token, uint256 amount, address recipient) external",
  "function releaseTrusted(uint256 depositId, address recipient) external",
  "function releaseWithProof(uint256 depositId, address recipient, bytes32 withdrawalNonce, bytes calldata proofBytes, bytes calldata publicValues) external",
  "function getDeposit(uint256 id) external view returns (address sender, address token, bytes32 obscuraRecipient, uint256 amount, uint64 timestamp, uint8 status)",
  "function vaultVKey() external view returns (bytes32)",
]);

const CHAINS = {
  11155111: {
    name: "Ethereum Sepolia",
    vault: "0x25E5ea4b67394Ad2c2cfC69de20f01C2Df88cec1",
    usdc:  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chain: sepolia,
    rpc:   "https://ethereum-sepolia-rpc.publicnode.com",
    blockRange: 50n,
  },
  421614: {
    name: "Arbitrum Sepolia",
    vault: "0xA16591631B3eb7e77A89Fd146060B54d50d01a72",
    usdc:  "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    chain: arbitrumSepolia,
    rpc:   "https://sepolia-rollup.arbitrum.io/rpc",
    blockRange: 50n,
  },
  84532: {
    name: "Base Sepolia",
    vault: "0xA16591631B3eb7e77A89Fd146060B54d50d01a72",
    usdc:  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    chain: baseSepolia,
    rpc:   "https://sepolia.base.org",
    blockRange: 50n,
  },
  11155420: {
    name: "Optimism Sepolia",
    vault: "0xA38e90adf5d9A28Bb554d8253F1e07DFfeb4C8b5",
    usdc:  "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    chain: optimismSepolia,
    rpc:   "https://sepolia.optimism.io",
    blockRange: 50n,
  },
};

// ── State ────────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(STATE_FILE)) return { processed: {} };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const account = privateKeyToAccount(PRIVATE_KEY);

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

function bytes32ToAddress(b32) {
  return "0x" + b32.slice(26);
}

// ── ZK public values builder ─────────────────────────────────────────────────

/**
 * Build the 224-byte ABI-encoded publicValues that ObscuraVault._validatePublicValues expects.
 *
 * Layout (7 × 32 bytes):
 *   [0]   bytes32  depositHash  = keccak256(abi.encodePacked(depositId, token, amount, chainId))
 *   [1]   address  recipient    (left-padded)
 *   [2]   bytes32  nonce
 *   [3]   uint256  amount
 *   [4]   address  token        (left-padded)
 *   [5]   bytes32  stateRoot    (mock: zeros for testnet)
 *   [6]   bytes32  ethBlockHash (mock: zeros for testnet)
 */
function buildPublicValues(depositId, token, amount, chainId, recipient, nonce) {
  // depositHash = keccak256(abi.encodePacked(uint256 depositId, address token, uint256 amount, uint256 chainId))
  // abi.encodePacked: uint256 = 32 bytes, address = 20 bytes, uint256 = 32 bytes, uint256 = 32 bytes → 116 bytes
  const depositHashInput = encodePacked(
    ["uint256", "address", "uint256", "uint256"],
    [BigInt(depositId), token, amount, BigInt(chainId)],
  );
  const depositHash = keccak256(depositHashInput);

  // Mock values for testnet
  const stateRoot    = "0x" + "00".repeat(32);
  const ethBlockHash = "0x" + "00".repeat(32);

  // ABI-encode as (bytes32, address, bytes32, uint256, address, bytes32, bytes32)
  const publicValues = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [depositHash, recipient, nonce, amount, token, stateRoot, ethBlockHash],
  );

  return { publicValues, depositHash };
}

// ── Dest chain selection ─────────────────────────────────────────────────────

async function findDestChain(sourceChainId, token, amount) {
  for (const [chainId, cfg] of Object.entries(CHAINS)) {
    if (Number(chainId) === sourceChainId) continue;
    try {
      const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });

      // Check if vault has vKey set (ZK mode available)
      const vKey = await client.readContract({
        address: cfg.vault, abi: VAULT_ABI, functionName: "vaultVKey",
      }).catch(() => "0x" + "00".repeat(32));

      const hasZK = vKey !== "0x" + "00".repeat(32);

      if (hasZK) {
        // ZK mode: no liquidity check needed — vault just needs to have the deposit tokens
        // For testnet mock: dest vault must hold the token (deposited by the relayer funding)
        return { chainId: Number(chainId), cfg, zkMode: true, vKey };
      }

      // Trusted mode: check liquidity
      const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
      const vaultBalance = await client.readContract({
        address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [cfg.vault],
      });
      if (vaultBalance >= amount) return { chainId: Number(chainId), cfg, zkMode: false };
    } catch {}
  }
  return null;
}

// ── Process deposit ──────────────────────────────────────────────────────────

async function processDeposit(sourceChainId, depositId, token, amount, obscuraRecipient) {
  const state = loadState();
  const key = `${sourceChainId}-${depositId}`;
  if (state.processed[key]) return;

  const recipient = bytes32ToAddress(obscuraRecipient);
  log(`Processing deposit #${depositId} on chain ${sourceChainId}: ${amount} tokens → ${recipient}`);

  const dest = await findDestChain(sourceChainId, token, amount);
  if (!dest) {
    log(`⚠ No dest chain found for deposit #${depositId} (no ZK vault or liquidity)`);
    return;
  }

  log(`Releasing on ${dest.cfg.name} vault ${dest.cfg.vault} [${dest.zkMode ? "ZK mode" : "trusted mode"}]`);

  try {
    const walletClient = createWalletClient({
      account,
      chain: dest.cfg.chain,
      transport: http(dest.cfg.rpc),
    });

    let hash;

    if (dest.zkMode) {
      // ── ZK mode: releaseWithProof ─────────────────────────────────────────
      // Generate unique nonce for this withdrawal (anti-replay)
      const nonce = ("0x" + randomBytes(32).toString("hex"));

      const { publicValues } = buildPublicValues(
        depositId, token, amount, dest.chainId, recipient, nonce,
      );

      // Mock proof — MockSP1Verifier accepts any bytes
      const proofBytes = "0x00";

      log(`  ZK: nonce=${nonce.slice(0, 18)}... publicValues=${publicValues.slice(0, 18)}...`);

      hash = await walletClient.writeContract({
        address: dest.cfg.vault,
        abi: VAULT_ABI,
        functionName: "releaseWithProof",
        args: [BigInt(depositId), recipient, nonce, proofBytes, publicValues],
        gas: 300000n,
      });
    } else {
      // ── Trusted mode: releaseFromLiquidity (legacy) ───────────────────────
      hash = await walletClient.writeContract({
        address: dest.cfg.vault,
        abi: VAULT_ABI,
        functionName: "releaseFromLiquidity",
        args: [dest.cfg.usdc, amount, recipient],
        gas: 200000n,
      });
    }

    log(`✅ Released! TX: ${hash}`);
    state.processed[key] = {
      hash, dest: dest.chainId, recipient,
      mode: dest.zkMode ? "zk" : "trusted",
      ts: Date.now(),
    };
    saveState(state);
  } catch (e) {
    log(`❌ Release failed: ${e.message.slice(0, 200)}`);
  }
}

// ── Chain watcher ────────────────────────────────────────────────────────────

async function watchChain(chainId, cfg) {
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
  const stateKey = `lastBlock_${chainId}`;

  log(`Watching ${cfg.name} vault ${cfg.vault}`);

  try {
    const s = loadState();
    if (!s[stateKey]) {
      const block = await client.getBlockNumber();
      const startBlock = block > 200n ? block - 200n : 0n;
      s[stateKey] = startBlock.toString();
      saveState(s);
      log(`${cfg.name}: starting from block ${startBlock}`);
    }
  } catch (e) {
    log(`${cfg.name}: init error - ${e.message.slice(0, 80)}`);
  }

  async function poll() {
    try {
      const block = await client.getBlockNumber();
      const range = cfg.blockRange || 9n;

      const s = loadState();
      const savedBlock = s[stateKey] ? BigInt(s[stateKey]) : (block > range ? block - range : 0n);
      const fromBlock = savedBlock > block ? block - range : savedBlock;
      const toBlock = fromBlock + range > block ? block : fromBlock + range;

      const logs = await client.getLogs({
        address: cfg.vault,
        event: parseAbiItem("event DepositLocked(uint256 indexed depositId, address indexed sender, address indexed token, bytes32 obscuraRecipient, uint256 amount, uint64 timestamp)"),
        fromBlock,
        toBlock,
      });

      if (logs.length > 0) log(`${cfg.name}: ${logs.length} event(s) in blocks ${fromBlock}-${toBlock}`);

      for (const log2 of logs) {
        const { depositId, token, amount, obscuraRecipient } = log2.args;
        await processDeposit(chainId, Number(depositId), token, amount, obscuraRecipient);
      }

      const s2 = loadState();
      s2[stateKey] = (toBlock + 1n).toString();
      saveState(s2);

      if (toBlock < block) setTimeout(poll, 500);
    } catch (e) {
      log(`Error on ${cfg.name}: ${e.message.slice(0, 120)}`);
    }
  }

  poll();
  setInterval(poll, 30000);
}

// ── Start ────────────────────────────────────────────────────────────────────

log("=== Obscura Vault Relayer (ZK + Trusted) ===");
log(`Relayer address: ${account.address}`);

for (const [chainId, cfg] of Object.entries(CHAINS)) {
  watchChain(Number(chainId), cfg);
}

setInterval(() => {}, 60000);
