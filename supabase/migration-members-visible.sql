-- supabase/migration-members-visible.sql
-- Vizibilitatea membrilor unui proiect, pentru selectoarele „către…" (Thread.tsx)
-- și „Assigned to" (AssigneeSearch din IssueForm.tsx). Idempotent; se rulează cu
-- `npm run migrate supabase/migration-members-visible.sql`.
-- Vezi docs/superpowers/specs/2026-09-18-membri-in-selectoare.md
--
-- ── de ce funcții SECURITY DEFINER, nu o politică nouă pe project_members ───
-- „Cine are acces" trebuie citit ca EMAIL, nu doar ca `user_id` gol — un
-- selector cu id-uri fără nume n-ar ajuta pe nimeni. Dar `auth.users` nu are
-- NICIUN grant pentru rolul `authenticated` (nu e o chestiune de RLS: lipsește
-- privilegiul de bază), deci o vedere `security_invoker` ar eșua pentru orice
-- user obișnuit, oricât de permisivă ar fi politica de pe `project_members`.
-- Din moment ce tot ne trebuie o funcție care rulează cu alt rol ca să ajungă
-- la email, ea poate face ȘI verificarea de membership — deci nu lărgim și
-- politica `members_select` de pe `project_members` (rămâne „doar rândul tău",
-- ca azi). Suprafața nouă e minimă: user_id + email, doar pentru proiectul
-- cerut, doar dacă apelantul are el însuși acces la acel proiect.
--
-- ── regula exactă, precizată de om după primul draft ────────────────────────
-- Lista e EXACT membrii literali din `project_members` ai proiectului — nici
-- mai mulți, nici mai puțini — CU O SINGURĂ EXCEPȚIE: apelantul se vede
-- ÎNTOTDEAUNA pe sine, chiar fără rând de membership. Excepția există fiindcă
-- adminul (`lightsongjs@gmail.com`, legat de assignee-ul „Ionut") nu are
-- NICIUN rând în `project_members` — vede/scrie totul prin `is_admin()`, la
-- fel ca peste tot în `migration-access.sql`. Fără excepție, un proiect fără
-- niciun membru explicit i-ar arăta o listă GOALĂ acolo unde ar trebui să se
-- vadă „doar pe mine, atât".
--
-- Excepția e STRICT per-apelant, nu „orice admin apare peste tot": adăugăm
-- doar `auth.uid()` (cine CHEAMĂ funcția), nu orice cont cu rol admin. Un alt
-- admin ipotetic, fără rând explicit pe acest proiect, NU apare în rezultatul
-- pe care-l vede Ana — la fel cum Ana nu apare în rezultatul altcuiva doar
-- fiindcă e membru în altă parte. Cele două cerințe („mă văd mereu pe mine" +
-- „un admin nu apare la alții fără să fi fost adăugat") nu se bat: prima se
-- aplică rândului „eu" din rezultatul FIECĂREI cereri, a doua se aplică
-- rezultatului cererii ALTCUIVA.

create or replace function public.project_member_roster(p_project_id text)
returns table(user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  -- Apelantul trebuie să aibă el însuși acces la proiect — altfel rândurile
  -- de mai jos sunt un mod ocolit de a enumera conturi din proiecte străine.
  if not (
    public.is_admin() or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
    )
  ) then
    return; -- listă goală, ca un select RLS fără rânduri — nu o eroare
  end if;

  return query
    select u.id, u.email::text
      from auth.users u
     where u.id = auth.uid() -- mereu eu, admin sau nu, membru explicit sau nu
        or exists (
             select 1 from public.project_members m
              where m.project_id = p_project_id and m.user_id = u.id
           );
end
$fn$;

revoke all on function public.project_member_roster(text) from public;
grant execute on function public.project_member_roster(text) to authenticated;

-- ── legarea la prima alegere ─────────────────────────────────────────────
-- Un membru fără rând în `assignees` nu poate fi ales ca destinatar
-- (`issues.assignee_id`/`issue_events.handoff_to` referă `assignees(id)`).
-- Politica `assignees_write` de azi (migration-comments.sql) lasă un user
-- obișnuit să insereze DOAR `user_id is null or user_id = auth.uid()` — Ana nu
-- poate crea direct rândul lui Bogdan. Funcția de mai jos face exact atât:
-- verifică accesul apelantului la proiect, verifică că ȚINTA e chiar în
-- rosterul de mai sus (membru literal SAU apelantul însuși), apoi creează
-- (sau găsește) rândul, cu numele derivat din partea locală a emailului — la
-- fel ca fallback-ul din UI (`memberDisplayName`), ca „Ana l-a creat" să nu
-- difere de ce vede toată lumea după aceea.
create or replace function public.ensure_project_assignee(p_project_id text, p_user_id uuid)
returns public.assignees
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_row public.assignees;
begin
  if not (
    public.is_admin() or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
    )
  ) then
    raise exception 'fara acces la proiectul %', p_project_id using errcode = '42501';
  end if;

  -- Ținta trebuie să fie chiar cineva din rosterul de mai sus: un membru
  -- literal al proiectului, SAU apelantul însuși (self-service, ca un admin
  -- fără rând explicit să se poată totuși alege pe sine).
  if not (
    p_user_id = auth.uid() or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = p_user_id
    )
  ) then
    raise exception 'utilizatorul nu are acces la proiectul %', p_project_id using errcode = '42501';
  end if;

  select * into v_row from public.assignees where user_id = p_user_id;
  if found then
    return v_row;
  end if;

  select email into v_email from auth.users where id = p_user_id;

  -- `assignees_user_idx` (migration-comments.sql) e PARȚIAL
  -- (`where user_id is not null`): un `on conflict (user_id)` simplu nu se
  -- potrivește cu el („no unique or exclusion constraint matching"), trebuie
  -- același predicat aici.
  insert into public.assignees (name, user_id)
  values (coalesce(nullif(split_part(v_email, '@', 1), ''), 'membru'), p_user_id)
  on conflict (user_id) where user_id is not null do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Cursă cu o altă cerere concurentă pentru ACELAȘI user_id: indexul unic
    -- de pe `assignees.user_id` a refuzat inserarea noastră, dar rândul
    -- celeilalte cereri e la fel de bun.
    select * into v_row from public.assignees where user_id = p_user_id;
  end if;

  return v_row;
end
$fn$;

revoke all on function public.ensure_project_assignee(text, uuid) from public;
grant execute on function public.ensure_project_assignee(text, uuid) to authenticated;

notify pgrst, 'reload schema';
