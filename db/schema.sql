-- builtbyRyder Client Dashboard schema
-- Run this once against your Neon database (Neon dashboard -> SQL Editor -> paste -> Run).

create table if not exists projects (
  id           text primary key,
  client       text not null default '',
  project      text default '',
  live         text default '',
  staging      text default '',
  niche        text default '',
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

-- Helps sorting/filtering as the table grows.
create index if not exists projects_work_idx on projects (work);
create index if not exists projects_due_idx on projects (due_date);
