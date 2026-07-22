import { NextResponse } from "next/server";
import { expectedToken, COOKIE_NAME } from "./lib/token";

// Protect every route except the login page, the auth API, and Next internals.
export async function middleware(req) {
  const token = await expectedToken();

  // No password configured => open mode, let everything through.
  if (!token) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (isPublic) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie === token) return NextResponse.next();

  // Not authed. API calls get a 401; page requests redirect to login.
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
