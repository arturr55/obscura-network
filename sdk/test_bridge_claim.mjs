import { createStandardRollup } from "@sovereign-sdk/web3";
import { PrivateKeySigner } from "./dist/index.js";

const NODE_URL = "http://49.13.23.128:12346";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xYOUR_PRIVATE_KEY_HERE";

const mockProof = [
  0x4f, 0x42, 0x53, 0x62, 0x72, 0x69, 0x64, 0x67, 0x65,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
];

const claimMsg = {
  claim_deposit: {
    proof: mockProof,
    public_inputs: {
      eth_block_hash: Array(32).fill(0xea),
      beacon_block_root: Array(32).fill(0),
      deposit_id: 0,
      obscura_recipient: [
        0,0,0,0,0,0,0,0,0,0,0,0,
        0x30,0x27,0xF5,0xe9,0x2E,0xCF,0xAB,0x92,
        0x0A,0x23,0x88,0x04,0x4d,0xE5,0xd7,0xA7,
        0x6C,0x2f,0x0d,0x4d
      ],
      amount: 10000000,
      bridge_contract: [
        0xb8,0xb2,0xd4,0x10,0x11,0x90,0x97,0xA4,
        0xE5,0x0B,0x4c,0x2a,0xC3,0xFa,0x9d,0xb1,
        0x73,0x8B,0xa1,0x75
      ]
    }
  }
};

console.log("=== Obscura ZK Bridge — ClaimDeposit test ===");

try {
  const signer = new PrivateKeySigner(PRIVATE_KEY);
  const addr = await signer.getAddress();
  console.log("Sender:", addr);

  const rollup = await createStandardRollup({ url: NODE_URL });
  const runtimeCall = { obscura_bridge: claimMsg };

  console.log("Submitting ClaimDeposit (deposit_id=0, amount=10 USDC)...");
  const result = await rollup.call(runtimeCall, { signer });
  console.log("SUCCESS:", JSON.stringify(result, null, 2));
} catch (e) {
  console.log("Error:", e.message || e);
}
