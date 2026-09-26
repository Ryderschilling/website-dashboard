"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { Sidebar, SidebarBody, SidebarLink, useSidebar } from "@/components/ui/sidebar";
import { motion } from "framer-motion";
import PipelineBoard from "@/components/PipelineBoard";
import RevenueView, { undatedCash } from "@/components/RevenueView";
import { LayoutList, KanbanSquare, BarChart3, Plus, Upload, Download, FileDown, LogOut } from "lucide-react";
import {
  STAGES, STAGE_COLORS, STAGE_HINTS, normStage,
  isDone as stageIsDone, isLost, isRecurring as stageIsRecurring, isOpen,
  daysInStage, stageHealth, stageIndex,
  MONTHLY_TARGET, DEAL_FLOOR, RETAINER_TIERS, INCOME_TYPES, isClient, FUNNEL,
} from "@/lib/pipeline";

const WORK_STATUSES = STAGES;
const WORK_COLORS = STAGE_COLORS;
const normWork = normStage;
const normProject = (p) => ({ ...p, work: normWork(p.work) });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const HEALTH_COLOR = { ok: "var(--faint)", warn: "var(--amber)", stale: "var(--red)" };

// ---- helpers ----
const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const outstanding = (p) => Math.max(0, num(p.deal) - num(p.paid));
const refOwed = (p) => (p.refpaid ? 0 : (num(p.paid) * num(p.refpct)) / 100);
// Recurring = the build shipped AND a retainer is actively billing.
// Complete = shipped, one-time only. Both count as finished work.
const isRecurring = (p) => stageIsRecurring(p.work);
const isDone = (p) => stageIsDone(p.work);
const isDead = (p) => isLost(p.work);
// MRR only counts once the job has shipped and the retainer is actually billing
const liveMrr = (p) => (isDone(p) ? num(p.mrr) : 0);
// Full months of retainer billed so far, counted from launch (falls back to due/start).
const monthsBilled = (p) => {
  if (!isDone(p) || num(p.mrr) <= 0) return 0;
  const d = parseDate(p.launch || p.due || p.start);
  if (!d) return 0;
  const t = today();
  let m = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
  if (t.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
};
// Recurring money actually collected to date: months billed x monthly rate
const recurringCollected = (p) => monthsBilled(p) * num(p.mrr);
function payStatus(p) {
  const d = num(p.deal), pd = num(p.paid);
  if (d <= 0) return "No deal set"; // no deal amount => completion is undefined
  if (pd <= 0) return "Unpaid";
  if (pd >= d) return "Paid in full";
  return "Partially paid";
}
function payColor(s) {
  if (s === "Paid in full") return "#3fb950";
  if (s === "Partially paid") return "#d29922";
  if (s === "Unpaid") return "#f0603a";
  return "#5a5f6a";
}
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function parseDate(s) { if (!s) return null; const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }
function fmtDate(s) { const d = parseDate(s); if (!d) return "—"; return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }); }
function hexA(hex, a) {
  let h = hex.replace("#", ""); if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const BLANK = {
  id: "", client: "", project: "", live: "", staging: "", niche: "", work: "Lead",
  deal: "", paid: "", mrr: "", refby: "", refpct: "", refpaid: false,
  start: "", due: "", launch: "", notes: "", lostReason: "", sortOrder: 0, stageAt: "", incomeType: "client",
};

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [events, setEvents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("projects");
  const [q, setQ] = useState("");
  const [fWork, setFWork] = useState("");
  const [fPay, setFPay] = useState("");
  const [sort, setSort] = useState({ key: "mrr", dir: -1 });
  const [editing, setEditing] = useState(null); // null=closed, {}=new, {..}=edit
  const [form, setForm] = useState(BLANK);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [expired, setExpired] = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);
  const fileRef = useRef(null);

  // ---- load ----
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    function close() { setMenuOpen(false); }
    if (menuOpen) { document.addEventListener("click", close); return () => document.removeEventListener("click", close); }
  }, [menuOpen]);
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") closeModal(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Keep the session warm while the tab sits open, and notice a dead one before
  // you click something. The middleware renews the cookie on every ping.
  useEffect(() => {
    let alive = true;
    async function ping() {
      if (!alive || document.hidden) return;
      try {
        const r = await fetch("/api/session", { cache: "no-store" });
        if (alive) setExpired(r.status === 401);
      } catch (_) { /* offline: leave the banner as it is */ }
    }
    const t = setInterval(ping, 4 * 60 * 1000);
    document.addEventListener("visibilitychange", ping);
    window.addEventListener("focus", ping);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", ping);
      window.removeEventListener("focus", ping);
    };
  }, []);

  async function refresh() {
    try {
      const d = await api("/api/projects");
      setProjects((d.projects || []).map(normProject));
      setEvents(d.events || []);
      setPayments(d.payments || []);
      setExpired(false);
    } catch (e) { failToast("Could not load your projects", e); }
    setLoading(false);
  }
  function showToast(m) { setToast(m); clearTimeout(showToast._t); showToast._t = setTimeout(() => setToast(""), 2400); }

  // ---- one door for every API call ----------------------------------------
  // Before this, a failed write showed a generic line like "Could not update
  // phase", which hid the two things that actually go wrong: an expired login
  // (401) and a real server error. Now a 401 says so and sends you to the login
  // screen, and anything else shows the server's own message.
  async function api(url, opts) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (netErr) {
      // one quick retry covers a dropped packet or a cold serverless start
      await new Promise((r) => setTimeout(r, 700));
      res = await fetch(url, opts);
    }
    if (res.status === 401) {
      setExpired(true);
      const back = window.location.pathname + window.location.search;
      setTimeout(() => { window.location.href = "/login?next=" + encodeURIComponent(back); }, 1500);
      const e = new Error("Session expired, sending you to the login screen");
      e.auth = true;
      throw e;
    }
    if (!res.ok) {
      let msg = "";
      try { const d = await res.json(); if (d && d.error) msg = String(d.error); } catch (_) {}
      throw new Error(msg || ("Server error " + res.status));
    }
    if (res.status === 204) return {};
    return res.json().catch(() => ({}));
  }
  // Short, readable failure text. Server messages can run long, so they get cut.
  function failToast(prefix, err) {
    if (err && err.auth) { showToast("⚠ " + err.message); return; }
    const m = (err && err.message ? String(err.message) : "unknown error").slice(0, 90);
    showToast("⚠ " + prefix + ": " + m);
  }

  // ---- CRUD ----
  function openModal(p) {
    setEditing(p || {});
    setForm(p ? { ...BLANK, ...p } : { ...BLANK });
    setDelConfirm(false);
  }
  function closeModal() { setEditing(null); }
  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function saveForm() {
    if (!form.client.trim()) { showToast("⚠ Client name is required"); return; }
    const isEdit = !!(editing && editing.id);
    const url = isEdit ? `/api/projects/${editing.id}` : "/api/projects";
    const method = isEdit ? "PUT" : "POST";
    try {
      const d = await api(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const saved = normProject(d.project);
      setProjects((list) => {
        const i = list.findIndex((x) => x.id === saved.id);
        if (i >= 0) { const c = list.slice(); c[i] = saved; return c; }
        return [...list, saved];
      });
      closeModal();
      showToast(isEdit ? "Project updated" : "Project added");
      // the stage may have moved, so pull the fresh event log for Analytics
      refresh();
    } catch (e) { failToast("Save failed", e); }
  }

  // ---- payments (the real month-by-month record) ----
  async function addPayments(items) {
    try {
      const d = await api("/api/payments", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
      });
      setPayments((list) => [...(d.payments || []), ...list]);
      if (d.projects && d.projects.length) {
        setProjects((list) => list.map((x) => {
          const u = d.projects.find((y) => y.id === x.id);
          return u ? normProject(u) : x;
        }));
      }
      const n = (d.payments || []).length;
      showToast(n === 1 ? "Payment logged" : n + " payments logged");
      return true;
    } catch (e) { failToast("Could not log payment", e); return false; }
  }
  async function deletePayment(id) {
    try {
      await api(`/api/payments/${id}`, { method: "DELETE" });
      setPayments((list) => list.filter((x) => x.id !== id));
      showToast("Payment removed");
      return true;
    } catch (e) { failToast("Could not remove payment", e); return false; }
  }

  async function deleteCurrent() {
    if (!delConfirm) { setDelConfirm(true); setTimeout(() => setDelConfirm(false), 3000); return; }
    const id = editing.id;
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      setProjects((list) => list.filter((x) => x.id !== id));
      closeModal();
      showToast("Project deleted");
    } catch (e) { failToast("Delete failed", e); }
  }

  // ---- inline quick phase change ----
  async function quickWork(p, newWork) {
    if (!newWork || newWork === p.work) return;
    const prev = projects;
    setProjects((list) => list.map((x) => (x.id === p.id ? { ...x, work: newWork } : x)));
    try {
      const d = await api(`/api/projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, work: newWork }),
      });
      const saved = normProject(d.project);
      setProjects((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      showToast("Phase updated");
    } catch (e) {
      setProjects(prev);
      failToast("Could not update phase", e);
    }
  }

  // ---- board drag/drop persistence ----
  // Optimistic: paint the new order immediately, roll back if the write fails.
  async function saveBoard(moves) {
    const prev = projects;
    const rank = {};
    moves.forEach((m) => (rank[m.id] = m));
    setProjects((list) =>
      list.map((x) => (rank[x.id] ? { ...x, work: rank[x.id].work, sortOrder: rank[x.id].sortOrder } : x))
    );
    try {
      const d = await api("/api/projects/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      setProjects((d.projects || []).map(normProject));
      if (d.events) setEvents(d.events);
      return true;
    } catch (e) {
      setProjects(prev);
      failToast("Could not save the move", e);
      return false;
    }
  }

  // ---- import / export ----
  function backup() {
    downloadBlob(new Blob([JSON.stringify(projects, null, 2)], { type: "application/json" }), "ryder-schilling-clients-backup.json");
    showToast("Backup downloaded");
  }
  function exportCsv() {
    const cols = ["client","project","live","staging","niche","work","deal","paid","outstanding","payment_status","mrr","refby","refpct","referral_owed","refpaid","start","due","launch","notes"];
    const cell = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [cols.join(",")];
    projects.forEach((p) => rows.push([p.client,p.project,p.live,p.staging,p.niche,p.work,p.deal,p.paid,outstanding(p),payStatus(p),p.mrr,p.refby,p.refpct,Math.round(refOwed(p)),p.refpaid?"yes":"no",p.start,p.due,p.launch,p.notes].map(cell).join(",")));
    downloadBlob(new Blob([rows.join("\n")], { type: "text/csv" }), "ryder-schilling-clients.csv");
    showToast("CSV exported");
  }
  function triggerImport() { fileRef.current && fileRef.current.click(); }
  async function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.projects;
      if (!Array.isArray(list)) throw new Error("that file is not a project backup");
      const d = await api("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list) });
      setProjects((d.projects || []).map(normProject));
      showToast(`Imported ${d.imported} projects into the database`);
    } catch (err) { failToast("Import failed", err); }
    e.target.value = "";
  }

  // ---- derived: filtered + sorted ----
  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    let list = projects.filter((p) => {
      // Lost deals stay out of the table unless you filter for them on purpose.
      if (!fWork && isDead(p)) return false;
      if (fWork && p.work !== fWork) return false;
      if (fPay && payStatus(p) !== fPay) return false;
      if (ql) {
        const hay = (p.client + " " + p.project + " " + p.niche + " " + p.refby + " " + p.notes).toLowerCase();
        if (hay.indexOf(ql) < 0) return false;
      }
      return true;
    });
    const dir = sort.dir;
    list = list.slice().sort((a, b) => {
      let av, bv;
      switch (sort.key) {
        case "client": av = a.client.toLowerCase(); bv = b.client.toLowerCase(); break;
        case "deal": av = num(a.deal); bv = num(b.deal); break;
        case "paid": av = num(a.paid); bv = num(b.paid); break;
        case "out": av = outstanding(a); bv = outstanding(b); break;
        case "mrr": av = liveMrr(a); bv = liveMrr(b); break;
        case "work": av = stageIndex(a.work); bv = stageIndex(b.work); break;
        case "age": av = daysInStage(a) ?? -1; bv = daysInStage(b) ?? -1; break;
        case "due": av = a.due || "9999"; bv = b.due || "9999"; break;
        default: av = a.client; bv = b.client;
      }
      if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
    });
    return list;
  }, [projects, q, fWork, fPay, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  // ---- render ----
  if (loading) {
    return <div className="loading"><span className="spinner" /> Loading your clients…</div>;
  }

  const openCount = projects.filter((p) => isOpen(p.work)).length;
  const staleCount = projects.filter((p) => stageHealth(p) === "stale").length;

  const NAV = [
    { key: "projects",  label: "Projects",  icon: <LayoutList size={18} />,     badge: projects.length || null },
    { key: "pipeline",  label: "Pipeline",  icon: <KanbanSquare size={18} />,   badge: openCount || null },
    { key: "analytics", label: "Analytics", icon: <BarChart3 size={18} />,      badge: null },
  ];

  const menu = (
    <div className="menu">
      <button className="btn ghost" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>•••</button>
      <div className={"menu-list" + (menuOpen ? " open" : "")}>
        <button onClick={triggerImport}>Import (JSON backup)</button>
        <button onClick={backup}>Backup (JSON)</button>
        <button onClick={exportCsv}>Export CSV</button>
        <button onClick={logout} style={{ color: "var(--muted)" }}>Log out</button>
      </div>
    </div>
  );

  const nav = (
    <SidebarBody className="justify-between gap-8">
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
        <div className="side-brand">
          <span className="logo">R</span>
          <SideLabel>Ryder Schilling</SideLabel>
        </div>
        <div className="side-links">
          {NAV.map((link) => (
            <SidebarLink
              key={link.key}
              link={link}
              active={tab === link.key}
              onSelect={(k) => { setTab(k); setSidebarOpen(false); }}
            />
          ))}
        </div>
      </div>
      <div className="side-foot">
        <SidebarLink
          link={{ key: "add", label: "Add project", icon: <Plus size={18} /> }}
          onSelect={() => { openModal(null); setSidebarOpen(false); }}
        />
        <SidebarLink
          link={{ key: "import", label: "Import backup", icon: <Upload size={18} /> }}
          onSelect={() => { triggerImport(); setSidebarOpen(false); }}
        />
        <SidebarLink
          link={{ key: "backup", label: "Backup JSON", icon: <Download size={18} /> }}
          onSelect={() => backup()}
        />
        <SidebarLink
          link={{ key: "csv", label: "Export CSV", icon: <FileDown size={18} /> }}
          onSelect={() => exportCsv()}
        />
        <SidebarLink
          link={{ key: "logout", label: "Log out", icon: <LogOut size={18} /> }}
          onSelect={() => logout()}
        />
      </div>
    </SidebarBody>
  );

  return (
    <>
      <div className="app-shell">
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen}>{nav}</Sidebar>

        <div className="app-main">
          <header className="top">
            <div className="wrap top-inner">
              <div className="brand">
                {tab === "pipeline" ? "Pipeline" : tab === "analytics" ? "Analytics" : "Clients"}
                {staleCount > 0 && tab !== "analytics" ? (
                  <span className="dim" style={{ color: "var(--red)", fontSize: 12.5, marginLeft: 8 }}>
                    {staleCount} stuck
                  </span>
                ) : null}
              </div>
              <div className="top-actions">
                <button className="btn primary" onClick={() => openModal(null)}>+ Add Project</button>
                {menu}
              </div>
            </div>
          </header>

          <main className="wrap">
            {tab === "projects" ? (
              <ProjectsView
                projects={projects} filtered={filtered} q={q} setQ={setQ}
                fWork={fWork} setFWork={setFWork} fPay={fPay} setFPay={setFPay}
                sort={sort} toggleSort={toggleSort} onRow={openModal} onAdd={() => openModal(null)}
                onImport={triggerImport} onQuickWork={quickWork}
              />
            ) : tab === "pipeline" ? (
              <PipelineBoard
                projects={projects}
                onBoardChange={saveBoard}
                onOpen={openModal}
                showToast={showToast}
              />
            ) : (
              <AnalyticsView projects={projects} events={events} payments={payments} onAddPayments={addPayments} onDeletePayment={deletePayment} />
            )}
          </main>
        </div>
      </div>

      {editing && (
        <EditModal
          form={form} setField={setField} isEdit={!!(editing && editing.id)}
          onClose={closeModal} onSave={saveForm} onDelete={deleteCurrent} delConfirm={delConfirm}
        />
      )}

      {expired && (
        <div className="session-bar" role="alert">
          <span>Your session expired, so edits will not save. Nothing was lost.</span>
          <a className="btn primary" href="/login">Log back in</a>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}><span className="dot" />{toast}</div>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFile} />
    </>
  );

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }
}

// Brand text that fades with the rail.
function SideLabel({ children }) {
  const { open, animate } = useSidebar();
  return (
    <motion.span
      animate={{ opacity: animate ? (open ? 1 : 0) : 1 }}
      transition={{ duration: 0.18 }}
      className="text-[14px] font-bold tracking-tight whitespace-nowrap"
    >
      {children}
    </motion.span>
  );
}

// ---------- Projects table ----------
function ProjectsView({ projects, filtered, q, setQ, fWork, setFWork, fPay, setFPay, sort, toggleSort, onRow, onAdd, onImport, onQuickWork }) {
  const totalMrr = filtered.reduce((s, p) => s + liveMrr(p), 0);
  const th = (key, label, opts = {}) => (
    <th
      className={(opts.sortable === false ? "" : "sortable ") + (opts.hideSm ? "hide-sm" : "")}
      style={opts.align === "right" ? { textAlign: "right" } : undefined}
      onClick={opts.sortable === false ? undefined : () => toggleSort(key)}
    >
      {label}
      {sort.key === key && opts.sortable !== false ? <span className="arrow">{sort.dir > 0 ? "▲" : "▼"}</span> : null}
    </th>
  );

  return (
    <section className="view">
      <div className="filters">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, project, or partner…" />
        </div>
        <select value={fWork} onChange={(e) => setFWork(e.target.value)}>
          <option value="">All stages</option>
          {WORK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fPay} onChange={(e) => setFPay(e.target.value)}>
          <option value="">All payment</option>
          {["Unpaid", "Partially paid", "Paid in full"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="count-note">
          {projects.length ? `${filtered.length} of ${projects.length} project${projects.length === 1 ? "" : "s"}` : ""}
          {totalMrr > 0 ? <span className="mrr-total">{money(totalMrr)}/mo recurring</span> : null}
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>Add your first client, or import the JSON backup from your old dashboard to bring everything into the database in one click.</p>
          <div className="row">
            <button className="btn primary" onClick={onAdd}>+ Add your first project</button>
            <button className="btn" onClick={onImport}>Import JSON backup</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty"><p>No projects match your filters.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {th("client", "Client / Project")}
                {th("deal", "Deal", { align: "right" })}
                {th("paid", "Collected", { align: "right", hideSm: true })}
                {th("out", "Outstanding", { align: "right", hideSm: true })}
                {th("work", "Stage")}
                {th("age", "In stage", { hideSm: true })}
                {th("mrr", "MRR", { align: "right" })}
                {th("refby", "Referred by", { sortable: false, hideSm: true })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => <Row key={p.id} p={p} onRow={onRow} onQuickWork={onQuickWork} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Badge({ text, color }) {
  return (
    <span className="badge" style={{ background: hexA(color, 0.14), color }}>
      <span className="dot" style={{ background: color }} />{text}
    </span>
  );
}

function Row({ p, onRow, onQuickWork }) {
  const o = outstanding(p);
  const m = liveMrr(p);
  return (
    <tr onClick={() => onRow(p)}>
      <td>
        <div className="cell-client">
          {p.client || "(no name)"}
          {p.live ? (
            <a className="cell-live" href={p.live} target="_blank" rel="noopener noreferrer"
               title={p.live.replace(/^https?:\/\//, "")} onClick={(e) => e.stopPropagation()}>↗</a>
          ) : null}
        </div>
        {(p.project || p.niche) && <div className="cell-sub">{[p.project, p.niche].filter(Boolean).join(" · ")}</div>}
      </td>
      <td className="num">{num(p.deal) > 0 ? money(p.deal) : "—"}</td>
      <td className="num hide-sm" style={{ color: num(p.paid) > 0 ? "var(--green)" : "var(--faint)" }}>{num(p.paid) > 0 ? money(p.paid) : "—"}</td>
      <td className="num hide-sm" style={{ color: o > 0 ? "var(--amber)" : "var(--faint)" }}>{o > 0 ? money(o) : "—"}</td>
      <WorkCell p={p} onQuickWork={onQuickWork} />
      <AgeCell p={p} />
      <td className="num" style={{ color: m > 0 ? "var(--green)" : "var(--faint)" }}>
        {m > 0 ? money(m) + "/mo" : "—"}
      </td>
      <td className="hide-sm" style={{ color: p.refby ? undefined : "var(--faint)" }}>{p.refby || "—"}</td>
      <td className="row-actions">
        <button className="icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); onRow(p); }}>&#9998;</button>
      </td>
    </tr>
  );
}

// Days the project has sat in its current stage. Goes amber past the stage's
// normal window, red past double it. Finished stages never age.
function AgeCell({ p }) {
  const d = daysInStage(p);
  const h = stageHealth(p);
  if (!h || d == null) return <td className="hide-sm" style={{ color: "var(--faint)" }}>—</td>;
  return (
    <td className="hide-sm age-cell" style={{ color: HEALTH_COLOR[h], fontWeight: h === "ok" ? 400 : 600 }}>
      {d === 0 ? "today" : d + "d"}
      {h === "stale" ? " ⚠" : ""}
    </td>
  );
}

// ---------- Inline phase (work status) dropdown ----------
function WorkCell({ p, onQuickWork }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onMove() { setOpen(false); } // close on scroll/resize so fixed coords never go stale
    document.addEventListener("click", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("click", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    const menuH = WORK_STATUSES.length * 33 + 12;
    const roomBelow = window.innerHeight - r.bottom;
    const openUp = roomBelow < menuH + 12 && r.top > roomBelow;
    setPos({ left: r.left, top: openUp ? Math.max(8, r.top - menuH - 6) : r.bottom + 6 });
    setOpen(true);
  }

  function pick(e, s) {
    e.stopPropagation();
    setOpen(false);
    onQuickWork(p, s);
  }

  const color = WORK_COLORS[p.work] || "#8b909b";
  return (
    <td onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className="work-trigger" onClick={toggle} title="Change phase">
        <Badge text={p.work} color={color} />
        <span className="work-caret">▾</span>
      </button>
      {open && (
        <div ref={menuRef} className="work-menu" style={{ left: pos.left, top: pos.top }}>
          {WORK_STATUSES.map((s) => (
            <button key={s} type="button" className={"work-opt" + (s === p.work ? " active" : "")} onClick={(e) => pick(e, s)}>
              <span className="work-swatch" style={{ background: WORK_COLORS[s] || "#8b909b" }} />
              {s}
              {s === p.work && <span className="work-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </td>
  );
}

// ---------- Edit modal ----------
function EditModal({ form, setField, isEdit, onClose, onSave, onDelete, delConfirm }) {
  const inp = (k, label, opts = {}) => (
    <div className={"field" + (opts.full ? " full" : "")}>
      <label>{label}{opts.hint ? <span className="hint"> {opts.hint}</span> : null}</label>
      {opts.textarea ? (
        <textarea value={form[k]} onChange={(e) => setField(k, e.target.value)} placeholder={opts.ph || ""} />
      ) : (
        <input type={opts.type || "text"} value={form[k]} onChange={(e) => setField(k, e.target.value)} placeholder={opts.ph || ""} min={opts.type === "number" ? "0" : undefined} />
      )}
    </div>
  );

  const ps = payStatus(form);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isEdit ? "Edit Project" : "Add Project"}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            {inp("client", "Client name *", { ph: "Acme Med Spa" })}
            {inp("project", "Project / site name", { ph: "Website redesign" })}
            {inp("live", "Live URL", { ph: "https://client.com" })}
            {inp("staging", "Staging / repo URL", { ph: "https://staging.vercel.app" })}
            {inp("niche", "Niche / type", { ph: "Med spa" })}
            <div className="field">
              <label>Stage<span className="hint"> {STAGE_HINTS[normStage(form.work)]}</span></label>
              <select value={form.work} onChange={(e) => setField("work", e.target.value)}>
                {WORK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {isLost(form.work) && inp("lostReason", "Why it was lost", { ph: "Price, went with someone else, ghosted…" })}
            <div className="field">
              <label>Income type<span className="hint"> contractor pay is kept out of client metrics</span></label>
              <select value={form.incomeType || "client"} onChange={(e) => setField("incomeType", e.target.value)}>
                <option value="client">Client work</option>
                <option value="contractor">Contractor income</option>
              </select>
            </div>
            {inp("deal", "Deal value ($)", { type: "number", ph: "8000" })}
            {inp("paid", "Amount collected ($)", { type: "number", ph: "4000" })}
            {inp("mrr", "Monthly recurring ($)", { type: "number", ph: "150", hint: "counts once the stage is Complete or Recurring" })}
            {inp("refby", "Referred by", { ph: "Partner name" })}
            {inp("refpct", "Referral %", { type: "number", ph: "10" })}
            <div className="field inline-check">
              <input type="checkbox" id="refpaid" checked={!!form.refpaid} onChange={(e) => setField("refpaid", e.target.checked)} />
              <label htmlFor="refpaid" style={{ color: "var(--text)" }}>Referral paid out</label>
            </div>
            {inp("start", "Start date", { type: "date" })}
            {inp("due", "Finished date", { type: "date" })}
            {inp("launch", "Launch date", { type: "date" })}
            {inp("notes", "Notes", { full: true, textarea: true, ph: "Anything worth remembering…" })}
          </div>
          <div className="derived">
            {isEdit && daysInStage(form) != null && stageHealth(form) && (
              <div className="d">
                <div className="dl">Time in stage</div>
                <div className="dv" style={{ color: HEALTH_COLOR[stageHealth(form)] }}>
                  {daysInStage(form)} day{daysInStage(form) === 1 ? "" : "s"}
                </div>
              </div>
            )}
            <div className="d"><div className="dl">Payment status</div><div className="dv" style={{ color: payColor(ps) }}>{ps}</div></div>
            <div className="d"><div className="dl">Outstanding</div><div className="dv" style={{ color: outstanding(form) > 0 ? "var(--amber)" : "var(--green)" }}>{money(outstanding(form))}</div></div>
            {(form.refby || num(form.refpct) > 0) && (
              <div className="d"><div className="dl">Referral owed</div><div className="dv" style={{ color: form.refpaid ? "var(--green)" : "var(--purple)" }}>{money(refOwed(form))}{form.refpaid ? " (paid)" : ""}</div></div>
            )}
            {num(form.mrr) > 0 && (
              <div className="d">
                <div className="dl">Monthly recurring</div>
                <div className="dv" style={{ color: isDone(form) ? "var(--green)" : "var(--muted)" }}>
                  {money(num(form.mrr))}{isDone(form) ? "" : " (starts at Complete / Recurring)"}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          {isEdit && <button className="btn danger" onClick={onDelete}>{delConfirm ? "Click again to confirm" : "Delete"}</button>}
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onSave}>Save Project</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Analytics ----------
// One question this page has to answer: am I on track for $10k a month, and
// what is blocking it. Everything below serves that.
function AnalyticsView({ projects, events, payments, onAddPayments, onDeletePayment }) {
  const a = useMemo(() => {
    // Client work only. Contractor paychecks are real income but they are not
    // the business, and mixing them hides what the business is actually doing.
    const clients = projects.filter(isClient);
    const contractors = projects.filter((p) => !isClient(p));

    let collected = 0, outstandingT = 0, pipeline = 0, mrr = 0, refOwedT = 0,
        active = 0, launched = 0, recurringCount = 0, lostCount = 0, lostValue = 0;
    clients.forEach((p) => {
      collected += num(p.paid);
      const done = isDone(p), dead = isDead(p);
      // Only money for work that is actually sold. An unsigned $9k lead is
      // pipeline, not accounts receivable.
      if (!dead && (num(p.paid) > 0 || stageIndex(p.work) >= stageIndex("In Progress"))) {
        outstandingT += outstanding(p);
      }
      if (!done && !dead) pipeline += Math.max(num(p.deal) - num(p.paid), 0);
      mrr += liveMrr(p);
      if (!dead) refOwedT += refOwed(p);
      if (!done && !dead) active++;
      if (done) launched++;
      if (dead) { lostCount++; lostValue += num(p.deal); }
      if (isRecurring(p) && num(p.mrr) > 0) recurringCount++;
    });
    const contractorMrr = contractors.reduce((s, p) => s + liveMrr(p), 0);
    const contractorCollected = contractors.reduce((s, p) => s + num(p.paid), 0);

    const decided = launched + lostCount;
    const winRate = decided ? Math.round((launched / decided) * 100) : null;

    // --- run rate toward $10k -------------------------------------------------
    // One-time revenue has no payment dates, so it is averaged over the window
    // of project dates we do have. Undated money is reported, never guessed.
    const dated = [], undatedPaid = [];
    clients.forEach((p) => {
      if (num(p.paid) <= 0) return;
      const d = parseDate(p.launch || p.due || p.start);
      if (d) dated.push({ d, v: num(p.paid) }); else undatedPaid.push(num(p.paid));
    });
    const undatedTotal = undatedPaid.reduce((s, v) => s + v, 0);
    let spanMonths = 0, datedTotal = 0;
    if (dated.length) {
      const first = dated.reduce((m, x) => (x.d < m ? x.d : m), dated[0].d);
      const t = today();
      spanMonths = Math.max(1, (t.getFullYear() - first.getFullYear()) * 12 + (t.getMonth() - first.getMonth()) + 1);
      datedTotal = dated.reduce((s, x) => s + x.v, 0);
    }
    const oneTimePerMonth = spanMonths ? datedTotal / spanMonths : 0;
    const clientRunRate = mrr + oneTimePerMonth;
    const totalRunRate = clientRunRate + contractorMrr;
    const gap = Math.max(0, MONTHLY_TARGET - totalRunRate);

    // --- deal size vs the floor ----------------------------------------------
    const paidDeals = clients.filter((p) => num(p.paid) > 0);
    const avgDeal = paidDeals.length ? collected / paidDeals.length : 0;
    const belowFloor = paidDeals.filter((p) => num(p.paid) < DEAL_FLOOR).length;
    const biggest = paidDeals.reduce((m, p) => Math.max(m, num(p.paid)), 0);

    // --- retainer attach rate -------------------------------------------------
    const shipped = clients.filter(isDone);
    const withRetainer = shipped.filter((p) => num(p.mrr) > 0);
    const attachRate = shipped.length ? Math.round((withRetainer.length / shipped.length) * 100) : null;
    const noRetainer = shipped.filter((p) => num(p.mrr) <= 0);
    // What closing that gap is worth at the real retainer prices.
    const attachUpside = noRetainer.length * RETAINER_TIERS[0];

    // --- acquisition funnel ---------------------------------------------------
    // Furthest stage each project has ever reached: its event history plus
    // wherever it sits now. Reaching a stage counts even if it later died.
    // Lost sits last in the stage list but is not "further" than anything, so it
    // never seeds this. A dead deal still counts in every stage it passed through,
    // which is the whole point of a conversion rate.
    const furthest = {};
    clients.forEach((p) => (furthest[p.id] = isLost(p.work) ? -1 : stageIndex(p.work)));
    (events || []).forEach((e) => {
      if (!(e.projectId in furthest) || isLost(e.to)) return;
      const i = stageIndex(e.to);
      if (i > furthest[e.projectId]) furthest[e.projectId] = i;
    });
    // A lost deal with no recorded history was still a lead once.
    Object.keys(furthest).forEach((k) => { if (furthest[k] < 0) furthest[k] = 0; });

    const wonIdx = stageIndex("Complete");
    const funnel = FUNNEL.map((stage, i) => ({
      stage,
      reached: clients.filter((p) => furthest[p.id] >= stageIndex(stage)).length,
      next: FUNNEL[i + 1] || "Won",
    }));
    funnel.push({ stage: "Won", reached: clients.filter((p) => furthest[p.id] >= wonIdx).length, next: null });

    // --- pipeline coverage ----------------------------------------------------
    // Standard sales health check: open new-business value against the target.
    // Under 3x means the month after next is already thin.
    const newBiz = clients.filter((p) => isOpen(p.work) && stageIndex(p.work) <= stageIndex("Proposal"));
    const newBizValue = newBiz.reduce((s, p) => s + num(p.deal), 0);
    const coverage = MONTHLY_TARGET > 0 ? newBizValue / MONTHLY_TARGET : 0;

    // --- data quality ---------------------------------------------------------
    const noDeal = clients.filter((p) => num(p.deal) <= 0).length;
    const noDates = clients.filter((p) => !p.launch && !p.due && !p.start).length;

    // collected by project date (NOT payment date — labelled as such)
    const byMonth = {};
    clients.forEach((p) => {
      if (num(p.paid) <= 0) return;
      const d = parseDate(p.launch || p.due || p.start); if (!d) return;
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      byMonth[key] = (byMonth[key] || 0) + num(p.paid);
    });
    const monthKeys = Object.keys(byMonth).sort().slice(-8);

    const t = today();
    const due = clients.filter((p) => { const d = parseDate(p.due); if (!d) return false; if (isDone(p) || isDead(p)) return false; const dl = daysBetween(d, t); return dl >= 0 && dl <= 30; }).sort((x, y) => (x.due < y.due ? -1 : 1));
    const over = clients.filter((p) => { const d = parseDate(p.due); if (!d) return false; if (isDone(p) || isDead(p)) return false; return daysBetween(d, t) < 0; }).sort((x, y) => (x.due < y.due ? -1 : 1));
    const stuck = clients.filter((p) => stageHealth(p) === "stale").sort((x, y) => (daysInStage(y) || 0) - (daysInStage(x) || 0));

    const counts = {}; STAGES.forEach((st) => (counts[st] = 0));
    clients.forEach((p) => { counts[normStage(p.work)] = (counts[normStage(p.work)] || 0) + 1; });

    const pmap = {};
    clients.forEach((p) => {
      if (!p.refby) return;
      if (!pmap[p.refby]) pmap[p.refby] = { count: 0, oneTime: 0, recurring: 0, mrr: 0, owed: 0 };
      pmap[p.refby].count++;
      pmap[p.refby].oneTime += num(p.paid);
      pmap[p.refby].recurring += recurringCollected(p);
      pmap[p.refby].mrr += liveMrr(p);
      pmap[p.refby].owed += refOwed(p);
    });
    const partners = Object.keys(pmap)
      .map((k) => ({ name: k, ...pmap[k], collected: pmap[k].oneTime + pmap[k].recurring }))
      .sort((x, y) => y.collected - x.collected);

    return {
      clients, collected, outstandingT, pipeline, mrr, contractorMrr, contractorCollected,
      refOwedT, active, launched, recurringCount, lostCount, lostValue, winRate,
      oneTimePerMonth, spanMonths, clientRunRate, totalRunRate, gap, undatedTotal,
      avgDeal, belowFloor, paidCount: paidDeals.length, biggest,
      attachRate, withRetainer, noRetainer, attachUpside, shippedCount: shipped.length,
      funnel, newBizValue, newBizCount: newBiz.length, coverage,
      noDeal, noDates, byMonth, monthKeys, counts, due, over, stuck, partners,
      undatedReal: undatedCash(projects, payments).reduce((s, x) => s + x.amount, 0),
    };
  }, [projects, events, payments]);

  const maxMonth = Math.max(1, ...a.monthKeys.map((k) => a.byMonth[k]));
  const maxStatus = Math.max(1, ...STAGES.map((s) => a.counts[s]));
  const t = today();

  return (
    <section className="view">
      <RevenueView projects={projects} payments={payments} onAdd={onAddPayments} onDelete={onDeletePayment} />

      <div className="section-title">Pipeline health</div>

      <div className="grid-2">
        {/* ---- deal size vs the floor ---- */}
        <div className="card">
          <h4>Average collected deal <span className="pill">floor {money(DEAL_FLOOR)}</span></h4>
          <div className="gauge">
            <div className="gauge-val" style={{ color: a.avgDeal >= DEAL_FLOOR ? "var(--green)" : "var(--amber)" }}>
              {money(a.avgDeal)}
            </div>
            <div className="gauge-track">
              <div className="gauge-fill" style={{
                width: Math.min(100, (a.avgDeal / (DEAL_FLOOR * 1.6)) * 100) + "%",
                background: a.avgDeal >= DEAL_FLOOR ? "var(--green)" : "var(--amber)",
              }} />
              <div className="gauge-mark" style={{ left: (1 / 1.6) * 100 + "%" }}><span>{money(DEAL_FLOOR)}</span></div>
            </div>
          </div>
          <div className="mini-rows">
            <div className="mini"><span>Paying clients</span><b>{a.paidCount}</b></div>
            <div className="mini"><span>Below your floor</span><b style={{ color: a.belowFloor ? "var(--amber)" : "var(--green)" }}>{a.belowFloor} of {a.paidCount}</b></div>
            <div className="mini"><span>Biggest deal</span><b>{money(a.biggest)}</b></div>
          </div>
        </div>

        {/* ---- retainer attach ---- */}
        <div className="card">
          <h4>Retainer attach rate <span className="pill">shipped clients on a retainer</span></h4>
          <div className="gauge">
            <div className="gauge-val" style={{ color: a.attachRate >= 60 ? "var(--green)" : "var(--amber)" }}>
              {a.attachRate == null ? "—" : a.attachRate + "%"}
            </div>
            <div className="gauge-track">
              <div className="gauge-fill" style={{ width: (a.attachRate || 0) + "%", background: a.attachRate >= 60 ? "var(--green)" : "var(--amber)" }} />
            </div>
          </div>
          <div className="mini-rows">
            <div className="mini"><span>On a retainer</span><b>{a.withRetainer.length} of {a.shippedCount}</b></div>
            <div className="mini"><span>Worth if all attached</span><b style={{ color: "var(--green)" }}>+{money(a.attachUpside)}/mo</b></div>
          </div>
          {a.noRetainer.length > 0 && (
            <div className="chip-list">
              {a.noRetainer.slice(0, 10).map((p) => <span className="chip" key={p.id}>{p.client}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        {/* ---- funnel ---- */}
        <div className="card">
          <h4>Acquisition funnel <span className="pill">furthest stage ever reached</span></h4>
          {a.funnel[0].reached === 0 ? (
            <div className="li-empty">No leads logged yet.</div>
          ) : (
            a.funnel.map((f, i) => {
              const prev = i > 0 ? a.funnel[i - 1].reached : null;
              const conv = prev ? Math.round((f.reached / prev) * 100) : null;
              return (
                <div className="funnel-row" key={f.stage}>
                  <div className="fn-name">{f.stage}</div>
                  <div className="fn-track">
                    <div className="fn-fill" style={{
                      width: Math.max(3, (f.reached / a.funnel[0].reached) * 100) + "%",
                      background: STAGE_COLORS[f.stage] || "var(--green)",
                    }} />
                  </div>
                  <div className="fn-n">{f.reached}</div>
                  <div className="fn-conv" style={{ color: conv == null ? "var(--faint)" : conv >= 50 ? "var(--green)" : "var(--amber)" }}>
                    {conv == null ? "" : conv + "%"}
                  </div>
                </div>
              );
            })
          )}
          <div className="card-note">Conversion sharpens as you move cards. Every drag is logged from here on.</div>
        </div>

        {/* ---- coverage ---- */}
        <div className="card">
          <h4>Pipeline coverage <span className="pill">healthy is 3x target</span></h4>
          <div className="gauge">
            <div className="gauge-val" style={{ color: a.coverage >= 3 ? "var(--green)" : a.coverage >= 1 ? "var(--amber)" : "var(--red)" }}>
              {a.coverage.toFixed(1)}x
            </div>
            <div className="gauge-track">
              <div className="gauge-fill" style={{
                width: Math.min(100, (a.coverage / 3) * 100) + "%",
                background: a.coverage >= 3 ? "var(--green)" : a.coverage >= 1 ? "var(--amber)" : "var(--red)",
              }} />
            </div>
          </div>
          <div className="mini-rows">
            <div className="mini"><span>Open new business</span><b>{money(a.newBizValue)}</b></div>
            <div className="mini"><span>Deals before In Progress</span><b>{a.newBizCount}</b></div>
            <div className="mini"><span>Needed for 3x</span><b style={{ color: "var(--amber)" }}>{money(Math.max(0, MONTHLY_TARGET * 3 - a.newBizValue))} more</b></div>
          </div>
        </div>
      </div>

      {/* ---- supporting numbers ---- */}
      <div className="kpi-grid">
        {[
          { label: "Collected (clients)", val: money(a.collected), cls: "green", sub: `${a.clients.length} client projects` },
          { label: "Client retainers / mo", val: money(a.mrr), cls: "green", sub: `${a.recurringCount} on retainer` },
          { label: "Contractor income / mo", val: money(a.contractorMrr), cls: "purple", sub: "not client revenue" },
          { label: "Outstanding", val: money(a.outstandingT), cls: "amber", sub: "on sold work only" },
          { label: "Win rate", val: a.winRate == null ? "—" : a.winRate + "%", cls: a.winRate != null && a.winRate >= 50 ? "green" : "amber", sub: `${a.launched} won · ${a.lostCount} lost` },
          { label: "Referral owed", val: money(a.refOwedT), cls: a.refOwedT > 0 ? "purple" : "", sub: "to partners (unpaid)" },
        ].map((k) => (
          <div className="kpi" key={k.label}>
            <div className="label">{k.label}</div>
            <div className={"val " + k.cls}>{k.val}</div>
            <div className="sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="gaps-row">
        <div className="card">
          <h4>Data gaps <span className="pill">what's making these numbers soft</span></h4>
          <div className="mini-rows cols-2">
            <div className="mini"><span>Clients with no deal value</span><b style={{ color: a.noDeal ? "var(--amber)" : "var(--green)" }}>{a.noDeal}</b></div>
            <div className="mini"><span>Clients with no dates at all</span><b style={{ color: a.noDates ? "var(--amber)" : "var(--green)" }}>{a.noDates}</b></div>
            <div className="mini"><span>Collected cash with no payment date</span><b style={{ color: a.undatedReal ? "var(--amber)" : "var(--green)" }}>{money(a.undatedReal)}</b></div>
            <div className="mini"><span>Deals ever marked Lost</span><b style={{ color: a.lostCount ? "var(--green)" : "var(--amber)" }}>{a.lostCount}</b></div>
          </div>
          <div className="card-note">
            {a.lostCount === 0
              ? "Win rate stays fake until dead leads get dragged to Lost."
              : "Fill the gaps above and every number on this page gets sharper."}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Stuck in stage <span className="pill">past 2x the normal window</span></h4>
          <ListBlock items={a.stuck} empty="Nothing is stalling. Good." render={(p) => ({
            name: p.client, sub: `${normStage(p.work)}${p.project ? " · " + p.project : ""}`,
            right: daysInStage(p) + "d", color: "var(--red)",
          })} />
        </div>
        <div className="card">
          <h4>Overdue <span className="pill">past due, not launched</span></h4>
          <ListBlock items={a.over} empty="Nothing overdue. Nice." render={(p) => { const dl = -daysBetween(parseDate(p.due), t); return { name: p.client, sub: p.project || p.work, right: dl + "d late", color: "var(--red)" }; }} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Pipeline by stage</h4>
          {a.clients.length === 0 ? <div className="li-empty">No projects yet.</div> : STAGES.map((s) => (
            <div className="sbar-row" key={s}>
              <div className="nm">{s}</div>
              <div className="sbar-track"><div className="sbar-fill" style={{ width: (a.counts[s] / maxStatus * 100) + "%", background: STAGE_COLORS[s] }} /></div>
              <div className="ct">{a.counts[s]}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <h4>Top referral partners</h4>
          <ListBlock items={a.partners} empty="No referral partners logged yet." render={(x) => ({
            name: x.name,
            sub: `${x.count} referral${x.count === 1 ? "" : "s"} · ${money(x.collected)} collected`,
            right: x.owed > 0 ? money(x.owed) + " owed" : (x.mrr > 0 ? money(x.mrr) + "/mo" : "—"),
            color: x.owed > 0 ? "var(--purple)" : (x.mrr > 0 ? "var(--green)" : "var(--faint)"),
          })} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Why deals were lost</h4>
          <ListBlock items={a.clients.filter(isDead).sort((x, y) => num(y.deal) - num(x.deal))} empty="No lost deals logged."
            render={(p) => ({ name: p.client, sub: p.lostReason || "No reason recorded", right: num(p.deal) > 0 ? money(num(p.deal)) : "—", color: "var(--faint)" })} />
        </div>
        <div className="card">
          <h4>Due soon <span className="pill">next 30 days</span></h4>
          <ListBlock items={a.due} empty="Nothing due in the next 30 days." render={(p) => { const dl = daysBetween(parseDate(p.due), t); return { name: p.client, sub: p.project || p.work, right: dl === 0 ? "today" : dl + "d", color: dl <= 7 ? "var(--amber)" : "var(--muted)" }; }} />
        </div>
      </div>
    </section>
  );
}

// Stacked bar: each income source as its own segment against the target.
function RunRateBar({ segments, target }) {
  const total = segments.reduce((s, x) => s + x.val, 0);
  const scale = Math.max(target, total);
  return (
    <>
      <div className="rr-track">
        {segments.filter((s) => s.val > 0).map((s) => (
          <div key={s.label} className="rr-seg" style={{ width: (s.val / scale) * 100 + "%", background: s.color }} title={`${s.label}: ${money(s.val)}`} />
        ))}
        {total > target && <div className="rr-target" style={{ left: (target / scale) * 100 + "%" }} />}
      </div>
      <div className="rr-legend">
        {segments.map((s) => (
          <span key={s.label} className="rr-key">
            <i style={{ background: s.color }} />{s.label} <b>{money(s.val)}</b>
          </span>
        ))}
      </div>
    </>
  );
}

function ListBlock({ items, empty, render }) {
  if (!items.length) return <div className="li-empty">{empty}</div>;
  return items.map((it, i) => {
    const m = render(it);
    return (
      <div className="list-item" key={i}>
        <div className="li-main">
          <div className="li-name">{m.name}</div>
          {m.sub && <div className="li-sub">{m.sub}</div>}
        </div>
        <div className="li-right" style={{ color: m.color }}>{m.right}</div>
      </div>
    );
  });
}
