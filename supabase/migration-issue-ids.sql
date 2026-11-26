-- Numerele ocupate dintr-un proiect, pentru „cel mai mare + 1" (`nextIssueId`).
--
-- Clientul fără drept la Notițe nu vede tichetele din valul 0 (RLS,
-- migration-notes-access.sql), deci calcula un număr deja luat de o notiță și
-- primea `duplicate key value violates unique constraint "issues_pkey"` la
-- fiecare tichet nou (NEVEON, 2026-11-05: NK-45…NK-52 erau toate notițe).
-- Funcția întoarce DOAR id-urile — nu titlul sau altceva din notiță — oricărui
-- membru al proiectului (și adminului). Un id nu spune nimic în plus: numărul
-- următor l-ar fi dezvăluit oricum.
--
-- Și numerele din coș (2026-11-26): un tichet șters își păstrează numărul cât
-- stă acolo, altfel „cel mai mare + 1" îl dădea următorului tichet nou — coșul
-- ajungea cu două `H-19`, iar o trimitere veche („vezi H-19") arăta alt tichet.
-- După golirea coșului (30 de zile) numărul se poate refolosi.
-- `plpgsql`, nu `sql`: corpul se verifică abia la apel, deci fișierul se poate
-- rula și înaintea lui migration-trash.sql (testele o fac).
--
-- Deploy: `npm run migrate supabase/migration-issue-ids.sql` ÎNAINTE de push
-- (clientul nou o cheamă la fiecare creare) și înainte de un APK nou.
-- Test: `npm run test:notes-sql`.

create or replace function public.project_issue_ids(p_project text)
returns table (id text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (public.is_admin() or exists (
       select 1 from public.project_members m
        where m.project_id = p_project and m.user_id = (select auth.uid()))) then
    return;
  end if;
  return query
    select i.id from public.issues i where i.project_id = p_project
    union
    select t.issue_id from public.issues_trash t where t.project_id = p_project;
end
$fn$;

revoke all on function public.project_issue_ids(text) from public, anon;
grant execute on function public.project_issue_ids(text) to authenticated;
