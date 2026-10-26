-- supabase/migration-move-issue.sql
-- Mutarea unui tichet în alt proiect (D-156). Idempotent; se rulează cu
-- `npm run migrate supabase/migration-move-issue.sql`, ÎNAINTE de push
-- (clientul cheamă RPC-ul).
-- Spec: docs/superpowers/specs/2026-10-12-mutare-tichet-intre-proiecte-design.md
-- Teste: `npm run test:move-sql` (pe un Postgres de unică folosință, NU pe producție).
--
-- Depinde de: migration-access.sql (is_admin, project_members),
-- migration-attachments.sql, migration-comments.sql (issue_events, issue_seen,
-- assignees.user_id), migration-obstacles.sql.

-- ── 1. move_issue ───────────────────────────────────────────────────────────
-- O singură tranzacție, ca `post_to_thread`: o rețea căzută la mijloc n-are
-- cum să lase firul pe un ID și tichetul pe altul.
--
-- De ce insert-nou → mută-copii → șterge-vechi, nu `update issues set id`:
-- cheile străine n-au `on update cascade`, iar `issue_events`/`attachments` au
-- FK compus pe (issue_id, project_id). Copia se face prin
-- `jsonb_populate_record(to_jsonb(vechi) || patch)`, deci o coloană adăugată
-- în viitor se copiază singură. E un INSERT, deci triggerele `before update`
-- (recurența, `reminder_sent_at`) nu rulează: valorile trec neschimbate.
--
-- `security definer`: verificările de drept sunt făcute AICI, explicit (scriere
-- pe sursă ȘI pe țintă, sau admin). Fără definer, RLS-ul pe `issue_seen` (doar
-- rândurile tale) ar fi lăsat vizitele celorlalți pe ID-ul vechi, iar cascada
-- le-ar fi șters.
--
-- Fiecare refuz are errcode propriu (clasa HZ, „Horizontal"), iar mesajul e
-- cel pe care îl vede omul — PostgREST îl trimite ca atare în `message`:
--   HZM01 dependențe · HZM02 obstacol · HZM03 fără drept · HZM04 același
--   proiect · HZM05 ID provizoriu · HZM06 tichet/proiect inexistent
create or replace function public.move_issue(p_id text, p_target text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_me     uuid := auth.uid();
  v_admin  boolean := public.is_admin();
  v_old    public.issues;
  v_src    public.projects;
  v_dst    public.projects;
  v_list   text;
  v_max    numeric;
  v_n      numeric := 0;
  v_new    text;
  v_assign uuid;
  v_try    int := 0;
begin
  if v_me is null and not v_admin then
    raise exception 'Nu ești autentificat.' using errcode = '42501';
  end if;

  -- Numărul real încă n-a venit: tichetul e doar în coada unui dispozitiv.
  if pg_catalog.strpos(p_id, '-~') > 0 then
    raise exception 'Nu se poate muta: tichetul încă n-a primit numărul de la server.' using errcode = 'HZM05';
  end if;

  select * into v_old from public.issues where id = p_id for update;
  -- Invizibil = inexistent: un ne-membru nu află că ID-ul există.
  if not found or not (v_admin or exists (
       select 1 from public.project_members m where m.project_id = v_old.project_id and m.user_id = v_me)) then
    raise exception 'Tichetul % nu există.', p_id using errcode = 'HZM06';
  end if;

  select * into v_src from public.projects where id = v_old.project_id;

  if p_target = v_old.project_id then
    raise exception 'Tichetul e deja în proiectul „%".', v_src.name using errcode = 'HZM04';
  end if;

  -- Lacătul pe rândul proiectului ȚINTĂ serializează numerotarea: două mutări
  -- simultane în același proiect nu pot alege același număr.
  select * into v_dst from public.projects where id = p_target for update;
  if not found or not (v_admin or exists (
       select 1 from public.project_members m where m.project_id = p_target and m.user_id = v_me)) then
    raise exception 'Proiectul țintă nu există.' using errcode = 'HZM06';
  end if;

  if not (v_admin or exists (select 1 from public.project_members m
            where m.project_id = v_src.id and m.user_id = v_me and m.role = 'write')) then
    raise exception 'Nu ai drept de editare în proiectul „%".', v_src.name using errcode = 'HZM03';
  end if;
  if not (v_admin or exists (select 1 from public.project_members m
            where m.project_id = v_dst.id and m.user_id = v_me and m.role = 'write')) then
    raise exception 'Nu ai drept de editare în proiectul „%".', v_dst.name using errcode = 'HZM03';
  end if;

  -- Orice dependență, în ORICE sens: dependențele sunt ale proiectului.
  select string_agg(d.other, ', ' order by pg_catalog.length(d.other), d.other) into v_list
    from (select depends_on_id as other from public.dependencies where issue_id = p_id
          union
          select issue_id from public.dependencies where depends_on_id = p_id) d;
  if v_list is not null then
    raise exception 'Nu se poate muta %: are dependențe (%). Scoate-le întâi.', p_id, v_list using errcode = 'HZM01';
  end if;

  -- Obstacolele sunt ale proiectului și nu pot urma tichetul.
  if exists (select 1 from public.obstacle_issues where issue_id = p_id) then
    raise exception 'Nu se poate muta %: e legat de un obstacol. Scoate-l întâi.', p_id using errcode = 'HZM02';
  end if;

  -- Persoana rămâne doar dacă poate vedea tichetul în proiectul nou (membru al
  -- țintei sau admin). Altfel tichetul revine la creator, nu rămâne pasat
  -- cuiva care nu-l mai poate deschide.
  v_assign := v_old.assignee_id;
  if v_assign is not null and not exists (
       select 1 from public.assignees a
        where a.id = v_assign and a.user_id is not null
          and (exists (select 1 from public.project_members m where m.project_id = p_target and m.user_id = a.user_id)
               or exists (select 1 from auth.users u where u.id = a.user_id
                           and coalesce(u.raw_app_meta_data ->> 'role', '') = 'admin'))) then
    v_assign := null;
  end if;

  -- Numărul nou: același algoritm ca `nextIssueId` (src/lib/issueId.ts) — cel
  -- mai mare număr din proiectul țintă + 1, minim două cifre. O creare din
  -- client nu ia lacătul de mai sus, deci poate ciocni (23505): se reîncearcă
  -- de până la 3 ori, ca `createIssue`, cu un număr mereu mai mare.
  loop
    v_try := v_try + 1;
    select coalesce(max(substr(i.id, pg_catalog.length(v_dst.prefix) + 2)::numeric), 0) into v_max
      from public.issues i
     where i.project_id = p_target
       and substr(i.id, pg_catalog.length(v_dst.prefix) + 2) ~ '^[0-9]+$';
    v_n := greatest(v_max + 1, v_n + 1);
    v_new := v_dst.prefix || '-' || case when v_n < 10 then '0' || v_n::text else v_n::text end;
    begin
      insert into public.issues
      select * from jsonb_populate_record(null::public.issues,
        to_jsonb(v_old) || jsonb_build_object(
          'id', v_new,
          'project_id', p_target,
          'wave', v_dst.current_wave,
          'theme', null,
          'assignee_id', v_assign));
      exit;
    exception when unique_violation then
      if v_try >= 3 then raise; end if;
    end;
  end loop;

  -- Firul, fișierele (rândurile — octeții rămân pe calea veche, vezi politicile
  -- de mai jos) și vizitele urmează tichetul.
  update public.issue_events set issue_id = v_new, project_id = p_target where issue_id = p_id;
  update public.attachments  set issue_id = v_new, project_id = p_target where issue_id = p_id;
  update public.issue_seen   set issue_id = v_new where issue_id = p_id;

  -- O mutare nu e o ștergere: fără fanionul ăsta, triggerul coșului
  -- (migration-trash.sql) ar pune rândul vechi în coș, iar o „restaurare" ar
  -- fi dublat tichetul. Local tranzacției, scos imediat după.
  perform pg_catalog.set_config('horizontal.trash', 'off', true);
  delete from public.issues where id = p_id;
  perform pg_catalog.set_config('horizontal.trash', '', true);
  return v_new;
end
$fn$;

revoke all on function public.move_issue(text, text) from public;
revoke all on function public.move_issue(text, text) from anon;
grant execute on function public.move_issue(text, text) to authenticated;

-- ── 2. Pozele: al doilea drum de acces ──────────────────────────────────────
-- Obiectele din bucket nu se mută (imuabile, fără politică de update): calea
-- rămâne `vechiulProiect/HZ-12/<uuid>`, iar primul segment devine o etichetă
-- istorică. Accesul îl dă și rândul din `attachments` cu acel `path` (UNIQUE,
-- deci indexat): membru al proiectului RÂNDULUI vede poza, chiar dacă nu e în
-- proiectul din cale. Fără asta, un membru doar al proiectului nou n-ar vedea
-- pozele tichetului mutat. Insert-ul rămâne pe prima regulă: o încărcare nouă
-- se face mereu pe calea proiectului curent.
drop policy if exists attachments_objects_select on storage.objects;
drop policy if exists attachments_objects_delete on storage.objects;

create policy attachments_objects_select on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(objects.name))[1]
        and m.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.attachments a
      join public.project_members m on m.project_id = a.project_id
      where a.path = objects.name
        and m.user_id = (select auth.uid())
    )
  )
);

create policy attachments_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(objects.name))[1]
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
    or exists (
      select 1 from public.attachments a
      join public.project_members m on m.project_id = a.project_id
      where a.path = objects.name
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
  )
);

-- ── 3. fără asta, primul rpc() dă PGRST202 până la următorul reload ────────
notify pgrst, 'reload schema';
