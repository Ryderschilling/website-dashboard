import { NextResponse } from "next/server";
import { expectedToken, COOKIE_NAME, SESSION_MAX_AGE } from "./lib/token";

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
  if (cookie === token) {
    const res = NextResponse.next();
    // Slide the session forward on real use, so an open dashboard never logs
    // itself out mid-edit. Only page and API hits renew it, not static assets.
    if (pathname === "/" || pathname.startsWith("/api")) {
      res.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE,
      });
    }
    return res;
  }

  // Not authed. API calls get a 401; page requests redirect to login.
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Remember where they were so login lands them back on the same screen.
  const url = req.nextUrl.clone();
  const back = pathname + (req.nextUrl.search || "");
  url.pathname = "/login";
  url.search = back === "/" ? "" : "?next=" + encodeURIComponent(back);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
