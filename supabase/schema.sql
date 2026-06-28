-- DepFlow schema. Paste into the Supabase SQL editor (one-time setup).
-- Mirrors data-model.json. Children of epics are stored inline as JSONB;
-- dependencies are a separate edge table (issue_id depends on depends_on_id).

create table if not exists projects (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  prefix       text not null,
  current_wave int  not null default 1,
  accent       text not null default '#6e7bff'
);

create table if not exists themes (
  key   text primary key,
  name  text not null,
  color text not null
);

create table if not exists waves (
  number int  primary key,
  name   text not null,
  label  text not null default ''
);

create table if not exists issues (
  id         text primary key,
  project_id text not null references projects (id) on delete cascade,
  title      text not null,
  "desc"     text not null default '',
  type       text not null check (type in ('external', 'task', 'epic')),
  theme      text references themes (key),
  wave       int  not null default 1,
  done       boolean not null default false,
  parent_id  text references issues (id) on delete cascade,
  children   jsonb not null default '[]'::jsonb
);

create index if not exists issues_project_idx on issues (project_id);

create table if not exists dependencies (
  issue_id      text not null references issues (id) on delete cascade,
  depends_on_id text not null references issues (id) on delete cascade,
  primary key (issue_id, depends_on_id),
  check (issue_id <> depends_on_id)
);

create index if not exists deps_depends_on_idx on dependencies (depends_on_id);

-- --- Row Level Security -------------------------------------------------
-- v1 is a single-tenant demo driven by the anon key from the browser, so we
-- enable RLS and add permissive policies. TIGHTEN THESE before any real
-- multi-user deployment (scope by auth.uid() / an owner column).
alter table projects     enable row level security;
alter table themes       enable row level security;
alter table waves        enable row level security;
alter table issues       enable row level security;
alter table dependencies enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','themes','waves','issues','dependencies']
  loop
    execute format('drop policy if exists %I_anon_all on %I;', t, t);
    execute format(
      'create policy %I_anon_all on %I for all to anon, authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;
