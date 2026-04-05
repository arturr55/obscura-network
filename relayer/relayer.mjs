/**
 * Obscura Bridge Auto-Relayer
 *
 * Watches Ethereum Sepolia for DepositLocked events from ObscuraBridge.sol,
 * then submits ClaimDeposit transactions to the Obscura rollup.
 *
 * Usage:
 *   node relayer.mjs
 *
 * Env vars (or edit CONFIG below):
 *   ETH_RPC_URL      — Ethereum JSON-RPC endpoint
 *   OBSCURA_RPC_URL  — Obscura rollup RPC endpoint
 *   PRIVATE_KEY      — relayer private key (hex, with 0x)
 *   BRIDGE_CONTRACT  — ObscuraBridge.sol address
 *   START_BLOCK      — block to start scanning from (0 = auto)
 */

import { createPublicClient, createWalletClient, http, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { createServer } from "http";
import { createStandardRollup } from "@sovereign-sdk/web3";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const BRIDGE_RELEASE_ABI = [
  {
    name: "releaseMultisig",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "depositId",       type: "uint256" },
      { name: "recipient",       type: "address" },
      { name: "withdrawalNonce", type: "bytes32" },
      { name: "signatures",      type: "bytes[]"  },
    ],
    outputs: [],
  },
  {
    name: "releaseHash",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "depositId",       type: "uint256" },
      { name: "recipient",       type: "address" },
      { name: "withdrawalNonce", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
];

const CONFIG = {
  ethRpcUrl:
    process.env.ETH_RPC_URL ||
    "https://eth-sepolia.g.alchemy.com/v2/XvxRMo30ODDpcwJroO83b",
  obscuraRpcUrl:
    process.env.OBSCURA_RPC_URL || "http://localhost:12346",
  privateKey:
    process.env.PRIVATE_KEY ||
    "0x39ffa6690b679b0af4efe7e9e7e67dcdae578a9de0891d31e2debc525299ead6",
  bridgeContract:
    process.env.BRIDGE_CONTRACT ||
    "0xE629E85f61a4F0E6cee1F18B06332f8ABCD0EDeD",

  // Additional signer keys for 2-of-3 multisig (V2 bridge).
  // In production: signer2/3 keys live on separate machines.
  // On testnet: all 3 keys on the same server (still tests the contract logic).
  signerKey2:
    process.env.SIGNER_KEY2 ||
    "0x01fafcbe9441f283d811d79dc5ac9813a4b548c03af05a438c354df716312af8",
  signerKey3:
    process.env.SIGNER_KEY3 ||
    "0x955a8da3df6d00bb4b0c4376cc5057201e7c4727c27cf114fc3bf10a3c9a4c8d",
  pollIntervalMs: 30_000,   // check Ethereum every 30 seconds
  stateFile: "./relayer-state.json",
};

// ── DepositLocked event ABI ───────────────────────────────────────────────────
// event DepositLocked(uint256 indexed depositId, address indexed sender,
//                     bytes32 indexed obscuraRecipient, uint256 amount, uint64 timestamp)

const DEPOSIT_LOCKED_EVENT = parseAbiItem(
  "event DepositLocked(uint256 indexed depositId, address indexed sender, bytes32 indexed obscuraRecipient, uint256 amount, uint64 timestamp)"
);

// ── State persistence ─────────────────────────────────────────────────────────

function loadState() {
  if (existsSync(CONFIG.stateFile)) {
    try {
      return JSON.parse(readFileSync(CONFIG.stateFile, "utf8"));
    } catch {}
  }
  return { lastBlock: 0, claimed: [], pendingRetry: [] };
}

function saveState(state) {
  writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// ── Mock proof builder ────────────────────────────────────────────────────────

function buildMockProof(depositId) {
  // "OBSbridge" + depositId as little-endian u64
  const prefix = [0x4f, 0x42, 0x53, 0x62, 0x72, 0x69, 0x64, 0x67, 0x65];
  const idBytes = new Array(8);
  let id = BigInt(depositId);
  for (let i = 0; i < 8; i++) {
    idBytes[i] = Number(id & 0xffn);
    id >>= 8n;
  }
  return [...prefix, ...idBytes];
}

// ── Address helpers ───────────────────────────────────────────────────────────

function hexToBytes20(hex) {
  const clean = hex.replace("0x", "").toLowerCase().padStart(40, "0");
  const bytes = [];
  for (let i = 0; i < 40; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

function hexToBytes32(hex) {
  const clean = hex.replace("0x", "").toLowerCase().padStart(64, "0");
  const bytes = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

// ── Signer ────────────────────────────────────────────────────────────────────

class PrivateKeySigner {
  constructor(privateKey) {
    this.account = privateKeyToAccount(privateKey);
    this._privBytes = Uint8Array.from(
      Buffer.from(privateKey.replace("0x", ""), "hex")
    );
  }

  async getAddress() {
    return this.account.address;
  }

  async publicKey() {
    return secp256k1.getPublicKey(this._privBytes, true); // compressed
  }

  async sign(message) {
    // Mirror @sovereign-sdk/signers Secp256k1Signer: keccak256(message) then sign
    const msgHash = keccak_256(message);
    const sig = secp256k1.sign(msgHash, this._privBytes);
    return sig.toCompactRawBytes(); // 64 bytes compact (r+s, no recovery ID)
  }
}

// ── Submit ClaimDeposit ───────────────────────────────────────────────────────

async function claimDeposit(signer, log, blockHash) {
  const { depositId, obscuraRecipient, amount } = log.args;

  const proof = buildMockProof(Number(depositId));

  const claimMsg = {
    claim_deposit: {
      proof,
      public_inputs: {
        eth_block_hash: hexToBytes32(blockHash),
        beacon_block_root: Array(32).fill(0),
        deposit_id: Number(depositId),
        obscura_recipient: hexToBytes32(obscuraRecipient),
        amount: Number(amount),
        bridge_contract: hexToBytes20(CONFIG.bridgeContract),
      },
    },
  };

  const rollup = await createStandardRollup({ url: CONFIG.obscuraRpcUrl });
  const result = await rollup.call(
    { obscura_bridge: claimMsg },
    { signer }
  );

  return result.response?.id;
}

// ── Auto-Shield bridged USDC ──────────────────────────────────────────────────

// Bridged USDC asset ID — must match Rust: AssetId(*b"bridged-usdc-obscura-network-v01")
const BRIDGED_USDC_ASSET_ID = "627269646765642d757364632d6f6273637572612d6e6574776f726b2d763031";

function bridgeShieldSalt(depositId, obscuraRecipientHex) {
  // Deterministic salt: keccak256("obscura_bridge_shield_v1" || depositId_le8 || recipient_32)
  const prefix = Buffer.from("obscura_bridge_shield_v1");
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(depositId));
  const recipientBuf = Buffer.from(obscuraRecipientHex.replace("0x", "").padStart(64, "0"), "hex");
  return Array.from(keccak_256(Buffer.concat([prefix, idBuf, recipientBuf])));
}

async function autoShield(signer, depositId, obscuraRecipient, amount) {
  const salt = bridgeShieldSalt(depositId, obscuraRecipient);
  const ownerPubkey = hexToBytes32(obscuraRecipient); // 32 bytes

  const shieldMsg = {
    shield: {
      note: {
        amount: Number(amount),
        asset_id: BRIDGED_USDC_ASSET_ID,
        owner_pubkey: ownerPubkey,
        salt,
      },
    },
  };

  const rollup = await createStandardRollup({ url: CONFIG.obscuraRpcUrl });
  const result = await rollup.call({ obscura_privacy: shieldMsg }, { signer });
  return result.response?.id;
}

// ── Process Withdrawal ────────────────────────────────────────────────────────

async function submitWithdrawBridge(signer, depositId, ethRecipient) {
  const msg = {
    withdraw_bridge: {
      deposit_id: depositId,
      eth_recipient: hexToBytes20(ethRecipient),
    },
  };

  const rollup = await createStandardRollup({ url: CONFIG.obscuraRpcUrl });
  const result = await rollup.call({ obscura_bridge: msg }, { signer });
  return result.response?.id;
}

async function releaseOnEthereum(depositId, recipient) {
  const account1 = privateKeyToAccount(CONFIG.privateKey);
  const account2 = privateKeyToAccount(CONFIG.signerKey2);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.ethRpcUrl),
  });
  const walletClient = createWalletClient({
    account: account1,
    chain: sepolia,
    transport: http(CONFIG.ethRpcUrl),
  });

  // Deterministic nonce: keccak256(depositId LE8 || recipient || timestamp rounded to 60s)
  // Rounded so both signers agree on the nonce even if they run slightly apart.
  const ts = BigInt(Math.floor(Date.now() / 60_000) * 60);
  const nonceInput = Buffer.alloc(32);
  nonceInput.writeBigUInt64LE(BigInt(depositId), 0);
  Buffer.from(recipient.replace("0x", "").padStart(40, "0"), "hex").copy(nonceInput, 8);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64LE(ts);
  tsBuf.copy(nonceInput, 28);
  const withdrawalNonce = ("0x" + Buffer.from(keccak_256(nonceInput)).toString("hex"));

  // Get the raw payload hash from the contract (avoids recomputing chainId client-side)
  const rawPayload = await publicClient.readContract({
    address: CONFIG.bridgeContract,
    abi: BRIDGE_RELEASE_ABI,
    functionName: "releaseHash",
    args: [BigInt(depositId), recipient, withdrawalNonce],
  });

  // Both signers sign using eth_sign (personal_sign adds the \x19Ethereum... prefix)
  const sig1 = await account1.signMessage({ message: { raw: rawPayload } });
  const sig2 = await account2.signMessage({ message: { raw: rawPayload } });

  console.log(`  [multisig] signer1=${account1.address} signer2=${account2.address}`);

  const txHash = await walletClient.writeContract({
    address: CONFIG.bridgeContract,
    abi: BRIDGE_RELEASE_ABI,
    functionName: "releaseMultisig",
    args: [BigInt(depositId), recipient, withdrawalNonce, [sig1, sig2]],
  });

  return txHash;
}

async function processWithdrawal(signer, depositId, ethRecipient) {
  // Step 1: record on Obscura rollup
  let obscuraTxId;
  try {
    obscuraTxId = await submitWithdrawBridge(signer, depositId, ethRecipient);
    console.log(`  Withdrawal recorded on Obscura: ${obscuraTxId}`);
  } catch (e) {
    // Non-fatal: rollup might reject if already withdrawn, continue to ETH release
    console.warn(`  Obscura withdrawal TX failed: ${e.message}`);
  }

  // Step 2: release on Ethereum
  const ethTxHash = await releaseOnEthereum(depositId, ethRecipient);
  return { obscuraTxId, ethTxHash };
}

// ── HTTP Server for withdrawal requests ───────────────────────────────────────

function startWithdrawServer(signer) {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/withdraw") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      try {
        const { deposit_id, eth_recipient } = JSON.parse(body);
        if (typeof deposit_id !== "number" || !eth_recipient?.match(/^0x[0-9a-fA-F]{40}$/)) {
          throw new Error("Invalid parameters: deposit_id (number) and eth_recipient (0x address) required");
        }
        console.log(`[${timestamp()}] Withdrawal request: deposit ${deposit_id} → ${eth_recipient}`);
        const result = await processWithdrawal(signer, deposit_id, eth_recipient);
        console.log(`[${timestamp()}] ✅ Withdrawal done: ETH TX ${result.ethTxHash}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) {
        console.error(`[${timestamp()}] ❌ Withdrawal error: ${e.message}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  server.listen(12347, () => {
    console.log("Withdrawal API server listening on port 12347");
  });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║   Obscura Bridge Auto-Relayer  v0.1           ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`Bridge contract : ${CONFIG.bridgeContract}`);
  console.log(`Ethereum RPC    : ${CONFIG.ethRpcUrl}`);
  console.log(`Obscura RPC     : ${CONFIG.obscuraRpcUrl}`);
  console.log();

  const ethClient = createPublicClient({
    chain: sepolia,
    transport: http(CONFIG.ethRpcUrl),
  });

  const signer = new PrivateKeySigner(CONFIG.privateKey);
  const relayerAddr = await signer.getAddress();
  console.log(`Relayer address : ${relayerAddr}`);
  console.log();

  startWithdrawServer(signer);

  let state = loadState();

  // If no saved block, start from 50 blocks ago (covers recent deposits)
  if (state.lastBlock === 0) {
    const latest = await ethClient.getBlockNumber();
    state.lastBlock = Number(latest) - 50;
    console.log(`Starting from block ${state.lastBlock} (latest - 50)`);
  }

  console.log("Polling for DepositLocked events every 30s...\n");

  while (true) {
    try {
      // ── Retry previously failed claims ──────────────────────────────────────
      if (state.pendingRetry && state.pendingRetry.length > 0) {
        console.log(`[${timestamp()}] Retrying ${state.pendingRetry.length} pending claim(s)...`);
        const stillPending = [];
        for (const pending of state.pendingRetry) {
          try {
            // Reconstruct a minimal log-like object for claimDeposit
            const syntheticLog = {
              args: {
                depositId: BigInt(pending.depositId),
                obscuraRecipient: pending.obscuraRecipient,
                amount: BigInt(pending.amount),
                sender: pending.sender,
              },
              blockHash: pending.blockHash,
            };
            const txHash = await claimDeposit(signer, syntheticLog, pending.blockHash);
            console.log(`  ✅ retry claimed deposit ${pending.depositId}! Obscura TX: ${txHash} (auto-shielded by bridge module)`);
            state.claimed.push(pending.depositId);
          } catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes("already claimed") || msg.includes("nonce used")) {
              console.log(`  ⚠️  deposit ${pending.depositId}: already processed on-chain`);
              state.claimed.push(pending.depositId);
            } else {
              console.error(`  ❌ retry failed deposit ${pending.depositId}: ${msg}`);
              stillPending.push(pending);
            }
          }
        }
        state.pendingRetry = stillPending;
        saveState(state);
      }

      const latestBlock = Number(await ethClient.getBlockNumber());

      if (latestBlock <= state.lastBlock) {
        await sleep(CONFIG.pollIntervalMs);
        continue;
      }

      const fromBlock = BigInt(state.lastBlock + 1);
      // Alchemy Free tier: max 10 blocks per eth_getLogs request
      const toBlock = BigInt(Math.min(latestBlock, state.lastBlock + 9));

      console.log(
        `[${timestamp()}] Scanning blocks ${fromBlock}..${toBlock}`
      );

      const logs = await ethClient.getLogs({
        address: CONFIG.bridgeContract,
        event: DEPOSIT_LOCKED_EVENT,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const depositId = Number(log.args.depositId);
        const amount = Number(log.args.amount);

        if (state.claimed.includes(depositId)) {
          console.log(`  deposit ${depositId}: already claimed, skip`);
          continue;
        }
        if (state.pendingRetry?.some(p => p.depositId === depositId)) {
          continue; // already in retry queue
        }

        console.log(
          `  deposit ${depositId}: ${amount / 1e6} USDC → ${log.args.obscuraRecipient.slice(0, 18)}...`
        );

        try {
          const txHash = await claimDeposit(signer, log, log.blockHash);
          console.log(`  ✅ claimed + auto-shielded! Obscura TX: ${txHash}`);
          state.claimed.push(depositId);
          saveState(state);
        } catch (e) {
          const msg = e?.message || String(e);
          if (msg.includes("already claimed") || msg.includes("nonce used")) {
            console.log(`  ⚠️  deposit ${depositId}: already processed on-chain`);
            state.claimed.push(depositId);
            saveState(state);
          } else {
            console.error(`  ❌ claim failed: ${msg} — queued for retry`);
            if (!state.pendingRetry) state.pendingRetry = [];
            // Store only serializable fields (BigInt → Number/String)
            state.pendingRetry.push({
              depositId,
              blockHash: log.blockHash,
              obscuraRecipient: log.args.obscuraRecipient,
              amount: Number(log.args.amount),
              sender: log.args.sender,
            });
            saveState(state);
          }
        }
      }

      state.lastBlock = Number(toBlock);
      saveState(state);
    } catch (e) {
      console.error(`[${timestamp()}] Scan error: ${e?.message || e}`);
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
