-- supabase/migration-trash.sql
-- Coșul de gunoi pentru tichete. Idempotent; se rulează cu
-- `npm run migrate supabase/migration-trash.sql`, ÎNAINTE de push (clientul
-- cheamă `restore_issue` / `purge_trash` și nu mai șterge pozele singur).
-- Spec: docs/superpowers/specs/2026-10-26-cos-de-gunoi-design.md
-- Teste: `npm run test:trash-sql` (pe un Postgres de unică folosință, NU pe producție).
--
-- Depinde de: migration-notes-access.sql (notes_ok),
-- migration-access.sql (is_admin, project_members),
-- migration-attachments.sql, migration-comments.sql (issue_events, issue_seen,
-- assignees), migration-obstacles.sql, migration-move-issue.sql (re-rulată:
-- `move_issue` pune `horizontal.trash = off` înainte să șteargă rândul vechi).
--
-- Ideea: NU o coloană `deleted_at` pe `issues`. Aceea ar fi cerut un filtru în
-- fiecare cititor al tabelei — pagina, cache-ul offline, `SyncWorker` și
-- widget-ul din APK (care ar fi arătat tichetele șterse până la un APK nou),
-- `functions/api`, `send-reminders`. Aici ștergerea rămâne o ștergere reală;
-- un trigger `before delete` pune deoparte rândul și tot ce ar lua cascada cu
-- el, iar `restore_issue` le pune la loc. Niciun cititor nu se schimbă.

-- ── 1. tabela ───────────────────────────────────────────────────────────────
-- Poze `jsonb` (`to_jsonb(rând)`), nu coloane: o coloană adăugată mâine în
-- `issues` intră singură în poză, iar la restaurare `trash_reinsert` pune doar
-- coloanele care există ACUM (cele noi primesc default-ul lor).
create table if not exists public.issues_trash (
  id          uuid primary key default gen_random_uuid(),
  issue_id    text not null,
  -- Ștergerea proiectului îi golește și coșul: un tichet fără proiect n-are
  -- unde reveni.
  project_id  text not null references public.projects(id) on delete cascade,
  title       text not null,
  deleted_at  timestamptz not null default now(),
  -- null = cheia de serviciu (`functions/api`), ca `created_by`.
  deleted_by  uuid references auth.users(id) on delete set null,
  issue       jsonb not null,
  deps        jsonb not null default '[]'::jsonb,   -- [{issue_id, depends_on_id}], în ambele sensuri
  obstacles   jsonb not null default '[]'::jsonb,   -- [obstacle_id]
  events      jsonb not null default '[]'::jsonb,   -- rândurile din issue_events
  attachments jsonb not null default '[]'::jsonb,   -- rândurile din attachments
  seen        jsonb not null default '[]'::jsonb,   -- rândurile din issue_seen (ale tuturor)
  -- Octeții pozelor rămân în bucket cât stă tichetul în coș; căile stau aici
  -- și ca `storage-report` să nu le ia drept orfani.
  paths       text[] not null default '{}'
);
create index if not exists issues_trash_project_idx on public.issues_trash (project_id, deleted_at desc);
create index if not exists issues_trash_deleted_idx on public.issues_trash (deleted_at);

alter table public.issues_trash enable row level security;
-- Doar citire, pentru membrii proiectului (și admin). Nicio scriere directă:
-- intră prin trigger, ies prin `restore_issue` / `purge_trash`.
drop policy if exists issues_trash_select on public.issues_trash;
create policy issues_trash_select on public.issues_trash for select to authenticated
using ((public.is_admin() or exists (
  select 1 from public.project_members m
   where m.project_id = issues_trash.project_id and m.user_id = (select auth.uid())))
  -- O notiță ștearsă rămâne notiță (migration-notes-access.sql).
  and public.notes_ok(issues_trash.project_id, (issues_trash.issue ->> 'wave')::int));
revoke all on public.issues_trash from anon;
revoke insert, update, delete on public.issues_trash from authenticated;
grant select on public.issues_trash to authenticated;

-- Coada octeților de șters: căile tichetelor scoase definitiv din coș. O
-- golește funcția edge `purge-trash` (Storage API, cheia de serviciu) — un
-- `delete from storage.objects` din SQL ar lăsa octeții în S3.
create table if not exists public.storage_purge (
  path      text primary key,
  queued_at timestamptz not null default now()
);
alter table public.storage_purge enable row level security;
revoke all on public.storage_purge from anon, authenticated;

-- ── 2. vederea pentru ecranul „Coș" ─────────────────────────────────────────
-- Fără poze (pot fi mari) și cu numele celui care a șters. `security_invoker`
-- NU e opțional: fără el vederea ar ocoli RLS-ul de mai sus.
drop view if exists public.trash_rows;
create view public.trash_rows with (security_invoker = on) as
select t.id, t.issue_id, t.project_id, t.title, t.deleted_at, t.deleted_by,
       (select a.name from public.assignees a where a.user_id = t.deleted_by
         order by a.name limit 1) as deleted_by_name
  from public.issues_trash t;
grant select on public.trash_rows to authenticated;

-- ── 3. triggerul ────────────────────────────────────────────────────────────
-- `before delete`: cascada (`on delete cascade` pe dependencies,
-- obstacle_issues, issue_events, attachments, issue_seen) rulează abia DUPĂ,
-- ca trigger de sfârșit de instrucțiune, deci aici copiii încă există — și la
-- o ștergere de mai multe tichete deodată, pentru fiecare.
--
-- Nu pune în coș:
--  · mutarea (`move_issue` șterge rândul vechi după ce i-a mutat copiii):
--    `horizontal.trash = off`, local tranzacției;
--  · ștergerea proiectului: cascada ajunge aici cu proiectul deja dispărut,
--    iar un rând de coș care l-ar referi ar pica pe cheia externă.
create or replace function public.issues_to_trash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if coalesce(pg_catalog.current_setting('horizontal.trash', true), '') = 'off' then
    return old;
  end if;
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;

  insert into public.issues_trash
    (issue_id, project_id, title, deleted_by, issue, deps, obstacles, events, attachments, seen, paths)
  values (
    old.id, old.project_id, old.title, auth.uid(), to_jsonb(old),
    (select coalesce(jsonb_agg(jsonb_build_object('issue_id', d.issue_id, 'depends_on_id', d.depends_on_id)), '[]'::jsonb)
       from public.dependencies d where d.issue_id = old.id or d.depends_on_id = old.id),
    (select coalesce(jsonb_agg(o.obstacle_id), '[]'::jsonb)
       from public.obstacle_issues o where o.issue_id = old.id),
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
       from public.issue_events e where e.issue_id = old.id),
    (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
       from public.attachments a where a.issue_id = old.id),
    (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
       from public.issue_seen s where s.issue_id = old.id),
    (select coalesce(array_agg(a.path order by a.created_at), '{}')
       from public.attachments a where a.issue_id = old.id)
  );
  return old;
end
$fn$;
revoke all on function public.issues_to_trash() from public, anon, authenticated;

drop trigger if exists issues_trash on public.issues;
create trigger issues_trash before delete on public.issues
for each row execute function public.issues_to_trash();

-- ── 4. reinserarea, pe coloanele de AZI ─────────────────────────────────────
-- `insert … select * from jsonb_populate_recordset` ar da NULL (nu default-ul)
-- unei coloane adăugate după ștergere, și ar pica pe un `not null` nou. Aici
-- lista de coloane = coloanele tabelei care apar în poză.
create or replace function public.trash_reinsert(p_table text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cols text;
begin
  if p_rows is null or pg_catalog.jsonb_array_length(p_rows) = 0 then return; end if;
  select string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('public.' || p_table)
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and (p_rows -> 0) ? a.attname;
  execute pg_catalog.format(
    'insert into public.%I (%s) select %s from pg_catalog.jsonb_populate_recordset(null::public.%I, $1)',
    p_table, v_cols, v_cols, p_table) using p_rows;
end
$fn$;
revoke all on function public.trash_reinsert(text, jsonb) from public, anon, authenticated;

-- ── 5. restore_issue ────────────────────────────────────────────────────────
-- Pune tichetul la loc, cu firul, fișierele, vizitele, legăturile cu
-- obstacolele și dependențele — fiecare doar dacă cealaltă parte încă există.
-- Întoarce `{ id, original_id }`: dacă numărul a fost refolosit între timp
-- („cel mai mare + 1" refolosește un număr eliberat), tichetul primește unul
-- nou, cu același algoritm ca `nextIssueId` / `move_issue`.
--
-- Erori (mesajul e cel arătat omului):
--   HZT01 nu mai e în coș / invizibil · HZT02 fără drept de scriere
create or replace function public.restore_issue(p_trash_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_me    uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_t     public.issues_trash;
  v_p     public.projects;
  v_new   text;
  v_max   numeric;
  v_n     numeric := 0;
  v_try   int := 0;
  v_row   jsonb;
  v_ev    jsonb;
  v_at    jsonb;
  v_seen  jsonb;
  v_dep   record;
begin
  if v_me is null and not v_admin then
    raise exception 'Nu ești autentificat.' using errcode = '42501';
  end if;

  select * into v_t from public.issues_trash where id = p_trash_id for update;
  if not found or not (v_admin or exists (
       select 1 from public.project_members m where m.project_id = v_t.project_id and m.user_id = v_me))
     or not public.notes_ok(v_t.project_id, (v_t.issue ->> 'wave')::int) then
    raise exception 'Tichetul nu mai e în coș.' using errcode = 'HZT01';
  end if;

  -- Lacătul pe proiect serializează numerotarea, ca la `move_issue`.
  select * into v_p from public.projects where id = v_t.project_id for update;
  if not (v_admin or exists (select 1 from public.project_members m
            where m.project_id = v_p.id and m.user_id = v_me and m.role = 'write')) then
    raise exception 'Nu ai drept de editare în proiectul „%".', v_p.name using errcode = 'HZT02';
  end if;

  -- Rândul, cu ce s-a schimbat în jur cât a stat în coș.
  v_row := v_t.issue;
  -- Valul șters între timp → valul activ. (Notițele, 0, au și ele rând în `waves`.)
  if not exists (select 1 from public.waves w
                  where w.project_id = v_p.id and w.number = (v_row ->> 'wave')::int) then
    v_row := v_row || jsonb_build_object('wave', v_p.current_wave);
  end if;
  if v_row ->> 'theme' is not null and not exists (select 1 from public.themes th
                  where th.project_id = v_p.id and th.key = v_row ->> 'theme') then
    v_row := v_row || jsonb_build_object('theme', null);
  end if;
  if v_row ? 'assignee_id' and v_row ->> 'assignee_id' is not null and not exists (
       select 1 from public.assignees a where a.id = (v_row ->> 'assignee_id')::uuid) then
    v_row := v_row || jsonb_build_object('assignee_id', null);
  end if;
  if v_row ? 'created_by' and v_row ->> 'created_by' is not null and not exists (
       select 1 from auth.users u where u.id = (v_row ->> 'created_by')::uuid) then
    v_row := v_row || jsonb_build_object('created_by', null);
  end if;
  -- Un memento care a trecut cât a stat în coș NU sună la restaurare (ar suna
  -- pe loc pe toate dispozitivele, ca o scadență trecută din `functions/api`).
  if v_row ? 'remind_at' and v_row ->> 'remind_at' is not null
     and (v_row ->> 'remind_at')::timestamptz <= pg_catalog.now()
     and v_row ? 'reminder_sent_at' and v_row ->> 'reminder_sent_at' is null then
    v_row := v_row || jsonb_build_object('reminder_sent_at', pg_catalog.now());
  end if;

  -- Numărul: cel vechi dacă e liber, altfel cel mai mare + 1 (minim două
  -- cifre). O creare din client nu ia lacătul, deci 23505 → încă o dată.
  v_new := v_t.issue_id;
  loop
    v_try := v_try + 1;
    if v_try > 1 or exists (select 1 from public.issues where id = v_new) then
      select coalesce(max(substr(i.id, pg_catalog.length(v_p.prefix) + 2)::numeric), 0) into v_max
        from public.issues i
       where i.project_id = v_p.id
         and substr(i.id, pg_catalog.length(v_p.prefix) + 2) ~ '^[0-9]+$';
      v_n := greatest(v_max + 1, v_n + 1);
      v_new := v_p.prefix || '-' || case when v_n < 10 then '0' || v_n::text else v_n::text end;
    end if;
    begin
      perform public.trash_reinsert('issues', jsonb_build_array(v_row || jsonb_build_object('id', v_new)));
      exit;
    exception when unique_violation then
      if v_try >= 4 then raise; end if;
    end;
  end loop;

  -- Firul: autorul / persoanele dispărute între timp devin null (ca `on delete
  -- set null`).
  select coalesce(jsonb_agg(e || jsonb_build_object(
           'issue_id', v_new,
           'author_id', case when exists (select 1 from auth.users u where u.id::text = e ->> 'author_id') then e -> 'author_id' else 'null'::jsonb end,
           'handoff_from', case when exists (select 1 from public.assignees a where a.id::text = e ->> 'handoff_from') then e -> 'handoff_from' else 'null'::jsonb end,
           'handoff_to', case when exists (select 1 from public.assignees a where a.id::text = e ->> 'handoff_to') then e -> 'handoff_to' else 'null'::jsonb end)), '[]'::jsonb)
    into v_ev
    from pg_catalog.jsonb_array_elements(v_t.events) e
   where not exists (select 1 from public.issue_events x where x.id::text = e ->> 'id');
  perform public.trash_reinsert('issue_events', v_ev);

  -- Fișierele: rândurile revin, octeții n-au plecat niciodată.
  select coalesce(jsonb_agg(a || jsonb_build_object(
           'issue_id', v_new,
           'event_id', case when exists (select 1 from public.issue_events x where x.id::text = a ->> 'event_id') then a -> 'event_id' else 'null'::jsonb end)), '[]'::jsonb)
    into v_at
    from pg_catalog.jsonb_array_elements(v_t.attachments) a
   where not exists (select 1 from public.attachments x where x.id::text = a ->> 'id' or x.path = a ->> 'path');
  perform public.trash_reinsert('attachments', v_at);

  select coalesce(jsonb_agg(s || jsonb_build_object('issue_id', v_new)), '[]'::jsonb)
    into v_seen
    from pg_catalog.jsonb_array_elements(v_t.seen) s
   where exists (select 1 from auth.users u where u.id::text = s ->> 'user_id');
  perform public.trash_reinsert('issue_seen', v_seen);

  insert into public.obstacle_issues (obstacle_id, issue_id)
  select o #>> '{}', v_new
    from pg_catalog.jsonb_array_elements(v_t.obstacles) o
   where exists (select 1 from public.obstacles ob where ob.id = o #>> '{}')
  on conflict do nothing;

  -- Dependențele: numai spre / dinspre tichete care încă există, și numai dacă
  -- muchia n-ar închide un ciclu cu ce s-a legat între timp.
  for v_dep in
    select case when d ->> 'issue_id' = v_t.issue_id then v_new else d ->> 'issue_id' end as a,
           case when d ->> 'depends_on_id' = v_t.issue_id then v_new else d ->> 'depends_on_id' end as b
      from pg_catalog.jsonb_array_elements(v_t.deps) d
  loop
    continue when v_dep.a = v_dep.b;
    continue when not exists (select 1 from public.issues where id = v_dep.a)
               or not exists (select 1 from public.issues where id = v_dep.b);
    -- a depinde de b: ciclu dacă b ajunge deja la a.
    continue when exists (
      with recursive reach(id) as (
        select v_dep.b
        union
        select dd.depends_on_id from public.dependencies dd join reach r on dd.issue_id = r.id
      ) select 1 from reach where id = v_dep.a);
    insert into public.dependencies (issue_id, depends_on_id) values (v_dep.a, v_dep.b)
    on conflict do nothing;
  end loop;

  delete from public.issues_trash where id = v_t.id;
  return jsonb_build_object('id', v_new, 'original_id', v_t.issue_id);
end
$fn$;
revoke all on function public.restore_issue(uuid) from public, anon;
grant execute on function public.restore_issue(uuid) to authenticated;

-- ── 6. purge_trash: „Șterge definitiv" ──────────────────────────────────────
create or replace function public.purge_trash(p_trash_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_me    uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_t     public.issues_trash;
begin
  if v_me is null and not v_admin then
    raise exception 'Nu ești autentificat.' using errcode = '42501';
  end if;
  select * into v_t from public.issues_trash where id = p_trash_id for update;
  if not found or not (v_admin or exists (
       select 1 from public.project_members m where m.project_id = v_t.project_id and m.user_id = v_me))
     or not public.notes_ok(v_t.project_id, (v_t.issue ->> 'wave')::int) then
    raise exception 'Tichetul nu mai e în coș.' using errcode = 'HZT01';
  end if;
  if not (v_admin or exists (select 1 from public.project_members m
            where m.project_id = v_t.project_id and m.user_id = v_me and m.role = 'write')) then
    raise exception 'Nu ai drept de editare în acest proiect.' using errcode = 'HZT02';
  end if;
  insert into public.storage_purge (path) select unnest(v_t.paths) on conflict do nothing;
  delete from public.issues_trash where id = v_t.id;
end
$fn$;
revoke all on function public.purge_trash(uuid) from public, anon;
grant execute on function public.purge_trash(uuid) to authenticated;

-- ── 7. expirarea: 30 de zile ────────────────────────────────────────────────
-- Doar cheia de serviciu (funcția edge `purge-trash`, chemată de cron). Întoarce
-- câte tichete au ieșit; căile lor intră în `storage_purge`.
create or replace function public.purge_expired_trash(p_days int default 30)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n int;
begin
  insert into public.storage_purge (path)
  select unnest(t.paths) from public.issues_trash t
   where t.deleted_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
  on conflict do nothing;
  delete from public.issues_trash t
   where t.deleted_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke all on function public.purge_expired_trash(int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_expired_trash(int) to service_role;
    grant select, delete on public.storage_purge to service_role;
  end if;
end $$;

-- ── 8. cronul: o dată pe zi, prin funcția edge ──────────────────────────────
-- Ca `send-reminders` (migration-cron.sql), cu aceleași secrete din Vault.
-- Sărit dacă pg_cron/pg_net nu există (testul pe Postgres de unică folosință).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('purge-trash') where exists (select 1 from cron.job where jobname = 'purge-trash');
    perform cron.schedule('purge-trash', '17 3 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-trash',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$);
  else
    raise notice 'pg_cron/pg_net lipsesc: expirarea coșului nu e programată.';
  end if;
end $$;

-- ── 9. fără asta, primul rpc() dă PGRST202 până la următorul reload ────────
notify pgrst, 'reload schema';
