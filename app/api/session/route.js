import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Heartbeat. The middleware answers 401 if the session is gone, and renews the
// cookie if it is still good, so the open dashboard can check without a reload.
export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
