import { NextRequest, NextResponse } from "next/server";

const RELAYER_URL = process.env.RELAYER_URL || "http://49.13.23.128:12347";

export async function POST(req: NextRequest) {
  const start = Date.now();
  let depositId: unknown;
  try {
    const body = await req.json();
    depositId = body.deposit_id;
    console.log(`[withdraw] deposit_id=${depositId} eth_recipient=${body.eth_recipient}`);

    const res = await fetch(`${RELAYER_URL}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`[withdraw] deposit_id=${depositId} status=${res.status} ms=${Date.now() - start}`);
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Relayer unreachable";
    console.error(`[withdraw] deposit_id=${depositId} error=${msg} ms=${Date.now() - start}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
