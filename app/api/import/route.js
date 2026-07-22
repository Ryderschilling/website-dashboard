import { NextResponse } from "next/server";
import { importMany, getAll } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST a JSON array of projects (the backup file from the old dashboard).
// Upserts each by id, so re-importing is safe (no duplicates).
export async function POST(req) {
  try {
    const body = await req.json();
    const list = Array.isArray(body) ? body : body.projects;
    if (!Array.isArray(list)) {
      return NextResponse.json({ error: "Expected a JSON array of projects" }, { status: 400 });
    }
    const count = await importMany(list);
    const projects = await getAll();
    return NextResponse.json({ imported: count, projects });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
