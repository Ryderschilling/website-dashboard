-- Ryder Schilling Client Dashboard schema
-- The app creates and migrates this automatically on first request, so you do
-- not have to run anything by hand. Kept here as the readable source of truth.

create table if not exists projects (
  id           text primary key,
  client       text not null default '',
  project      text default '',
  live         text default '',
  staging      text default '',
  niche        text default '',
  -- Pipeline stage: Lead, Meeting, Proposal, In Progress, In Review,
  -- Domain, Complete, Recurring, Lost
  work         text default 'Lead',
  deal         numeric default 0,
  paid         numeric default 0,
  mrr          numeric default 0,
  refby        text default '',
  refpct       numeric default 0,
  refpaid      boolean default false,
  start_date   text default '',
  due_date     text default '',
  launch_date  text default '',
  notes        text default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Pipeline upgrade (Sep 2026)
alter table projects add column if not exists stage_at    timestamptz;
alter table projects add column if not exists sort_order  numeric default 0;
alter table projects add column if not exists lost_reason text default '';
-- Client work vs contractor paychecks. Client metrics use 'client' only.
alter table projects add column if not exists income_type text default 'client';

-- Every stage change, appended forever. Conversion rates and deal velocity
-- are impossible from a current-stage column alone.
create table if not exists stage_events (
  id         bigserial primary key,
  project_id text not null,
  client     text default '',
  from_stage text default '',
  to_stage   text not null,
  at         timestamptz default now()
);
create index if not exists stage_events_project_idx on stage_events (project_id);
create index if not exists stage_events_at_idx      on stage_events (at);

-- Seed one baseline event per project so the funnel is not empty on day one.
insert into stage_events (project_id, client, from_stage, to_stage, at)
select p.id, p.client, '', p.work, coalesce(p.stage_at, now())
from projects p
where not exists (select 1 from stage_events e where e.project_id = p.id);

update projects set stage_at = coalesce(updated_at, created_at, now())
where stage_at is null;
alter table projects alter column stage_at set default now();

-- Fold the old status names into the new stage list.
update projects set work = 'Proposal'    where work = 'Payment Pending';
update projects set work = 'In Progress' where work = 'On Hold';
update projects set work = 'Complete'    where work = 'Launched';

create index if not exists projects_work_idx on projects (work);
create index if not exists projects_due_idx  on projects (due_date);
create index if not exists projects_sort_idx on projects (work, sort_order);
