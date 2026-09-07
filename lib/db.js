import { neon } from "@neondatabase/serverless";
import { STAGES, normStage } from "@/lib/pipeline";

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
  // --- pipeline upgrade columns (added Sep 2026) ---------------------------
  // stage_at   : when this project entered its current stage (drives aging)
  // sort_order : manual rank inside a board column
  // lost_reason: why a dead deal died
  // Added with no default so existing rows come back NULL and can be backfilled
  // from their last-edit time, rather than all claiming they moved just now.
  await db`alter table projects add column if not exists stage_at timestamptz`;
  await db`alter table projects add column if not exists sort_order numeric default 0`;
  await db`alter table projects add column if not exists lost_reason text default ''`;
  await db`update projects set stage_at = coalesce(updated_at, created_at, now()) where stage_at is null`;
  await db`alter table projects alter column stage_at set default now()`;

  // Client work vs contractor paychecks, so one gig can't masquerade as MRR.
  await db`alter table projects add column if not exists income_type text default 'client'`;

  // Every stage change, appended forever. This is what makes conversion rates
  // and deal velocity possible; a current-stage column alone can never answer
  // "what percentage of leads close" or "how long does a deal take".
  await db`
    create table if not exists stage_events (
      id          bigserial primary key,
      project_id  text not null,
      client      text default '',
      from_stage  text default '',
      to_stage    text not null,
      at          timestamptz default now()
    )
  `;
  await db`create index if not exists stage_events_project_idx on stage_events (project_id)`;
  await db`create index if not exists stage_events_at_idx on stage_events (at)`;
  // Seed one baseline event per project so the funnel isn't empty on day one.
  // Uses stage_at, which is when the project actually entered its stage.
  await db`
    insert into stage_events (project_id, client, from_stage, to_stage, at)
    select p.id, p.client, '', p.work, coalesce(p.stage_at, now())
    from projects p
    where not exists (select 1 from stage_events e where e.project_id = p.id)
  `;

  await db`create index if not exists projects_work_idx on projects (work)`;
  await db`create index if not exists projects_due_idx on projects (due_date)`;
  await db`create index if not exists projects_sort_idx on projects (work, sort_order)`;
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
    work: normStage(r.work),
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
    stageAt: r.stage_at ? new Date(r.stage_at).toISOString() : "",
    sortOrder: Number(r.sort_order) || 0,
    lostReason: r.lost_reason || "",
    incomeType: r.income_type || "client",
  };
}

// Coerce/clean an incoming project payload.
function clean(p) {
  const n = (v) => {
    const x = parseFloat(v);
    return isFinite(x) && x > 0 ? x : 0;
  };
  const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
  return {
    id: s(p.id) || "p_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
    client: s(p.client),
    project: s(p.project),
    live: s(p.live),
    staging: s(p.staging),
    niche: s(p.niche),
    // Any unknown or legacy status folds into a real stage instead of resetting.
    work: STAGES.includes(p.work) ? p.work : normStage(p.work),
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
    sortOrder: parseFloat(p.sortOrder) || 0,
    lostReason: s(p.lostReason),
    incomeType: p.incomeType === "contractor" ? "contractor" : "client",
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
  // Read the stage we're replacing so a real move can be logged.
  const before = await db`select work from projects where id = ${p.id}`;
  const prevStage = before.length ? normStage(before[0].work) : null;
  const rows = await db`
    insert into projects
      (id, client, project, live, staging, niche, work, deal, paid, mrr,
       refby, refpct, refpaid, start_date, due_date, launch_date, notes,
       sort_order, lost_reason, stage_at, updated_at)
    values
      (${p.id}, ${p.client}, ${p.project}, ${p.live}, ${p.staging}, ${p.niche},
       ${p.work}, ${p.deal}, ${p.paid}, ${p.mrr}, ${p.refby}, ${p.refpct},
       ${p.refpaid}, ${p.start}, ${p.due}, ${p.launch}, ${p.notes},
       ${p.sortOrder}, ${p.lostReason}, ${p.incomeType}, now(), now())
    on conflict (id) do update set
      client=excluded.client, project=excluded.project, live=excluded.live,
      staging=excluded.staging, niche=excluded.niche, work=excluded.work,
      deal=excluded.deal, paid=excluded.paid, mrr=excluded.mrr,
      refby=excluded.refby, refpct=excluded.refpct, refpaid=excluded.refpaid,
      start_date=excluded.start_date, due_date=excluded.due_date,
      launch_date=excluded.launch_date, notes=excluded.notes,
      sort_order=excluded.sort_order, lost_reason=excluded.lost_reason,
      income_type=excluded.income_type,
      -- the clock only resets when the stage actually changes
      stage_at = case when projects.work is distinct from excluded.work
                      then now() else projects.stage_at end,
      updated_at=now()
    returning *
  `;
  if (prevStage !== p.work) {
    await logStage(db, p.id, p.client, prevStage || "", p.work);
  }
  return mapRow(rows[0]);
}

// Board drag-and-drop: move/rank several cards in one round trip.
// Each move is { id, work, sortOrder }. stage_at resets only for cards whose
// stage actually changed, so reordering inside a column never fakes progress.
export async function reorder(moves) {
  if (!Array.isArray(moves) || !moves.length) return 0;
  const db = await conn();
  let count = 0;
  for (const m of moves) {
    if (!m || !m.id) continue;
    const stage = normStage(m.work);
    const order = parseFloat(m.sortOrder) || 0;
    const before = await db`select work, client from projects where id = ${m.id}`;
    const prev = before.length ? normStage(before[0].work) : null;
    await db`
      update projects set
        work = ${stage},
        sort_order = ${order},
        stage_at = case when work is distinct from ${stage} then now() else stage_at end,
        updated_at = now()
      where id = ${m.id}
    `;
    if (prev !== null && prev !== stage) {
      await logStage(db, m.id, before[0].client || "", prev, stage);
    }
    count++;
  }
  return count;
}

// Append one stage change to the event log. Never throws into the caller:
// a lost analytics row must not fail the move the user actually made.
async function logStage(db, projectId, client, from, to) {
  try {
    await db`
      insert into stage_events (project_id, client, from_stage, to_stage, at)
      values (${projectId}, ${client || ""}, ${from || ""}, ${to}, now())
    `;
  } catch (e) {
    // swallow — the move already succeeded
  }
}

// Full stage history, oldest first. Small by nature (a few rows per project).
export async function getEvents(limit = 5000) {
  const db = await conn();
  const rows = await db`
    select project_id, client, from_stage, to_stage, at
    from stage_events order by at asc limit ${limit}
  `;
  return rows.map((r) => ({
    projectId: r.project_id,
    client: r.client || "",
    from: r.from_stage || "",
    to: r.to_stage,
    at: new Date(r.at).toISOString(),
  }));
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
