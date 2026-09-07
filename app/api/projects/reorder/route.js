import { NextResponse } from "next/server";
import { reorder, getAll, getEvents } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { moves: [{ id, work, sortOrder }] } — one call per drag.
export async function POST(req) {
  try {
    const body = await req.json();
    const moves = Array.isArray(body) ? body : body.moves;
    if (!Array.isArray(moves)) {
      return NextResponse.json({ error: "Expected { moves: [...] }" }, { status: 400 });
    }
    const count = await reorder(moves);
    const [projects, events] = await Promise.all([getAll(), getEvents()]);
    return NextResponse.json({ moved: count, projects, events });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
