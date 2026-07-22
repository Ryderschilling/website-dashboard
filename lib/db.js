import { neon } from "@neondatabase/serverless";

// Lazily create the client so a missing DATABASE_URL never throws at build time.
function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

// Auto-create the table + indexes on first use. Idempotent (IF NOT EXISTS),
// so it's safe to run every cold start and needs zero manual SQL setup.
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db`
    create table if not exists projects (
      id text primary key,
      client text not null default '',
      project text default '',
      live text default '',
      staging text default '',
      niche text default '',
      work text default 'Lead',
      deal numeric default 0,
      paid numeric default 0,
      mrr numeric default 0,
      refby text default '',
      refpct numeric default 0,
      refpaid boolean default false,
      start_date text default '',
      due_date text default '',
      launch_date text default '',
      notes text default '',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `;
  await db`create index if not exists projects_work_idx on projects (work)`;
  await db`create index if not exists projects_due_idx on projects (due_date)`;
  schemaReady = true;
}

// Get a connected client with the schema guaranteed to exist.
async function conn() {
  const db = sql();
  await ensureSchema(db);
  return db;
}

// Normalize a DB row into the shape the front-end uses.
export function mapRow(r) {
  return {
    id: r.id,
    client: r.client || "",
    project: r.project || "",
    live: r.live || "",
    staging: r.staging || "",
    niche: r.niche || "",
    work: r.work || "Lead",
    deal: Number(r.deal) || 0,
    paid: Number(r.paid) || 0,
    mrr: Number(r.mrr) || 0,
    refby: r.refby || "",
    refpct: Number(r.refpct) || 0,
    refpaid: !!r.refpaid,
    start: r.start_date || "",
    due: r.due_date || "",
    launch: r.launch_date || "",
    notes: r.notes || "",
  };
}

// Coerce/clean an incoming project payload.
function clean(p) {
  const n = (v) => {
    const x = parseFloat(v);
    return isFinite(x) && x > 0 ? x : 0;
  };
  const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const WORK = ["Lead", "In Progress", "In Review", "Launched", "Payment Pending", "On Hold", "Complete"];
  return {
    id: s(p.id) || "p_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
    client: s(p.client),
    project: s(p.project),
    live: s(p.live),
    staging: s(p.staging),
    niche: s(p.niche),
    work: WORK.indexOf(p.work) >= 0 ? p.work : "Lead",
    deal: n(p.deal),
    paid: n(p.paid),
    mrr: n(p.mrr),
    refby: s(p.refby),
    refpct: n(p.refpct),
    refpaid: !!p.refpaid,
    start: s(p.start),
    due: s(p.due),
    launch: s(p.launch),
    notes: s(p.notes),
  };
}

export async function getAll() {
  const db = await conn();
  const rows = await db`
    select * from projects
    order by (case when due_date = '' then 1 else 0 end), due_date asc, client asc
  `;
  return rows.map(mapRow);
}

export async function upsert(payload) {
  const p = clean(payload);
  const db = await conn();
  const rows = await db`
    insert into projects
      (id, client, project, live, staging, niche, work, deal, paid, mrr,
       refby, refpct, refpaid, start_date, due_date, launch_date, notes, updated_at)
    values
      (${p.id}, ${p.client}, ${p.project}, ${p.live}, ${p.staging}, ${p.niche},
       ${p.work}, ${p.deal}, ${p.paid}, ${p.mrr}, ${p.refby}, ${p.refpct},
       ${p.refpaid}, ${p.start}, ${p.due}, ${p.launch}, ${p.notes}, now())
    on conflict (id) do update set
      client=excluded.client, project=excluded.project, live=excluded.live,
      staging=excluded.staging, niche=excluded.niche, work=excluded.work,
      deal=excluded.deal, paid=excluded.paid, mrr=excluded.mrr,
      refby=excluded.refby, refpct=excluded.refpct, refpaid=excluded.refpaid,
      start_date=excluded.start_date, due_date=excluded.due_date,
      launch_date=excluded.launch_date, notes=excluded.notes, updated_at=now()
    returning *
  `;
  return mapRow(rows[0]);
}

export async function remove(id) {
  const db = await conn();
  await db`delete from projects where id = ${id}`;
  return true;
}

export async function importMany(list) {
  if (!Array.isArray(list)) throw new Error("import payload must be an array");
  let count = 0;
  for (const item of list) {
    await upsert(item);
    count++;
  }
  return count;
}
