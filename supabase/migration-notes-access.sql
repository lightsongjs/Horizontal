-- Notițele (valul 0) sunt ale omului, nu ale clientului.
--
-- Rulează: npm run migrate supabase/migration-notes-access.sql, apoi
-- RE-RULEAZĂ migration-move-issue.sql și migration-trash.sql (le-am pus și lor
-- verificarea: politicile de Storage stau în move-issue, `restore_issue` /
-- `purge_trash` / coșul în trash). Depinde de migration-access.sql,
-- -attachments, -comments, -obstacles; move-issue și trash depind de ACEASTA.
--
-- Dreptul e pe proiect (`project_members.can_see_notes`), nu pe cont: un client
-- într-un proiect poate fi coleg în altul. Implicit `false`, și pentru membrii
-- existenți (decizia omului, 2026-10-29). Adminul vede tot, prin `is_admin()`.
--
-- Regula e în bază, nu în interfață: ascunse doar din UI, notițele ar fi fost
-- citibile direct prin REST cu sesiunea clientului. De aceea fiecare politică
-- ce lasă un membru să citească ceva legat de un tichet primește în plus
-- `notes_ok` / `issue_notes_ok`. Și rândul valului 0 din `waves` e ascuns:
-- clientul nu primește nici pastila „Notițe", nici numărul ei — interfața
-- știa deja să trăiască fără ea (`scratch` null în WaveTabs).
--
-- Mutarea unui tichet din Notițe într-un val îl publică întreg (fir, fișiere),
-- iar invers îl ascunde — fără nicio scriere în plus, fiindcă totul se leagă de
-- `issues.wave`. Un client nu poate pune un tichet în Notițe (with check).

alter table public.project_members
  add column if not exists can_see_notes boolean not null default false;

-- ── funcțiile-poartă ────────────────────────────────────────────────────────
-- `security definer`: citesc `issues`/`project_members` ocolind RLS, altfel
-- o politică pe `issues` care întreabă de `issues` ar intra în recursie, iar
-- un `not exists` pe `attachments` ar vedea doar rândurile deja filtrate.
-- NU verifică apartenența la proiect: aceea rămâne în fiecare politică, ca
-- până acum. Răspund doar la „dacă e notiță, ai voie?".

create or replace function public.notes_ok(p_project text, p_wave int)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_wave is distinct from 0
      or public.is_admin()
      or exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = (select auth.uid())
                    and m.can_see_notes)
$$;

-- Un tichet inexistent trece: absența lui nu e o notiță (politicile de insert
-- au propriile verificări, iar `move_issue` creează rândul abia după).
create or replace function public.issue_notes_ok(p_issue text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.notes_ok(i.project_id, i.wave)
                     from public.issues i where i.id = p_issue), true)
$$;

-- Un obiect din Storage: după rândul lui din `attachments`, apoi după coș
-- (rândul a plecat odată cu tichetul, calea a rămas în `paths`), apoi după
-- tichetul din cale (`proiect/TICHET/…`, octeții urcă ÎNAINTEA rândului).
create or replace function public.path_notes_ok(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_issue text;
begin
  select a.issue_id into v_issue from public.attachments a where a.path = p_path limit 1;
  if found then return public.issue_notes_ok(v_issue); end if;
  -- Coșul vine din migration-trash.sql, care rulează după aceasta. Două `if`
  -- separate: o singură expresie s-ar planifica întreagă, cu tot cu tabela.
  if pg_catalog.to_regclass('public.issues_trash') is not null then
    if exists (select 1 from public.issues_trash t
                where p_path = any(t.paths)
                  and not public.notes_ok(t.project_id, (t.issue ->> 'wave')::int)) then
      return false;
    end if;
  end if;
  return public.issue_notes_ok((storage.foldername(p_path))[2]);
end $$;

revoke all on function public.notes_ok(text, int) from public, anon;
revoke all on function public.issue_notes_ok(text) from public, anon;
revoke all on function public.path_notes_ok(text) from public, anon;
grant execute on function public.notes_ok(text, int) to authenticated;
grant execute on function public.issue_notes_ok(text) to authenticated;
grant execute on function public.path_notes_ok(text) to authenticated;

-- ── politicile ──────────────────────────────────────────────────────────────
-- Aceleași ca în migrările lor, plus poarta. `wave <> 0 or …` direct în
-- politica de pe `issues`: scurtcircuit fără apel de funcție pe rândurile
-- obișnuite.

drop policy if exists waves_select on public.waves;
drop policy if exists waves_write on public.waves;
create policy waves_select on public.waves for select to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = waves.project_id and m.user_id = (select auth.uid())))
  and (waves.number <> 0 or public.notes_ok(waves.project_id, 0)));
create policy waves_write on public.waves for all to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = waves.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and (waves.number <> 0 or public.notes_ok(waves.project_id, 0)))
with check ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = waves.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and (waves.number <> 0 or public.notes_ok(waves.project_id, 0)));

drop policy if exists issues_select on public.issues;
drop policy if exists issues_write on public.issues;
create policy issues_select on public.issues for select to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = issues.project_id and m.user_id = (select auth.uid())))
  and (issues.wave <> 0 or public.notes_ok(issues.project_id, 0)));
create policy issues_write on public.issues for all to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = issues.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and (issues.wave <> 0 or public.notes_ok(issues.project_id, 0)))
with check ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = issues.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and (issues.wave <> 0 or public.notes_ok(issues.project_id, 0)));

-- Ambele capete: o dependență spre o notiță ar fi arătat clientului un ID
-- care „nu există".
drop policy if exists dependencies_select on public.dependencies;
drop policy if exists dependencies_write on public.dependencies;
create policy dependencies_select on public.dependencies for select to authenticated
using ((public.is_admin() or exists (select 1 from public.issues i join public.project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = (select auth.uid())))
  and public.issue_notes_ok(dependencies.issue_id) and public.issue_notes_ok(dependencies.depends_on_id));
create policy dependencies_write on public.dependencies for all to authenticated
using ((public.is_admin() or exists (select 1 from public.issues i join public.project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(dependencies.issue_id) and public.issue_notes_ok(dependencies.depends_on_id))
with check ((public.is_admin() or exists (select 1 from public.issues i join public.project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(dependencies.issue_id) and public.issue_notes_ok(dependencies.depends_on_id));

drop policy if exists obstacle_issues_select on public.obstacle_issues;
drop policy if exists obstacle_issues_write on public.obstacle_issues;
create policy obstacle_issues_select on public.obstacle_issues for select to authenticated
using ((public.is_admin() or exists (select 1 from public.obstacles o join public.project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = (select auth.uid())))
  and public.issue_notes_ok(obstacle_issues.issue_id));
create policy obstacle_issues_write on public.obstacle_issues for all to authenticated
using ((public.is_admin() or exists (select 1 from public.obstacles o join public.project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(obstacle_issues.issue_id))
with check ((public.is_admin() or exists (select 1 from public.obstacles o join public.project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(obstacle_issues.issue_id));

drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_write on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = attachments.project_id and m.user_id = (select auth.uid())))
  and public.issue_notes_ok(attachments.issue_id));
create policy attachments_write on public.attachments for all to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = attachments.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(attachments.issue_id))
with check ((public.is_admin() or exists (select 1 from public.project_members m where m.project_id = attachments.project_id and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(attachments.issue_id));

drop policy if exists events_select on public.issue_events;
drop policy if exists events_insert on public.issue_events;
drop policy if exists events_update on public.issue_events;
drop policy if exists events_delete on public.issue_events;
create policy events_select on public.issue_events for select to authenticated
using ((public.is_admin() or exists (select 1 from public.project_members m
  where m.project_id = issue_events.project_id and m.user_id = (select auth.uid())))
  and public.issue_notes_ok(issue_events.issue_id));
create policy events_insert on public.issue_events for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (public.is_admin() or exists (select 1 from public.project_members m
        where m.project_id = issue_events.project_id
          and m.user_id = (select auth.uid()) and m.role = 'write'))
  and public.issue_notes_ok(issue_events.issue_id)
);
create policy events_update on public.issue_events for update to authenticated
using      (kind = 'comment' and author_id = (select auth.uid()) and public.issue_notes_ok(issue_id))
with check (kind = 'comment' and author_id = (select auth.uid()) and public.issue_notes_ok(issue_id));
create policy events_delete on public.issue_events for delete to authenticated
using (kind = 'comment' and (author_id = (select auth.uid()) or public.is_admin()) and public.issue_notes_ok(issue_id));
