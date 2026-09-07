import { NextResponse } from "next/server";
import { getAll, upsert, getEvents } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [projects, events] = await Promise.all([getAll(), getEvents()]);
    return NextResponse.json({ projects, events });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const saved = await upsert(body);
    return NextResponse.json({ project: saved });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
