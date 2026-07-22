// Shared auth-token logic. Works in both the Node runtime (API routes) and the
// Edge runtime (middleware) because it only uses Web Crypto.
const SALT = "builtbyryder_dashboard_v1";

export async function expectedToken() {
  const pw = process.env.DASHBOARD_PASSWORD || "";
  if (!pw) return null; // no password set => open mode
  const data = new TextEncoder().encode(pw + SALT);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const COOKIE_NAME = "dash_auth";
