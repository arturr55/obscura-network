import { NextResponse } from "next/server";

const NODE_URL = process.env.NODE_URL ?? "http://49.13.23.128:12346";
const SANCTIONS_URL = process.env.SANCTIONS_URL ?? "http://49.13.23.128:8090";

export async function GET() {
  const [slotRes, sanctionsRes] = await Promise.allSettled([
    fetch(`${NODE_URL}/ledger/slots/latest`, { next: { revalidate: 10 } }),
    fetch(`${SANCTIONS_URL}/root`, { next: { revalidate: 60 } }),
  ]);

  let slot: number | null = null;
  let stateRoot: string | null = null;
  if (slotRes.status === "fulfilled" && slotRes.value.ok) {
    try {
      const d = await slotRes.value.json();
      slot = d.number ?? null;
      stateRoot = d.state_root ?? null;
    } catch {}
  }

  let sanctionsAddresses: number | null = null;
  let sanctionsRoot: string | null = null;
  if (sanctionsRes.status === "fulfilled" && sanctionsRes.value.ok) {
    try {
      const d = await sanctionsRes.value.json();
      sanctionsAddresses = d.address_count ?? null;
      sanctionsRoot = d.root ?? null;
    } catch {}
  }

  return NextResponse.json({
    slot,
    stateRoot,
    sanctionsAddresses,
    sanctionsRoot,
    nodeOnline: slot !== null,
    oracleOnline: sanctionsAddresses !== null,
    ts: Date.now(),
  });
}
