/**
 * Live integration test — runs against the local rollup node.
 * Usage: node test-live.mjs
 */

import { ObscuraClient, PrivateKeySigner } from "./dist/index.js";

const NODE_URL = "http://127.0.0.1:12346";
// Test private key (не использовать в продакшне)
const TEST_PRIVATE_KEY = "0x39ffa6690b679b0af4efe7e9e7e67dcdae578a9de0891d31e2debc525299ead6";

async function main() {
  console.log("=== Obscura SDK Live Test ===\n");

  // 1. Check node is alive
  console.log("1. Checking node...");
  const res = await fetch(`${NODE_URL}/modules`).catch(() => null);
  if (!res?.ok) {
    console.error("❌ Node not reachable at", NODE_URL);
    process.exit(1);
  }
  const modules = await res.json();
  console.log("✅ Node alive, modules:", Object.keys(modules.modules).join(", "), "\n");

  // 2. Create client + signer
  console.log("2. Creating client with PrivateKeySigner...");
  const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);
  const address = await signer.getAddress();
  console.log("✅ Signer address:", address, "\n");

  const client = new ObscuraClient({ nodeUrl: NODE_URL });
  client.connect(signer);

  // 3. Test shield transaction
  console.log("3. Submitting shield transaction...");
  try {
    const note = await client.shield({
      amount: 100n,
      assetId: "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    console.log("✅ Shield OK");
    console.log("   Commitment:", note.commitment);
    console.log("   Nullifier: ", note.nullifier, "\n");

    // 4. Test compliance report (no tx needed)
    console.log("4. Generating compliance report...");
    const report = await client.generateComplianceReport({
      notes: [note],
      regulatoryLimit: 1000n,
    });
    console.log("✅ Compliance report:", {
      txCount: report.txCount,
      totalVolume: report.totalVolume.toString(),
      withinLimit: report.withinLimit,
    }, "\n");

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }

  console.log("=== All tests passed ===");
}

main();
