import { NextResponse } from "next/server";
import { expectedToken, COOKIE_NAME } from "@/lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { password } -> validate and set the auth cookie.
export async function POST(req) {
  const token = await expectedToken();
  if (!token) {
    // Open mode — nothing to log into.
    return NextResponse.json({ ok: true, open: true });
  }
  let body = {};
  try {
    body = await req.json();
  } catch (e) {}
  const pw = (body.password || "").toString();

  const data = new TextEncoder().encode(pw + "builtbyryder_dashboard_v1");
  const digest = await crypto.subtle.digest("SHA-256", data);
  const submitted = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (submitted !== token) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

// DELETE -> log out.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
