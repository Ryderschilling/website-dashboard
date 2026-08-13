"use client";
import { useState, useEffect, useMemo, useRef } from "react";

const WORK_STATUSES = ["Lead", "In Progress", "In Review", "Complete"];
const WORK_COLORS = {
  Lead: "#8b909b", "In Progress": "#58a6ff", "In Review": "#bc8cff", Complete: "#3fb950",
};
// legacy phases from the old 7-status list, folded into the 4 that remain
const LEGACY_WORK = { "Payment Pending": "In Progress", "On Hold": "In Progress", Launched: "Complete" };
const normWork = (w) => (WORK_STATUSES.includes(w) ? w : LEGACY_WORK[w] || "Lead");
const normProject = (p) => ({ ...p, work: normWork(p.work) });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---- helpers ----
const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const outstanding = (p) => Math.max(0, num(p.deal) - num(p.paid));
const refOwed = (p) => (p.refpaid ? 0 : (num(p.paid) * num(p.refpct)) / 100);
const isDone = (p) => normWork(p.work) === "Complete";
// MRR only counts once the job is Complete and the retainer is actually billing
const liveMrr = (p) => (isDone(p) ? num(p.mrr) : 0);
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
  start: "", due: "", launch: "", notes: "",
};

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("projects");
  const [q, setQ] = useState("");
  const [fWork, setFWork] = useState("");
  const [fPay, setFPay] = useState("");
  const [sort, setSort] = useState({ key: "mrr", dir: -1 });
  const [editing, setEditing] = useState(null); // null=closed, {}=new, {..}=edit
  const [form, setForm] = useState(BLANK);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
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

  async function refresh() {
    try {
      const res = await fetch("/api/projects");
      if (res.status === 401) { window.location.href = "/login"; return; }
      const d = await res.json();
      setProjects((d.projects || []).map(normProject));
    } catch (e) { showToast("⚠ Could not reach the database"); }
    setLoading(false);
  }
  function showToast(m) { setToast(m); clearTimeout(showToast._t); showToast._t = setTimeout(() => setToast(""), 2400); }

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
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("save failed");
      const d = await res.json();
      const saved = normProject(d.project);
      setProjects((list) => {
        const i = list.findIndex((x) => x.id === saved.id);
        if (i >= 0) { const c = list.slice(); c[i] = saved; return c; }
        return [...list, saved];
      });
      closeModal();
      showToast(isEdit ? "Project updated" : "Project added");
    } catch (e) { showToast("⚠ Save failed — check your connection"); }
  }

  async function deleteCurrent() {
    if (!delConfirm) { setDelConfirm(true); setTimeout(() => setDelConfirm(false), 3000); return; }
    const id = editing.id;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setProjects((list) => list.filter((x) => x.id !== id));
      closeModal();
      showToast("Project deleted");
    } catch (e) { showToast("⚠ Delete failed"); }
  }

  // ---- inline quick phase change ----
  async function quickWork(p, newWork) {
    if (!newWork || newWork === p.work) return;
    const prev = projects;
    setProjects((list) => list.map((x) => (x.id === p.id ? { ...x, work: newWork } : x)));
    try {
      const res = await fetch(`/api/projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, work: newWork }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = await res.json();
      const saved = normProject(d.project);
      setProjects((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      showToast("Phase updated");
    } catch (e) {
      setProjects(prev);
      showToast("⚠ Could not update phase");
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
      if (!Array.isArray(list)) throw new Error();
      const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setProjects((d.projects || []).map(normProject));
      showToast(`Imported ${d.imported} projects into the database`);
    } catch (err) { showToast("⚠ Invalid backup file"); }
    e.target.value = "";
  }

  // ---- derived: filtered + sorted ----
  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    let list = projects.filter((p) => {
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
        case "work": av = WORK_STATUSES.indexOf(a.work); bv = WORK_STATUSES.indexOf(b.work); break;
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

  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <div className="brand"><span className="logo">R</span> Ryder Schilling <span className="dim">· Clients</span></div>
          <nav className="tabs">
            <button className={"tab" + (tab === "projects" ? " active" : "")} onClick={() => setTab("projects")}>Projects</button>
            <button className={"tab" + (tab === "analytics" ? " active" : "")} onClick={() => setTab("analytics")}>Analytics</button>
          </nav>
          <div className="top-actions">
            <button className="btn primary" onClick={() => openModal(null)}>+ Add Project</button>
            <div className="menu">
              <button className="btn ghost" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>•••</button>
              <div className={"menu-list" + (menuOpen ? " open" : "")}>
                <button onClick={triggerImport}>Import (JSON backup)</button>
                <button onClick={backup}>Backup (JSON)</button>
                <button onClick={exportCsv}>Export CSV</button>
                <button onClick={logout} style={{ color: "var(--muted)" }}>Log out</button>
              </div>
            </div>
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
        ) : (
          <AnalyticsView projects={projects} />
        )}
      </main>

      {editing && (
        <EditModal
          form={form} setField={setField} isEdit={!!(editing && editing.id)}
          onClose={closeModal} onSave={saveForm} onDelete={deleteCurrent} delConfirm={delConfirm}
        />
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
          <option value="">All work status</option>
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
                {th("work", "Work")}
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
              <label>Work status</label>
              <select value={form.work} onChange={(e) => setField("work", e.target.value)}>
                {WORK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {inp("deal", "Deal value ($)", { type: "number", ph: "8000" })}
            {inp("paid", "Amount collected ($)", { type: "number", ph: "4000" })}
            {inp("mrr", "Monthly recurring ($)", { type: "number", ph: "150", hint: "counts once phase is Complete" })}
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
            <div className="d"><div className="dl">Payment status</div><div className="dv" style={{ color: payColor(ps) }}>{ps}</div></div>
            <div className="d"><div className="dl">Outstanding</div><div className="dv" style={{ color: outstanding(form) > 0 ? "var(--amber)" : "var(--green)" }}>{money(outstanding(form))}</div></div>
            {(form.refby || num(form.refpct) > 0) && (
              <div className="d"><div className="dl">Referral owed</div><div className="dv" style={{ color: form.refpaid ? "var(--green)" : "var(--purple)" }}>{money(refOwed(form))}{form.refpaid ? " (paid)" : ""}</div></div>
            )}
            {num(form.mrr) > 0 && (
              <div className="d">
                <div className="dl">Monthly recurring</div>
                <div className="dv" style={{ color: isDone(form) ? "var(--green)" : "var(--muted)" }}>
                  {money(num(form.mrr))}{isDone(form) ? "" : " (starts at Complete)"}
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
function AnalyticsView({ projects }) {
  const a = useMemo(() => {
    let collected = 0, outstandingT = 0, pipeline = 0, mrr = 0, refOwedT = 0, active = 0, launched = 0;
    projects.forEach((p) => {
      collected += num(p.paid);
      outstandingT += outstanding(p);
      const done = isDone(p);
      if (!done) pipeline += Math.max(num(p.deal) - num(p.paid), 0);
      mrr += liveMrr(p);
      refOwedT += refOwed(p);
      if (!done) active++;
      if (done) launched++;
    });
    // collected by month
    const byMonth = {};
    projects.forEach((p) => {
      if (num(p.paid) <= 0) return;
      const ds = p.launch || p.due || p.start; const d = parseDate(ds); if (!d) return;
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      byMonth[key] = (byMonth[key] || 0) + num(p.paid);
    });
    const monthKeys = Object.keys(byMonth).sort().slice(-8);
    const monthTotal = Object.keys(byMonth).reduce((s, k) => s + byMonth[k], 0);
    // status counts
    const counts = {}; WORK_STATUSES.forEach((s) => (counts[s] = 0));
    projects.forEach((p) => { const w = normWork(p.work); counts[w] = (counts[w] || 0) + 1; });
    // due / overdue
    const t = today();
    const due = projects.filter((p) => { const d = parseDate(p.due); if (!d) return false; if (isDone(p)) return false; const dl = daysBetween(d, t); return dl >= 0 && dl <= 30; }).sort((x, y) => (x.due < y.due ? -1 : 1));
    const over = projects.filter((p) => { const d = parseDate(p.due); if (!d) return false; if (isDone(p)) return false; return daysBetween(d, t) < 0; }).sort((x, y) => (x.due < y.due ? -1 : 1));
    // partners
    const pmap = {};
    projects.forEach((p) => { if (!p.refby) return; if (!pmap[p.refby]) pmap[p.refby] = { count: 0, collected: 0, owed: 0 }; pmap[p.refby].count++; pmap[p.refby].collected += num(p.paid); pmap[p.refby].owed += refOwed(p); });
    const partners = Object.keys(pmap).map((k) => ({ name: k, ...pmap[k] })).sort((x, y) => y.collected - x.collected);
    // recent launches
    const recent = projects.filter((p) => p.launch).sort((x, y) => (x.launch < y.launch ? 1 : -1)).slice(0, 6);
    return { collected, outstandingT, pipeline, mrr, refOwedT, active, launched, byMonth, monthKeys, monthTotal, counts, due, over, partners, recent };
  }, [projects]);

  const kpis = [
    { label: "Collected", val: money(a.collected), cls: "green", sub: `${projects.length} projects total` },
    { label: "Outstanding", val: money(a.outstandingT), cls: "amber", sub: "owed to you" },
    { label: "Active pipeline", val: money(a.pipeline), cls: "blue", sub: `${a.active} active project${a.active === 1 ? "" : "s"}` },
    { label: "Recurring / mo (MRR)", val: money(a.mrr), cls: "purple", sub: "complete jobs only" },
    { label: "Referral owed", val: money(a.refOwedT), cls: a.refOwedT > 0 ? "purple" : "", sub: "to partners (unpaid)" },
    { label: "Complete", val: String(a.launched), cls: "", sub: "jobs finished" },
  ];
  const maxMonth = Math.max(1, ...a.monthKeys.map((k) => a.byMonth[k]));
  const maxStatus = Math.max(1, ...WORK_STATUSES.map((s) => a.counts[s]));
  const t = today();

  return (
    <section className="view">
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="label">{k.label}</div>
            <div className={"val " + k.cls}>{k.val}</div>
            <div className="sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Collected revenue by month <span className="pill">{a.monthKeys.length ? money(a.monthTotal) + " dated" : "no dates yet"}</span></h4>
          {a.monthKeys.length === 0 ? (
            <div className="li-empty">Add launch/due dates to see revenue timing.</div>
          ) : (
            <div className="barchart">
              {a.monthKeys.map((k) => {
                const parts = k.split("-");
                return (
                  <div className="bar-col" key={k}>
                    <div className="bar" data-v={money(a.byMonth[k])} style={{ height: Math.max(2, (a.byMonth[k] / maxMonth) * 118) + "px" }} />
                    <div className="bar-lbl">{MONTHS[parseInt(parts[1], 10) - 1]} {parts[0].slice(2)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h4>Work status breakdown</h4>
          {projects.length === 0 ? <div className="li-empty">No projects yet.</div> : WORK_STATUSES.map((s) => (
            <div className="sbar-row" key={s}>
              <div className="nm">{s}</div>
              <div className="sbar-track"><div className="sbar-fill" style={{ width: (a.counts[s] / maxStatus * 100) + "%", background: WORK_COLORS[s] }} /></div>
              <div className="ct">{a.counts[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Due soon <span className="pill">next 30 days</span></h4>
          <ListBlock items={a.due} empty="Nothing due in the next 30 days." render={(p) => { const dl = daysBetween(parseDate(p.due), t); return { name: p.client, sub: p.project || p.work, right: dl === 0 ? "today" : dl + "d", color: dl <= 7 ? "var(--amber)" : "var(--muted)" }; }} />
        </div>
        <div className="card">
          <h4>Overdue <span className="pill">past due, not launched</span></h4>
          <ListBlock items={a.over} empty="Nothing overdue. Nice." render={(p) => { const dl = -daysBetween(parseDate(p.due), t); return { name: p.client, sub: p.project || p.work, right: dl + "d late", color: "var(--red)" }; }} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Top referral partners</h4>
          <ListBlock items={a.partners} empty="No referral partners logged yet." render={(x) => ({ name: x.name, sub: `${x.count} referral${x.count === 1 ? "" : "s"} · ${money(x.collected)} collected`, right: x.owed > 0 ? money(x.owed) + " owed" : "—", color: x.owed > 0 ? "var(--purple)" : "var(--faint)" })} />
        </div>
        <div className="card">
          <h4>Recently launched</h4>
          <ListBlock items={a.recent} empty="No launches recorded yet." render={(p) => ({ name: p.client, sub: p.project || p.niche || "Launched", right: fmtDate(p.launch), color: "var(--green)" })} />
        </div>
      </div>
    </section>
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
