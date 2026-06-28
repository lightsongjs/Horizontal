-- DepFlow schema (phase 1). Run once in the Supabase SQL editor.
-- Simple issues (no type/epic). Waves are per-project. Dependencies are an
-- edge table. No seed data — projects/waves/issues are created in the app.

create table if not exists projects (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  prefix       text not null,
  current_wave int  not null default 1,
  accent       text not null default '#6e7bff'
);

create table if not exists waves (
  project_id text not null references projects (id) on delete cascade,
  number     int  not null,
  name       text not null,
  label      text not null default '',
  position   int  not null default 0,
  primary key (project_id, number)
);

create table if not exists issues (
  id         text primary key,
  project_id text not null references projects (id) on delete cascade,
  title      text not null,
  "desc"     text not null default '',
  wave       int  not null default 1,
  done       boolean not null default false
);

create index if not exists issues_project_idx on issues (project_id);

create table if not exists dependencies (
  issue_id      text not null references issues (id) on delete cascade,
  depends_on_id text not null references issues (id) on delete cascade,
  primary key (issue_id, depends_on_id)
);

-- Row Level Security: single-user app, any logged-in user gets full access.
alter table projects     enable row level security;
alter table waves        enable row level security;
alter table issues       enable row level security;
alter table dependencies enable row level security;

drop policy if exists p_projects on projects;
create policy p_projects on projects for all to authenticated using (true) with check (true);
drop policy if exists p_waves on waves;
create policy p_waves on waves for all to authenticated using (true) with check (true);
drop policy if exists p_issues on issues;
create policy p_issues on issues for all to authenticated using (true) with check (true);
drop policy if exists p_dependencies on dependencies;
create policy p_dependencies on dependencies for all to authenticated using (true) with check (true);
