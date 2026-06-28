-- Phase 2 migration: adds themes (run once if you already ran the phase-1
-- schema.sql). Single-line, no quote characters. Safe to re-run.

create table if not exists themes (project_id text not null references projects(id) on delete cascade, key text not null, name text not null, color text not null, primary key (project_id, key));
alter table issues add column if not exists theme text;
alter table themes enable row level security;
drop policy if exists p_themes on themes;
create policy p_themes on themes for all to authenticated using (true) with check (true);
