"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Wrong password");
        setBusy(false);
      }
    } catch (e) {
      setErr("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">R</div>
        <h2>builtbyRyder</h2>
        <p>Client dashboard — enter your password to continue.</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
        />
        <div className="login-err">{err}</div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
