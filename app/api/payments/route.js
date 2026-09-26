import { NextResponse } from "next/server";
import { getPayments, addPayment } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ payments: await getPayments() });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// Body: { projectId?, client?, kind, amount, date: "YYYY-MM-DD", note? }
// or { items: [ ...same ] } to log several at once (monthly recurring).
export async function POST(req) {
  try {
    const body = await req.json();
    const list = Array.isArray(body && body.items) ? body.items : [body];
    const out = [];
    for (const item of list) out.push(await addPayment(item));
    return NextResponse.json({
      payments: out.map((o) => o.payment),
      projects: out.map((o) => o.project).filter(Boolean),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
