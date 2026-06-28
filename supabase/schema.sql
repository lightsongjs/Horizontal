-- DepFlow schema (phase 1). Run once in the Supabase SQL editor.
-- Each statement is on a single line and the script uses NO quote characters,
-- so mobile editors can't break it with smart-quotes or auto-bracketing.
-- Simple issues (no type/epic). Waves per-project. No seed — create in the app.

create table if not exists projects (id text primary key, name text not null, description text, prefix text not null, current_wave int not null default 1, accent text);
create table if not exists waves (project_id text not null references projects(id) on delete cascade, number int not null, name text not null, label text, position int not null default 0, primary key (project_id, number));
create table if not exists issues (id text primary key, project_id text not null references projects(id) on delete cascade, title text not null, details text, wave int not null default 1, done boolean not null default false);
create index if not exists issues_project_idx on issues(project_id);
create table if not exists dependencies (issue_id text not null references issues(id) on delete cascade, depends_on_id text not null references issues(id) on delete cascade, primary key (issue_id, depends_on_id));
alter table projects enable row level security;
alter table waves enable row level security;
alter table issues enable row level security;
alter table dependencies enable row level security;
create policy p_projects on projects for all to authenticated using (true) with check (true);
create policy p_waves on waves for all to authenticated using (true) with check (true);
create policy p_issues on issues for all to authenticated using (true) with check (true);
create policy p_dependencies on dependencies for all to authenticated using (true) with check (true);
