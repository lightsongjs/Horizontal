-- supabase/migration-comments.sql
-- Fir de comentarii + pase pe tichete. Idempotent; se rulează cu
-- `npm run migrate supabase/migration-comments.sql`.
-- Vezi docs/superpowers/specs/2026-09-17-comentarii-si-pasare-design.md

-- ── 0. cheia compusă (o creează și migration-attachments.sql) ───────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'issues_id_project_key') then
    alter table public.issues add constraint issues_id_project_key unique (id, project_id);
  end if;
end $$;

-- ── 1. assignees: poate lipsi (a fost creată în dashboard) ──────────────────
do $$ begin
  if to_regclass('public.assignees') is null then
    create table public.assignees (id uuid primary key default gen_random_uuid(), name text not null);
  end if;
end $$;

alter table public.assignees add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists assignees_user_idx on public.assignees(user_id) where user_id is not null;

alter table public.assignees enable row level security;
-- Politica veche se numește „authenticated full access" și e using(true)/check(true).
-- Cât timp rândurile erau doar nume, n-a contat; de când poartă user_id, oricine
-- ar putea revendica rândul altuia.
drop policy if exists "authenticated full access" on public.assignees;
drop policy if exists assignees_select on public.assignees;
drop policy if exists assignees_write  on public.assignees;
create policy assignees_select on public.assignees for select to authenticated using (true);
create policy assignees_write on public.assignees for all to authenticated
using      (public.is_admin() or user_id is null or user_id = (select auth.uid()))
with check (public.is_admin() or user_id is null or user_id = (select auth.uid()));

-- ── 2. issues: proveniența, plus assignee_id dacă lipsește ──────────────────
do $$
declare t text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.assignees'::regclass and a.attname = 'id' and not a.attisdropped;
  if t is null then raise exception 'assignees.id lipseste'; end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.issues'::regclass and attname = 'assignee_id' and not attisdropped) then
    execute format('alter table public.issues add column assignee_id %s references public.assignees(id) on delete set null', t);
  end if;
end $$;

alter table public.issues add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.issues add column if not exists created_at timestamptz not null default now();

-- ── 3. issue_events ─────────────────────────────────────────────────────────
create table if not exists public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id   text not null,
  project_id text not null,
  kind       text not null check (kind in ('comment','handoff')),
  author_id  uuid references auth.users(id) on delete set null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

do $$
declare t text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.assignees'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format('alter table public.issue_events add column if not exists handoff_from %s', t);
  execute format('alter table public.issue_events add column if not exists handoff_to   %s', t);

  if not exists (select 1 from pg_constraint where conname = 'issue_events_hf_fkey') then
    alter table public.issue_events add constraint issue_events_hf_fkey
      foreign key (handoff_from) references public.assignees(id) on delete set null; end if;
  if not exists (select 1 from pg_constraint where conname = 'issue_events_ht_fkey') then
    alter table public.issue_events add constraint issue_events_ht_fkey
      foreign key (handoff_to) references public.assignees(id) on delete set null; end if;
  if not exists (select 1 from pg_constraint where conname = 'issue_events_issue_fkey') then
    alter table public.issue_events add constraint issue_events_issue_fkey
      foreign key (issue_id, project_id) references public.issues (id, project_id) on delete cascade; end if;
  -- „Un gest, două rânduri" ținut de bază, nu de proză: un rând hibrid
  -- (comentariu CU handoff_to) ar fi altfel perfect legal.
  if not exists (select 1 from pg_constraint where conname = 'issue_events_shape_chk') then
    alter table public.issue_events add constraint issue_events_shape_chk
      check ((kind = 'comment' and handoff_from is null and handoff_to is null)
          or (kind = 'handoff' and body = '')); end if;
end $$;

create index if not exists issue_events_thread_idx on public.issue_events (issue_id, created_at);
create index if not exists issues_assignee_idx on public.issues (assignee_id) where assignee_id is not null;

-- ── 4. issue_seen ───────────────────────────────────────────────────────────
create table if not exists public.issue_seen (
  user_id  uuid not null references auth.users(id) on delete cascade,
  issue_id text not null references public.issues(id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (user_id, issue_id)
);

-- `markSeen` din client nu trimite `user_id` — baza îl completează, nu RLS.
-- RLS filtrează/validează rânduri, nu poate suplini o coloană NOT NULL lipsă
-- dintr-un INSERT. `(select auth.uid())` NU e valid într-un DEFAULT (nu se
-- admit subinterogări acolo) — de-aia forma simplă, fără `select`.
alter table public.issue_seen alter column user_id set default auth.uid();

-- ── 5. attachments.event_id ─────────────────────────────────────────────────
-- `set null`, nu `cascade`: ștergerea unui comentariu întoarce fișierul la
-- tichet în loc să-l lase orfan în bucket.
do $$ begin
  if to_regclass('public.attachments') is null then
    raise notice 'attachments lipseste: ruleaza intai migration-attachments.sql';
  else
    alter table public.attachments add column if not exists event_id uuid references public.issue_events(id) on delete set null;
    create index if not exists attachments_event_idx on public.attachments (event_id) where event_id is not null;
  end if;
end $$;

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
alter table public.issue_events enable row level security;
alter table public.issue_seen   enable row level security;

drop policy if exists events_select on public.issue_events;
drop policy if exists events_insert on public.issue_events;
drop policy if exists events_update on public.issue_events;
drop policy if exists events_delete on public.issue_events;

create policy events_select on public.issue_events for select to authenticated
using (public.is_admin() or exists (select 1 from public.project_members m
  where m.project_id = issue_events.project_id and m.user_id = (select auth.uid())));

-- is_admin() NU apare aici: nici adminul nu semnează cu numele altuia.
create policy events_insert on public.issue_events for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (public.is_admin() or exists (select 1 from public.project_members m
        where m.project_id = issue_events.project_id
          and m.user_id = (select auth.uid()) and m.role = 'write'))
);

-- kind + author_id în AMBELE clauze: `using` alege rândul, `with check`
-- împiedică mutarea lui în afara zonei proprii.
create policy events_update on public.issue_events for update to authenticated
using      (kind = 'comment' and author_id = (select auth.uid()))
with check (kind = 'comment' and author_id = (select auth.uid()));

-- is_admin() la delete: notele migrate au author_id null, deci fără el nimeni
-- nu le-ar mai putea șterge vreodată.
create policy events_delete on public.issue_events for delete to authenticated
using (kind = 'comment' and (author_id = (select auth.uid()) or public.is_admin()));

drop policy if exists seen_select on public.issue_seen;
drop policy if exists seen_write  on public.issue_seen;
create policy seen_select on public.issue_seen for select to authenticated
using (user_id = (select auth.uid()));
create policy seen_write on public.issue_seen for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── 7. restrângerea updateului la o coloană ─────────────────────────────────
-- RLS alege RÂNDURI, nu coloane. Două mecanisme, deliberat amândouă:
-- (a) privilegiul de coloană se aplică ÎNAINTEA RLS;
-- (b) triggerul supraviețuiește unui `grant all on all tables ...`, linie care
--     apare în jumătate din exemplele Supabase și ar șterge tăcut punctul (a).
revoke update on public.issue_events from authenticated;
grant  update (body) on public.issue_events to authenticated;

create or replace function public.issue_events_guard() returns trigger
language plpgsql security invoker set search_path = '' as $g$
begin
  -- `on delete set null` de pe author_id/handoff_* face RI să emită UPDATE ca
  -- OWNER. Fără scurtătura asta, ștergerea unui cont sau a unui assignee ar
  -- eșua. Garda e pentru aplicație, nu pentru bază.
  if pg_catalog.current_user <> 'authenticated' then return new; end if;
  if old.kind = 'handoff' then
    raise exception 'o pasa nu se editeaza' using errcode = '42501';
  end if;
  if new.id           is distinct from old.id
  or new.issue_id     is distinct from old.issue_id
  or new.project_id   is distinct from old.project_id
  or new.kind         is distinct from old.kind
  or new.author_id    is distinct from old.author_id
  or new.created_at   is distinct from old.created_at
  or new.handoff_from is distinct from old.handoff_from
  or new.handoff_to   is distinct from old.handoff_to then
    raise exception 'doar body se poate modifica' using errcode = '42501';
  end if;
  new.edited_at := case when new.body is distinct from old.body
                        then pg_catalog.now() else old.edited_at end;
  return new;
end $g$;

drop trigger if exists issue_events_guard_trg on public.issue_events;
create trigger issue_events_guard_trg before update on public.issue_events
for each row execute function public.issue_events_guard();

-- NU există trigger care să interzică ȘTERGEREA paselor, deși regula e „nu se
-- șterg niciodată": `on delete cascade` de la issues declanșează triggerele de
-- rând, iar un raise acolo ar face ștergerea unui tichet imposibilă. Regula o
-- ține politica events_delete.

-- ── 8. post_to_thread ───────────────────────────────────────────────────────
drop function if exists public.post_to_thread(text,text,text,boolean,text,uuid[]);

create or replace function public.post_to_thread(
  p_issue_id       text,
  p_project_id     text,
  p_body           text    default '',
  p_handoff        boolean default false,
  p_to             text    default null,
  p_attachment_ids uuid[]  default '{}'
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $fn$
declare
  v_me uuid := (select auth.uid());
  v_prev text; v_ids uuid[] := '{}'; v_id uuid;
  v_att boolean := false; v_rows int;
  v_events jsonb; v_issue jsonb;
begin
  if v_me is null then raise exception 'fara sesiune' using errcode = '42501'; end if;

  if coalesce(array_length(p_attachment_ids, 1), 0) > 0 then
    select exists (select 1 from public.attachments a
                    where a.id = any(p_attachment_ids)
                      and a.issue_id = p_issue_id and a.event_id is null) into v_att;
  end if;

  if nullif(btrim(p_body), '') is not null or v_att then
    insert into public.issue_events (issue_id, project_id, kind, author_id, body)
    values (p_issue_id, p_project_id, 'comment', v_me, coalesce(btrim(p_body), ''))
    returning id into v_id;
    v_ids := v_ids || v_id;
    update public.attachments a set event_id = v_id
     where a.id = any(p_attachment_ids) and a.issue_id = p_issue_id and a.event_id is null;
  end if;

  if p_handoff then
    -- `for update` NU pentru lost update (last-write-wins ar fi acceptabil), ci
    -- fiindcă două pase simultane ar scrie două rânduri cu același handoff_from
    -- — istoric fals, nu doar stare pierdută.
    select i.assignee_id::text into v_prev
      from public.issues i
     where i.id = p_issue_id and i.project_id = p_project_id
     for update;
    if not found then
      raise exception 'tichet inexistent sau invizibil: %', p_issue_id using errcode = '42501';
    end if;

    if v_prev is distinct from p_to then
      -- `p_to` e `text` (parametrul funcției nu se schimbă — vezi comentariul
      -- de la semnătură), dar `assignee_id` e `uuid`: Postgres nu aplică un
      -- cast de atribuire text -> uuid, deci fără cast explicit aici pica cu
      -- „column assignee_id is of type uuid but expression is of type text".
      update public.issues i set assignee_id = p_to::uuid
       where i.id = p_issue_id and i.project_id = p_project_id;
      get diagnostics v_rows = row_count;
      -- Un UPDATE filtrat de RLS nu dă eroare, dă zero rânduri: fără asta, un
      -- membru cu rol `read` ar primi „pasă trimisă" fără nicio pasă.
      if v_rows = 0 then
        raise exception 'fara drept de scriere pe %', p_project_id using errcode = '42501';
      end if;
      -- Același motiv: handoff_from/handoff_to sunt uuid, v_prev/p_to sunt text.
      insert into public.issue_events (issue_id, project_id, kind, author_id, body, handoff_from, handoff_to)
      values (p_issue_id, p_project_id, 'handoff', v_me, '', v_prev::uuid, p_to::uuid)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
  end if;

  -- Cine scrie în fir, l-a și citit.
  insert into public.issue_seen (user_id, issue_id, seen_at)
  values (v_me, p_issue_id, pg_catalog.now())
  on conflict (user_id, issue_id) do update set seen_at = pg_catalog.now();

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    into v_events from public.issue_events e where e.id = any(v_ids);
  select to_jsonb(i) into v_issue
    from public.issues i where i.id = p_issue_id and i.project_id = p_project_id;
  return jsonb_build_object('events', v_events, 'issue', v_issue);
end $fn$;

revoke all on function public.post_to_thread(text,text,text,boolean,text,uuid[]) from public;
grant execute on function public.post_to_thread(text,text,text,boolean,text,uuid[]) to authenticated;

-- ── 9. inbox_rows ───────────────────────────────────────────────────────────
drop view if exists public.inbox_rows;
-- `security_invoker = on` NU e opțional: fără el vederea rulează ca
-- proprietarul ei și publică inboxul fiecărui proiect către oricine.
create view public.inbox_rows with (security_invoker = on) as
select i.id as issue_id, i.project_id, i.title, i.done, i.due_at, i.assignee_id,
       e.created_at as last_event_at,
       f.created_at as last_foreign_at,
       f.author_id  as last_foreign_author,
       s.seen_at
  from public.issues i
  left join lateral (
    select ev.created_at from public.issue_events ev
     where ev.issue_id = i.id order by ev.created_at desc limit 1) e on true
  left join lateral (
    select ev.created_at, ev.author_id from public.issue_events ev
     where ev.issue_id = i.id and ev.author_id is distinct from (select auth.uid())
     order by ev.created_at desc limit 1) f on true
  left join public.issue_seen s
    on s.user_id = (select auth.uid()) and s.issue_id = i.id
 where i.assignee_id is not null
   and i.assignee_id = (select a.id from public.assignees a where a.user_id = (select auth.uid()));

grant select on public.inbox_rows to authenticated;

-- ── 10. notes -> primul comentariu ──────────────────────────────────────────
-- Id determinist = idempotență reală. O cheie pe `body` s-ar rupe în clipa în
-- care cineva editează comentariul migrat, și nota s-ar re-insera.
do $$ begin
  if exists (select 1 from pg_attribute
              where attrelid = 'public.issues'::regclass and attname = 'notes' and not attisdropped) then
    insert into public.issue_events (id, issue_id, project_id, kind, author_id, body, created_at)
    select md5('notes:' || i.id)::uuid, i.id, i.project_id, 'comment', null, i.notes, i.created_at
      from public.issues i
     where coalesce(btrim(i.notes), '') <> ''
    on conflict (id) do nothing;
  end if;
end $$;
-- ATENȚIE: `drop column notes` e INTERZIS. Coloana rămâne ca plasă și fiindcă
-- functions/api/ o expune în contractul public al ticket-kit.

-- ── 11. fără asta, primul rpc() dă PGRST202 până la următorul reload ────────
notify pgrst, 'reload schema';
