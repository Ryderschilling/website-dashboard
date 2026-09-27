"use client";
import { useMemo, useState } from "react";
import { isRecurring as stageIsRecurring, MONTHLY_TARGET, isClient } from "@/lib/pipeline";

// ---------------------------------------------------------------------------
// Money in, month by month. Every number here comes from a logged payment
// with a real date. Nothing is averaged into the chart, nothing is estimated,
// and a month with no payments stays empty. Averages live in their own card,
// labelled as side context.
// ---------------------------------------------------------------------------

export const KINDS = [
  { key: "build",      label: "Builds",     color: "var(--accent)" },
  { key: "retainer",   label: "Retainers",  color: "var(--green)" },
  { key: "contractor", label: "Contractor", color: "var(--purple)" },
  { key: "other",      label: "Other",      color: "var(--blue)" },
];
const KIND_LABEL = { build: "Build", retainer: "Retainer", contractor: "Contractor", other: "Other" };
const KIND_COLOR = Object.fromEntries(KINDS.map((k) => [k.key, k.color]));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const short = (n) => (n >= 10000 ? "$" + Math.round(n / 1000) + "k" : n >= 1000 ? "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : "$" + Math.round(n));
const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const keyOf = (iso) => (iso || "").slice(0, 7);
const addMonths = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
const labelShort = (key) => { const [y, m] = key.split("-"); return MONTHS[+m - 1] + " " + y.slice(2); };
const labelLong = (key) => { const [y, m] = key.split("-"); return MONTHS_LONG[+m - 1] + " " + y; };
const fmtDay = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return MONTHS[+m - 1] + " " + (+d) + ", " + y; };
const emptyBucket = () => ({ build: 0, retainer: 0, contractor: 0, other: 0, total: 0, count: 0 });

// Cash already counted in a project's "collected" total that has no payment
// row yet. It is real money with no date, so it sits outside every month
// until you give it one.
export function undatedCash(projects, payments) {
  const dated = {};
  (payments || []).forEach((p) => {
    if (!p.projectId || p.kind === "retainer") return;
    dated[p.projectId] = (dated[p.projectId] || 0) + num(p.amount);
  });
  return (projects || [])
    .map((p) => ({ p, amount: Math.round((num(p.paid) - (dated[p.id] || 0)) * 100) / 100 }))
    .filter((x) => x.amount >= 1)
    .sort((a, b) => b.amount - a.amount);
}

export default function RevenueView({ projects, payments, onAdd, onDelete }) {
  // Opens on the current month. "All time" is one click away.
  const [sel, setSel] = useState(() => keyOf(todayIso()));
  const [scaleToGoal, setScaleToGoal] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [recurOpen, setRecurOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const curKey = keyOf(todayIso());

  const r = useMemo(() => {
    const pays = (payments || []).filter((p) => p.date && num(p.amount) > 0);
    const byMonth = {};
    pays.forEach((p) => {
      const k = keyOf(p.date);
      if (!byMonth[k]) byMonth[k] = emptyBucket();
      const b = byMonth[k];
      b[p.kind in b ? p.kind : "other"] += num(p.amount);
      b.total += num(p.amount);
      b.count++;
    });
    const keys = Object.keys(byMonth).sort();
    // Every month from the first payment to now, empty ones included, so a
    // dead month shows up as a gap instead of quietly disappearing.
    let first = keys[0] || curKey;
    const last = keys.length && keys[keys.length - 1] > curKey ? keys[keys.length - 1] : curKey;
    if (addMonths(first, 23) < last) first = addMonths(last, -23);
    const range = [];
    for (let k = first; k <= last; k = addMonths(k, 1)) range.push(k);
    if (range.length < 6) { while (range.length < 6) range.unshift(addMonths(range[0], -1)); }

    // ---- averages (side context only) ----
    const firstRecord = keys[0] || null;
    const fullMonths = [];
    if (firstRecord) for (let k = firstRecord; k < curKey; k = addMonths(k, 1)) fullMonths.push(k);
    const fullTotals = fullMonths.map((k) => (byMonth[k] ? byMonth[k].total : 0));
    const avgFull = fullMonths.length ? fullTotals.reduce((s, v) => s + v, 0) / fullMonths.length : null;
    const last3 = fullMonths.slice(-3);
    const avg3 = last3.length ? last3.reduce((s, k) => s + (byMonth[k] ? byMonth[k].total : 0), 0) / last3.length : null;
    let best = null;
    keys.forEach((k) => { if (!best || byMonth[k].total > byMonth[best].total) best = k; });
    const allTotal = pays.reduce((s, p) => s + num(p.amount), 0);
    const avgPayment = pays.length ? allTotal / pays.length : null;
    const year = curKey.slice(0, 4);
    const ytd = pays.filter((p) => p.date.slice(0, 4) === year).reduce((s, p) => s + num(p.amount), 0);
    // Same point last month: only payments dated on or before today's day number.
    const dayNum = +todayIso().slice(8, 10);
    const prevKey = addMonths(curKey, -1);
    const prevSameDay = pays.filter((p) => keyOf(p.date) === prevKey && +p.date.slice(8, 10) <= dayNum).reduce((s, p) => s + num(p.amount), 0);

    return { pays, byMonth, range, fullMonths, avgFull, avg3, last3, best, allTotal, avgPayment, ytd, year, prevKey, prevSameDay };
  }, [payments, curKey]);

  const undated = useMemo(() => undatedCash(projects, payments), [projects, payments]);
  const undatedTotal = undated.reduce((s, x) => s + x.amount, 0);

  // Recurring money that should land this month and has not been logged yet.
  const recurDue = useMemo(() => {
    const logged = new Set(
      (payments || []).filter((p) => keyOf(p.date) === curKey && (p.kind === "retainer" || p.kind === "contractor")).map((p) => p.projectId)
    );
    return (projects || [])
      .filter((p) => stageIsRecurring(p.work) && num(p.mrr) > 0 && !logged.has(p.id))
      .map((p) => ({ p, kind: isClient(p) ? "retainer" : "contractor", amount: num(p.mrr) }));
  }, [projects, payments, curKey]);

  const isAll = sel === "all";
  const bucket = isAll
    ? r.pays.reduce((b, p) => { b[p.kind in b ? p.kind : "other"] += num(p.amount); b.total += num(p.amount); b.count++; return b; }, emptyBucket())
    : (r.byMonth[sel] || emptyBucket());
  const inProgress = sel === curKey;
  const ledger = (isAll ? r.pays : r.pays.filter((p) => keyOf(p.date) === sel));
  const shownLedger = showAll ? ledger : ledger.slice(0, 12);

  const maxMonth = Math.max(0, ...r.range.map((k) => (r.byMonth[k] ? r.byMonth[k].total : 0)));
  const scale = scaleToGoal ? Math.max(MONTHLY_TARGET, maxMonth) * 1.08 : Math.max(1, maxMonth) * 1.15;
  const goalPct = (MONTHLY_TARGET / scale) * 100;
  const chipKeys = r.range.slice().reverse().filter((k) => k <= curKey || r.byMonth[k]);

  const vsAvg = !isAll && r.avgFull != null && !inProgress ? bucket.total - r.avgFull : null;

  return (
    <div className="rev">
      {/* ---- period filter ---- */}
      <div className="rev-bar">
        <div className="rev-chips" role="tablist" aria-label="Filter by month">
          <button role="tab" aria-selected={isAll} className={"rchip" + (isAll ? " on" : "")} onClick={() => setSel("all")}>All time</button>
          {chipKeys.map((k) => (
            <button key={k} role="tab" aria-selected={sel === k} className={"rchip" + (sel === k ? " on" : "") + (r.byMonth[k] ? "" : " empty")} onClick={() => setSel(k)}>
              {labelShort(k)}
            </button>
          ))}
        </div>
        <div className="rev-actions">
          {recurDue.length > 0 && (
            <button className="btn" onClick={() => setRecurOpen(true)}>Log {MONTHS[+curKey.slice(5) - 1]} recurring ({recurDue.length})</button>
          )}
          <button className="btn primary" onClick={() => setLogOpen(true)}>+ Log payment</button>
        </div>
      </div>

      {/* ---- headline tiles for the selected period ---- */}
      <div className="rev-head">
        <div className="rev-total">
          <div className="rt-label">{isAll ? "Collected, all dated payments" : labelLong(sel) + (inProgress ? " so far" : "")}</div>
          <div className="rt-val">{money(bucket.total)}{!isAll && <span className="rt-of"> / {money(MONTHLY_TARGET)}</span>}</div>
          {!isAll ? (
            <>
              <div className="rt-track"><div className="rt-fill" style={{ width: Math.min(100, (bucket.total / MONTHLY_TARGET) * 100) + "%" }} /></div>
              <div className="rt-sub">
                {Math.round((bucket.total / MONTHLY_TARGET) * 100)}% of the monthly goal
                {bucket.total < MONTHLY_TARGET ? " · " + money(MONTHLY_TARGET - bucket.total) + " short" : " · goal hit"}
                {vsAvg != null && <> · <span style={{ color: vsAvg >= 0 ? "var(--green)" : "var(--amber)" }}>{vsAvg >= 0 ? "+" : "-"}{money(Math.abs(vsAvg))} vs your monthly average</span></>}
                {inProgress && r.prevSameDay >= 0 && <> · last month by this day: {money(r.prevSameDay)}</>}
              </div>
            </>
          ) : (
            <div className="rt-sub">{bucket.count} payment{bucket.count === 1 ? "" : "s"} logged{undatedTotal > 0 ? ` · ${money(undatedTotal)} more is collected but has no date yet` : ""}</div>
          )}
        </div>
        <div className="rev-split">
          {KINDS.filter((k) => k.key !== "other" || bucket.other > 0).map((k) => (
            <div className="rs" key={k.key}>
              <div className="rs-l"><i style={{ background: k.color }} />{k.label}</div>
              <div className="rs-v">{bucket[k.key] > 0 ? money(bucket[k.key]) : <span className="faint">—</span>}</div>
            </div>
          ))}
          <div className="rs">
            <div className="rs-l">Payments</div>
            <div className="rs-v">{bucket.count || <span className="faint">—</span>}</div>
          </div>
        </div>
      </div>

      <div className="rev-grid">
        {/* ---- the bar chart ---- */}
        <div className="card rev-chart-card">
          <h4>
            Money in, by month
            <span className="rev-scale">
              <button className={scaleToGoal ? "on" : ""} onClick={() => setScaleToGoal(true)}>Scale to goal</button>
              <button className={!scaleToGoal ? "on" : ""} onClick={() => setScaleToGoal(false)}>Scale to data</button>
            </span>
          </h4>
          {r.pays.length === 0 ? (
            <div className="li-empty rev-empty">
              No payments logged yet. Hit <b>+ Log payment</b>, or give your undated cash a date below, and this chart fills in.
            </div>
          ) : (
            <div className="mchart" style={{ "--cols": r.range.length }}>
              <div className="mchart-plot">
                {goalPct <= 100 && (
                  <div className="mgoal" style={{ bottom: goalPct + "%" }}><span>{short(MONTHLY_TARGET)} goal</span></div>
                )}
                {r.range.map((k) => {
                  const b = r.byMonth[k];
                  const on = sel === k;
                  const dim = !isAll && !on;
                  return (
                    <button
                      key={k}
                      className={"mcol" + (on ? " on" : "") + (dim ? " dim" : "") + (k === curKey ? " cur" : "")}
                      onClick={() => setSel(on ? "all" : k)}
                      aria-label={labelLong(k) + ": " + (b ? money(b.total) : "no payments")}
                      title={b ? KINDS.filter((x) => b[x.key] > 0).map((x) => `${x.label}: ${money(b[x.key])}`).join("\n") : "No payments"}
                    >
                      <span className="mval">{b ? short(b.total) : ""}</span>
                      <span className="mstack" style={{ height: b ? Math.max(1.5, (b.total / scale) * 100) + "%" : 0 }}>
                        {b && KINDS.filter((x) => b[x.key] > 0).map((x) => (
                          <span key={x.key} className="mseg" style={{ height: (b[x.key] / b.total) * 100 + "%", background: x.color }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mchart-x">
                {r.range.map((k) => (
                  <span key={k} className={sel === k ? "on" : ""}>{labelShort(k)}{k === curKey ? "*" : ""}</span>
                ))}
              </div>
            </div>
          )}
          <div className="rev-legend">
            {KINDS.map((k) => <span key={k.key}><i style={{ background: k.color }} />{k.label}</span>)}
            <span className="faint">* month in progress · click a bar to filter</span>
          </div>
        </div>

        {/* ---- averages: side context, never in the chart ---- */}
        <div className="card">
          <h4>Averages <span className="pill">side context</span></h4>
          {r.pays.length === 0 ? (
            <div className="li-empty">Averages show up once payments are logged.</div>
          ) : (
            <div className="mini-rows">
              <div className="mini"><span>Avg per full month</span><b>{r.avgFull == null ? "needs a full month" : money(r.avgFull)}</b></div>
              <div className="mini-note">{r.fullMonths.length ? `${r.fullMonths.length} finished month${r.fullMonths.length === 1 ? "" : "s"} since your first payment, empty ones count as $0` : "the current month is still in progress"}</div>
              <div className="mini"><span>Last {r.last3.length || 3} full months</span><b>{r.avg3 == null ? "—" : money(r.avg3) + "/mo"}</b></div>
              <div className="mini"><span>Best month</span><b>{r.best ? `${money(r.byMonth[r.best].total)} · ${labelShort(r.best)}` : "—"}</b></div>
              <div className="mini"><span>{r.year} so far</span><b>{money(r.ytd)}</b></div>
              <div className="mini"><span>Avg payment size</span><b>{r.avgPayment == null ? "—" : money(r.avgPayment)}</b></div>
              <div className="mini"><span>Recurring share{isAll ? "" : ", " + labelShort(sel)}</span><b>{bucket.total ? Math.round(((bucket.retainer + bucket.contractor) / bucket.total) * 100) + "%" : "—"}</b></div>
            </div>
          )}
        </div>
      </div>

      <div className="rev-grid">
        {/* ---- the ledger behind the numbers ---- */}
        <div className="card">
          <h4>{isAll ? "Every payment" : "Payments in " + labelLong(sel)} <span className="pill">{ledger.length} logged</span></h4>
          {ledger.length === 0 ? (
            <div className="li-empty">{isAll ? "Nothing logged yet." : "No payments landed in " + labelLong(sel) + "."}</div>
          ) : (
            <>
              {shownLedger.map((p) => <LedgerRow key={p.id} p={p} onDelete={onDelete} />)}
              {ledger.length > 12 && (
                <button className="btn ghost sm rev-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${ledger.length}`}</button>
              )}
            </>
          )}
        </div>

        {/* ---- cash with no date ---- */}
        <div className="card">
          <h4>Collected, no date yet <span className="pill" style={{ color: undatedTotal ? "var(--amber)" : undefined }}>{money(undatedTotal)}</span></h4>
          {undated.length === 0 ? (
            <div className="li-empty">Every collected dollar has a date. The chart is complete.</div>
          ) : (
            <>
              <div className="card-note" style={{ marginTop: 0, marginBottom: 10 }}>
                Already counted as collected, but it is not in any month until you say when it landed. Split it if it came in parts.
              </div>
              {undated.map((x) => <UndatedRow key={x.p.id} x={x} onAdd={onAdd} />)}
            </>
          )}
        </div>
      </div>

      {logOpen && <LogModal projects={projects} onClose={() => setLogOpen(false)} onAdd={onAdd} />}
      {recurOpen && <RecurModal items={recurDue} monthLabel={labelLong(curKey)} onClose={() => setRecurOpen(false)} onAdd={onAdd} />}
    </div>
  );
}

function LedgerRow({ p, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="list-item ledger">
      <div className="li-main">
        <div className="li-name">{p.client}</div>
        <div className="li-sub">
          <span className="kind-dot" style={{ background: KIND_COLOR[p.kind] }} />{KIND_LABEL[p.kind]} · {fmtDay(p.date)}{p.note ? " · " + p.note : ""}
        </div>
      </div>
      <div className="li-right" style={{ color: "var(--text)" }}>{money(p.amount)}</div>
      <button
        className={"icon-btn led-del" + (confirm ? " sure" : "")}
        aria-label={confirm ? "Click again to delete" : "Delete payment"}
        onClick={async () => {
          if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
          await onDelete(p.id);
        }}
      >{confirm ? "Delete?" : "✕"}</button>
    </div>
  );
}

function UndatedRow({ x, onAdd }) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState(String(x.amount));
  const [busy, setBusy] = useState(false);
  const hint = x.p.launch || x.p.due || x.p.start;
  const kind = isClient(x.p) ? "build" : "contractor";
  return (
    <div className="undated">
      <div className="ud-main">
        <div className="li-name">{x.p.client}</div>
        <div className="li-sub">{money(x.amount)} undated{hint ? " · project dated " + fmtDay(hint) : ""}</div>
      </div>
      <input type="number" min="1" step="0.01" aria-label={"Amount for " + x.p.client} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input type="date" aria-label={"Date paid for " + x.p.client} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      <button
        className="btn sm primary"
        disabled={!date || !(num(amount) > 0) || busy}
        onClick={async () => {
          setBusy(true);
          const ok = await onAdd([{ projectId: x.p.id, kind, amount: num(amount), date, note: "" }]);
          setBusy(false);
          if (ok) setDate("");
        }}
      >Date it</button>
    </div>
  );
}

function LogModal({ projects, onClose, onAdd }) {
  const sorted = useMemo(() => (projects || []).slice().sort((a, b) => a.client.localeCompare(b.client)), [projects]);
  const [projectId, setProjectId] = useState("");
  const [client, setClient] = useState("");
  const [kind, setKind] = useState("build");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(id) {
    setProjectId(id);
    const p = sorted.find((x) => x.id === id);
    if (!p) return;
    if (!isClient(p)) setKind("contractor");
    else if (stageIsRecurring(p.work) && num(p.mrr) > 0 && num(p.paid) >= num(p.deal)) setKind("retainer");
    else setKind("build");
    if (!amount) {
      const left = Math.max(0, num(p.deal) - num(p.paid));
      if (!isClient(p) || (stageIsRecurring(p.work) && num(p.mrr) > 0 && left === 0)) setAmount(String(num(p.mrr) || ""));
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    const ok = await onAdd([{ projectId, client: projectId ? "" : client, kind, amount: num(amount), date, note }]);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-label="Log a payment">
        <div className="modal-head"><h3>Log a payment</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field full">
              <label>Who paid</label>
              <select value={projectId} onChange={(e) => pick(e.target.value)}>
                <option value="">Someone not in the list…</option>
                {sorted.map((p) => <option key={p.id} value={p.id}>{p.client}{p.project ? " · " + p.project : ""}</option>)}
              </select>
            </div>
            {!projectId && (
              <div className="field full"><label>Name</label><input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Who sent the money" /></div>
            )}
            <div className="field">
              <label>Type</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{KIND_LABEL[k.key]}</option>)}
              </select>
            </div>
            <div className="field"><label>Amount ($)</label><input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1500" autoFocus /></div>
            <div className="field"><label>Date it landed</label><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label>Note<span className="hint"> optional</span></label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deposit, Square #, …" /></div>
          </div>
          {kind !== "retainer" && projectId && (
            <div className="card-note">Also counts toward this project's collected total, without double counting cash already recorded there.</div>
          )}
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !(num(amount) > 0) || !date || (!projectId && !client.trim())} onClick={save}>Save payment</button>
        </div>
      </div>
    </div>
  );
}

function RecurModal({ items, monthLabel, onClose, onAdd }) {
  const [rows, setRows] = useState(items.map((x) => ({ ...x, on: true, amt: String(x.amount) })));
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((x) => x.on && num(x.amt) > 0);
  const total = chosen.reduce((s, x) => s + num(x.amt), 0);
  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-label="Log recurring payments">
        <div className="modal-head"><h3>Recurring money for {monthLabel}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">
          <div className="card-note" style={{ marginTop: 0, marginBottom: 12 }}>Only tick what actually landed. Anything left unticked stays off the chart.</div>
          {rows.map((x, i) => (
            <label className="recur-row" key={x.p.id}>
              <input type="checkbox" checked={x.on} onChange={(e) => set(i, { on: e.target.checked })} />
              <span className="rr-name">{x.p.client}<small>{KIND_LABEL[x.kind]}</small></span>
              <input type="number" min="1" step="0.01" value={x.amt} onChange={(e) => set(i, { amt: e.target.value })} aria-label={"Amount for " + x.p.client} />
            </label>
          ))}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field"><label>Date it landed</label><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || !chosen.length || !date}
            onClick={async () => {
              setBusy(true);
              const ok = await onAdd(chosen.map((x) => ({ projectId: x.p.id, kind: x.kind, amount: num(x.amt), date, note: "" })));
              setBusy(false);
              if (ok) onClose();
            }}
          >Log {chosen.length} · {money(total)}</button>
        </div>
      </div>
    </div>
  );
}
