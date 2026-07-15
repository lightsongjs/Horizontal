-- Horizontal multi-user access migration. Run once in the Supabase SQL editor.
-- Unlike schema.sql (which uses NO quote characters as a mobile-editor safety
-- trick), this file MUST use single-quoted string literals ('read', 'write',
-- 'admin', 'app_metadata', 'role') because the logic genuinely depends on them.
-- Correctness wins over the no-quote convention here.

-- Part A: membership table + admin helper
create table if not exists project_members (user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, role text not null check (role in ('read','write')), primary key (user_id, project_id));
create index if not exists project_members_user_idx on project_members(user_id);
alter table project_members enable row level security;
create or replace function is_admin() returns boolean language sql stable as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;

-- Part B: drop old permissive policies, create membership-aware ones
drop policy if exists p_projects on projects;
drop policy if exists p_waves on waves;
drop policy if exists p_themes on themes;
drop policy if exists p_issues on issues;
drop policy if exists p_dependencies on dependencies;

-- projects: read if admin or member; write (insert/update/delete) admin only
create policy projects_select on projects for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = projects.id and m.user_id = auth.uid()));
create policy projects_write on projects for all to authenticated using (is_admin()) with check (is_admin());

-- waves: read if admin or member; write if admin or member with role write
create policy waves_select on waves for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid()));
create policy waves_write on waves for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid() and m.role = 'write'));

-- themes: same shape as waves
create policy themes_select on themes for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid()));
create policy themes_write on themes for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid() and m.role = 'write'));

-- issues: same shape as waves
create policy issues_select on issues for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid()));
create policy issues_write on issues for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid() and m.role = 'write'));

-- dependencies: no project_id column; resolve via the owning issue
create policy dependencies_select on dependencies for select to authenticated using (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid()));
create policy dependencies_write on dependencies for all to authenticated using (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid() and m.role = 'write'));

-- project_members: admin manages all; a user reads only their own rows
create policy members_select on project_members for select to authenticated using (is_admin() or user_id = auth.uid());
create policy members_write on project_members for all to authenticated using (is_admin()) with check (is_admin());
