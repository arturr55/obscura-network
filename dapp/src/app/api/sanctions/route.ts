import { NextRequest, NextResponse } from "next/server";

const ORACLE = "http://49.13.23.128:8090";

// GET /api/sanctions?action=check&addr=0x...
// GET /api/sanctions?action=witness&addr=0x...
// GET /api/sanctions?action=root
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "check";
  const addr = req.nextUrl.searchParams.get("addr");

  try {
    let url: string;
    if (action === "root") {
      url = `${ORACLE}/root`;
    } else if (action === "witness") {
      if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });
      url = `${ORACLE}/witness?addr=${encodeURIComponent(addr)}`;
    } else {
      if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });
      url = `${ORACLE}/check?addr=${encodeURIComponent(addr)}`;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
