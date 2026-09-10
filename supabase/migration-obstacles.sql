-- Obstacole: condiția de deblocat, ca entitate proprie. Rulează o dată:
-- npm run migrate supabase/migration-obstacles.sql
-- Single-line, fara ghilimele fanteziste (editoarele de telefon strica apostrofii). Safe to re-run.
--
-- Un obstacol NU e munca: nu are wave si nu are layer, deci nu intra in
-- computeLayers. owner e text liber, nu FK in assignees: „echipa de API",
-- „juridic", „management" nu sunt conturi in aplicatie si nu vor fi.
create table if not exists obstacles (id text primary key, project_id text not null references projects(id) on delete cascade, title text not null, detail text not null default '', owner text not null default '', state text not null default 'necunoscut' check (state in ('necunoscut','asteptare','depasit','ocolit')), blocking boolean not null default true, bypass text, evidence text not null default 'necunoscut' check (evidence in ('verificat','plauzibil','necunoscut')), asked_at timestamptz, resolved_at timestamptz, position integer not null default 0);
create index if not exists obstacles_project_idx on obstacles(project_id);

-- N la N, peste valuri: B1 blocheaza sase tichete din Faza 1. Se scrie o data
-- si se depaseste o data.
create table if not exists obstacle_issues (obstacle_id text not null references obstacles(id) on delete cascade, issue_id text not null references issues(id) on delete cascade, primary key (obstacle_id, issue_id));
create index if not exists obstacle_issues_issue_idx on obstacle_issues(issue_id);

-- Obstacol care blocheaza obstacol: #1 „cine e utilizatorul" → #19 „cate
-- tool-uri". Ciclurile se refuza in aplicatie (detectObstacleCycle).
create table if not exists obstacle_deps (obstacle_id text not null references obstacles(id) on delete cascade, depends_on_id text not null references obstacles(id) on delete cascade, primary key (obstacle_id, depends_on_id), check (obstacle_id <> depends_on_id));

alter table obstacles enable row level security;
alter table obstacle_issues enable row level security;
alter table obstacle_deps enable row level security;

-- Politicile urmeaza exact modelul din migration-access.sql: select pentru
-- orice membru al proiectului, scriere doar pentru role = write sau is_admin().
drop policy if exists obstacles_select on obstacles;
drop policy if exists obstacles_write on obstacles;
create policy obstacles_select on obstacles for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid()));
create policy obstacles_write on obstacles for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid() and m.role = 'write'));

drop policy if exists obstacle_issues_select on obstacle_issues;
drop policy if exists obstacle_issues_write on obstacle_issues;
create policy obstacle_issues_select on obstacle_issues for select to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid()));
create policy obstacle_issues_write on obstacle_issues for all to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid() and m.role = 'write'));

drop policy if exists obstacle_deps_select on obstacle_deps;
drop policy if exists obstacle_deps_write on obstacle_deps;
create policy obstacle_deps_select on obstacle_deps for select to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid()));
create policy obstacle_deps_write on obstacle_deps for all to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid() and m.role = 'write'));
