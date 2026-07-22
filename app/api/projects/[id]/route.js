import { NextResponse } from "next/server";
import { upsert, remove } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req, { params }) {
  try {
    const body = await req.json();
    body.id = params.id;
    const saved = await upsert(body);
    return NextResponse.json({ project: saved });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await remove(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
