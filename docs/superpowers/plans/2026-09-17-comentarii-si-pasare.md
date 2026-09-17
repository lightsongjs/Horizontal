# Comentarii, creator și pasarea tichetelor — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un tichet arată cine l-a creat, are un fir de comentarii cu atașamente,
și se poate pasa explicit de la un om la altul — cu un ecran „Pe mine" care
adună doar ce ți-a pasat cineva.

**Architecture:** O tabelă append-only `issue_events` ține și comentariile, și
pasele, într-o singură citire cronologică. Scrierea trece printr-o funcție
Postgres `post_to_thread` (o tranzacție: comentariu + pasă + marcaj de citit),
fiindcă trei apeluri separate pot reuși pe jumătate. Atașamentele refolosesc
tabela și bucketul existente printr-o singură coloană `event_id`. Logica pură
(necitit, grupare) stă în `src/lib/thread.ts`, testabilă fără DOM, ca
`engine.ts`.

**Tech Stack:** React 18 + TypeScript + Vite, Supabase (Postgres + RLS +
PostgREST + Storage), vitest, Playwright pentru teste de layout și navigare.

**Spec:** `docs/superpowers/specs/2026-09-17-comentarii-si-pasare-design.md` —
citește-l înainte de prima sarcină; planul argumentează din el.

## Global Constraints

- **Push pe `master` = publicare în producție.** Nu face push „ca să vezi dacă
  merge". Înainte de orice push: `npm test` și `npm run typecheck`.
- **Nu se atinge** `src/sw.ts`, `src/pwa.ts`, blocul VitePWA din
  `vite.config.ts`. Dacă ajungi să le atingi, ai greșit drumul; oprește-te.
- **Nu se atinge** `functions/api/` — `notes` e contract public pentru
  `ticket-kit/ai-client.mjs`, repo git separat.
- **Nu se atinge** `src/lib/engine.ts` (`computeLayers`) și
  `src/lib/obstacles.ts`. Layerul nu se mișcă la nicio pasă.
- **`drop column notes` este interzis** în orice migrare din planul ăsta.
- **Regula centrală:** `assignee_id` gol = al creatorului. `assignee_id` pus =
  pasat cuiva. Nimic nu atribuie automat un tichet cuiva.
- **Sistemul vizual „Scholarly Editorial":** fără chenare de 1px pe blocuri
  (excepție: câmpurile de input), serif pentru limbă / mono pentru cifre, un
  singur accent, stare activă = text plin + linie de 2px (niciodată casetă
  umplută sau gradient), iconițe din `src/components/Icon.tsx`, nu emoji.
  Raze doar `--r-s` 6px / `--r-m` 10px / `--r` 16px.
- **Migrările sunt idempotente** și rulează ca un singur query
  (`scripts/apply-migration.mjs`), deci o singură tranzacție: nimic
  `create index concurrently`.
- Commit după fiecare sarcină. Mesaje în română, prefix convențional
  (`feat(fir):`, `fix(...)`, `test(...)`).

---

### Task 1: Migrarea SQL

**Files:**
- Create: `supabase/migration-comments.sql`
- Create: `scripts/check-comments-migration.mjs` (verificare, se șterge la final)

**Interfaces:**
- Consumes: nimic.
- Produces: tabelele `issue_events`, `issue_seen`; coloanele `assignees.user_id`,
  `issues.created_by`, `issues.created_at`, `attachments.event_id`; funcția
  `public.post_to_thread(text,text,text,boolean,text,uuid[]) returns jsonb`;
  vederea `public.inbox_rows`; triggerul `issue_events_guard_trg`.

- [ ] **Step 1: Citește tiparul casei**

Citește `supabase/migration-attachments.sql` în întregime. Reține trei lucruri
pe care le vei repeta: blocurile `do $$ ... end $$` cu `if not exists`,
`drop policy if exists` înaintea fiecărei politici, și calificarea `public.` pe
`is_admin()` și `project_members` (fără ea: „function is_admin() does not
exist", fiindcă `is_admin()` e declarat cu `set search_path = ''`).

- [ ] **Step 2: Scrie migrarea, în ordinea asta**

Ordinea contează: fiecare pas presupune că cel dinainte a rulat.

```sql
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
      update public.issues i set assignee_id = p_to
       where i.id = p_issue_id and i.project_id = p_project_id;
      get diagnostics v_rows = row_count;
      -- Un UPDATE filtrat de RLS nu dă eroare, dă zero rânduri: fără asta, un
      -- membru cu rol `read` ar primi „pasă trimisă" fără nicio pasă.
      if v_rows = 0 then
        raise exception 'fara drept de scriere pe %', p_project_id using errcode = '42501';
      end if;
      insert into public.issue_events (issue_id, project_id, kind, author_id, body, handoff_from, handoff_to)
      values (p_issue_id, p_project_id, 'handoff', v_me, '', v_prev, p_to)
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

- [ ] **Step 3: Rulează migrarea**

```bash
npm run migrate supabase/migration-comments.sql
```

Expected: fără eroare. Un `notice` despre `attachments` ar însemna că lipsește
`migration-attachments.sql` — rulează-l întâi.

- [ ] **Step 4: Verifică ce s-a creat**

Scrie `scripts/check-comments-migration.mjs` (îl ștergi la Step 6). Folosește
`pg` cu parametri **separați**, nu `connectionString` — parola conține `@` și
sparge URL-ul:

```js
import pg from 'pg'
import { config } from 'dotenv'
config()
const c = new pg.Client({
  host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE, user: process.env.PG_USER,
  password: process.env.PG_PASSWORD, ssl: { rejectUnauthorized: false },
})
await c.connect()
const q = async (label, sql) => console.log(label, (await c.query(sql)).rows)
await q('tabele:', `select table_name from information_schema.tables
  where table_schema='public' and table_name in ('issue_events','issue_seen')`)
await q('coloane noi:', `select table_name, column_name from information_schema.columns
  where table_schema='public' and (
    (table_name='assignees'   and column_name='user_id') or
    (table_name='issues'      and column_name in ('created_by','created_at')) or
    (table_name='attachments' and column_name='event_id'))`)
await q('handoff types:', `select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='issue_events' and column_name like 'handoff%'`)
await q('functie:', `select proname from pg_proc where proname='post_to_thread'`)
await q('vedere invoker:', `select relname, reloptions from pg_class where relname='inbox_rows'`)
await q('politici:', `select tablename, policyname from pg_policies
  where tablename in ('issue_events','issue_seen','assignees') order by tablename, policyname`)
await q('note migrate:', `select count(*) from issue_events where author_id is null and kind='comment'`)
await c.end()
```

Run: `node scripts/check-comments-migration.mjs`

Expected: ambele tabele; cele patru coloane noi; `handoff_from`/`handoff_to` de
tip `uuid`; `post_to_thread`; `reloptions` al vederii conține
`security_invoker=on`; politicile `events_*`, `seen_*`, `assignees_*`; **266**
note migrate.

- [ ] **Step 5: Rulează migrarea a doua oară**

```bash
npm run migrate supabase/migration-comments.sql && node scripts/check-comments-migration.mjs
```

Expected: fără eroare, și **tot 266** note migrate — nu 532. Dacă s-au dublat,
cheia deterministă `md5('notes:'||id)::uuid` nu se aplică; oprește-te și
repar-o înainte să mergi mai departe.

- [ ] **Step 6: Șterge scriptul și commit**

```bash
rm scripts/check-comments-migration.mjs
git add supabase/migration-comments.sql
git commit -m "feat(fir): migrarea pentru comentarii, pase si necitite"
```

---

### Task 2: Tipuri + logica pură a firului

**Files:**
- Modify: `src/lib/types.ts` (adaugă la final)
- Create: `src/lib/thread.ts`
- Test: `src/lib/thread.test.ts`

**Interfaces:**
- Consumes: nimic (tipuri noi, funcții pure).
- Produces: `IssueEvent`, `InboxRow`, `isUnread`, `groupInbox`.

- [ ] **Step 1: Adaugă tipurile**

În `src/lib/types.ts`, după `Obstacle`:

```ts
/**
 * Un eveniment din firul unui tichet. Append-only: comentariile se pot edita
 * (doar `body`), pasele niciodată. `kind` le ține în aceeași tabelă fiindcă se
 * citesc împreună, cronologic — vezi specul.
 */
export interface IssueEvent {
  id: string
  issueId: string
  projectId: string
  kind: 'comment' | 'handoff'
  /** Contul care a scris. `null` = notă migrată din vechiul câmp `notes`. */
  authorId: string | null
  body: string
  /** Doar pe `kind: 'handoff'`. Assignee-ul de dinainte, `null` = nepasat. */
  handoffFrom: string | null
  /** Doar pe `kind: 'handoff'`. `null` = „către nimeni", adică luat înapoi. */
  handoffTo: string | null
  createdAt: string
  editedAt: string | null
}

/**
 * Un rând din cutia de pase. Nu poartă firul, doar cele două momente din care
 * se decide bulina de necitit — altfel fiecare rând ar trage după el zeci de
 * evenimente.
 */
export interface InboxRow {
  issueId: string
  projectId: string
  title: string
  done: boolean
  assigneeId: string | null
  /** Ultimul eveniment, al oricui. Dă ordinea listei. */
  lastEventAt: string | null
  /** Ultimul eveniment care NU e al meu. Dă bulina. */
  lastForeignAt: string | null
  /** Autorul ultimului eveniment străin — „de la Alex" de pe rând. E un id de
   *  cont (`auth.users`), deci se mapează la un nume prin `assignees.userId`. */
  lastForeignAuthor: string | null
  seenAt: string | null
}
```

- [ ] **Step 2: Scrie testul care pică**

`src/lib/thread.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupInbox, isUnread } from './thread'
import type { InboxRow, IssueEvent } from './types'

const ev = (patch: Partial<IssueEvent>): IssueEvent => ({
  id: 'e1', issueId: 'T-1', projectId: 'p', kind: 'comment',
  authorId: 'u1', body: '', handoffFrom: null, handoffTo: null,
  createdAt: '2026-09-17T10:00:00.000Z', editedAt: null, ...patch,
})
const row = (patch: Partial<InboxRow>): InboxRow => ({
  issueId: 'T-1', projectId: 'p', title: 'T', done: false, assigneeId: 'a1',
  lastEventAt: null, lastForeignAt: null, lastForeignAuthor: null, seenAt: null, ...patch,
})

describe('isUnread', () => {
  it('e necitit când altcineva a scris după ultima mea vizită', () => {
    expect(isUnread('2026-09-17T12:00:00Z', '2026-09-17T10:00:00Z')).toBe(true)
  })
  it('e citit când vizita e mai nouă', () => {
    expect(isUnread('2026-09-17T10:00:00Z', '2026-09-17T12:00:00Z')).toBe(false)
  })
  it('e necitit când n-am vizitat niciodată', () => {
    expect(isUnread('2026-09-17T10:00:00Z', null)).toBe(true)
  })
  // Regula care contează: lastForeignAt EXCLUDE deja evenimentele mele, deci
  // propriul comentariu nu poate aprinde bulina.
  it('e citit când nimeni străin n-a scris', () => {
    expect(isUnread(null, null)).toBe(false)
  })
})

describe('groupInbox', () => {
  it('desparte necititele de restul, cele mai noi întâi', () => {
    const rows = [
      row({ issueId: 'A', lastEventAt: '2026-09-10T10:00:00Z', lastForeignAt: '2026-09-10T10:00:00Z', seenAt: '2026-09-11T10:00:00Z' }),
      row({ issueId: 'B', lastEventAt: '2026-09-17T10:00:00Z', lastForeignAt: '2026-09-17T10:00:00Z', seenAt: null }),
      row({ issueId: 'C', lastEventAt: '2026-09-16T10:00:00Z', lastForeignAt: '2026-09-16T10:00:00Z', seenAt: null }),
    ]
    const { fresh, rest } = groupInbox(rows)
    expect(fresh.map((r) => r.issueId)).toEqual(['B', 'C'])
    expect(rest.map((r) => r.issueId)).toEqual(['A'])
  })
  it('scoate tichetele bifate', () => {
    const { fresh, rest } = groupInbox([row({ issueId: 'D', done: true, lastForeignAt: '2026-09-17T10:00:00Z' })])
    expect(fresh).toEqual([])
    expect(rest).toEqual([])
  })
})
```

- [ ] **Step 3: Rulează testul, verifică că pică**

Run: `npx vitest run src/lib/thread.test.ts`
Expected: FAIL — `Failed to resolve import "./thread"`.

- [ ] **Step 4: Scrie implementarea minimă**

`src/lib/thread.ts`:

```ts
// Logica pură a firului. Fără DOM, fără rețea — ca engine.ts și schedule.ts.
import type { InboxRow, IssueEvent } from './types'

/**
 * `lastForeignAt` e deja filtrat de evenimentele mele (vine din `inbox_rows`),
 * deci regula „propriul comentariu nu aprinde bulina" e ținută de sursă, nu
 * repetată aici. `null` = nimeni străin n-a scris niciodată.
 */
export function isUnread(lastForeignAt: string | null, seenAt: string | null): boolean {
  if (!lastForeignAt) return false
  if (!seenAt) return true
  return lastForeignAt > seenAt
}

/**
 * „Necitite" / „Mai devreme". Bifatele nu apar deloc: cutia de pase e o listă
 * de treabă rămasă, nu un istoric.
 */
export function groupInbox(rows: readonly InboxRow[]): { fresh: InboxRow[]; rest: InboxRow[] } {
  const open = rows.filter((r) => !r.done)
  const byRecency = [...open].sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''))
  return {
    fresh: byRecency.filter((r) => isUnread(r.lastForeignAt, r.seenAt)),
    rest: byRecency.filter((r) => !isUnread(r.lastForeignAt, r.seenAt)),
  }
}
```

- [ ] **Step 5: Rulează testele**

Run: `npx vitest run src/lib/thread.test.ts && npm run typecheck`
Expected: PASS, fără erori de tip.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/thread.ts src/lib/thread.test.ts
git commit -m "feat(fir): tipuri si logica pura (necitit, grupare, rezumat de pasa)"
```

---

### Task 3: Repository — interfață + implementarea locală

**Files:**
- Modify: `src/data/repository.ts`
- Modify: `src/data/localRepository.ts`
- Test: `src/data/localRepository.test.ts`

**Interfaces:**
- Consumes: `IssueEvent`, `InboxRow` din Task 2.
- Produces: `NewThreadPost`; metodele `listEvents`, `postToThread`, `markSeen`,
  `listInbox` pe `Repository`.

- [ ] **Step 1: Extinde interfața**

În `src/data/repository.ts`, lângă `NewObstacle`:

```ts
export interface NewThreadPost {
  issueId: string
  projectId: string
  body?: string
  /**
   * `false` = doar comentariu. `true` = mută tichetul la `to`.
   * Separat de `to` fiindcă `to: null` e o valoare REALĂ — „către nimeni",
   * adică iau tichetul înapoi la creator. Un singur câmp n-ar putea exprima
   * trei stări.
   */
  handoff?: boolean
  to?: string | null
  /** Atașamente deja urcate, care se leagă de comentariul nou-creat. */
  attachmentIds?: string[]
}
```

Și în `interface Repository`, după `createAssignee`:

```ts
  /** Firul unui tichet, cronologic. Per tichet, ca listObstacleLinks — un
   *  proiect vechi are mii de evenimente și nimeni nu le vede pe toate. */
  listEvents(issueId: string): Promise<IssueEvent[]>
  /** Comentariul ȘI pasa, într-o singură scriere. Trei apeluri separate pot
   *  reuși pe jumătate: comentariul scris, tichetul rămas la tine. */
  postToThread(input: NewThreadPost): Promise<{ events: IssueEvent[]; issue: Issue }>
  markSeen(issueId: string): Promise<void>
  /** Cutia de pase: transversal pe proiecte, ca listDueIssues. */
  listInbox(): Promise<InboxRow[]>
```

Adaugă `IssueEvent`, `InboxRow` la importul de tipuri din capul fișierului.

- [ ] **Step 2: Scrie testele care pică**

Adaugă în `src/data/localRepository.test.ts`:

```ts
describe('firul', () => {
  it('un comentariu simplu scrie un singur eveniment și nu mută tichetul', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'P', description: '', prefix: 'P' })
    const i = await repo.createIssue({ projectId: p.id, title: 'T' })
    const { events, issue } = await repo.postToThread({ issueId: i.id, projectId: p.id, body: 'salut' })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('comment')
    expect(issue.assigneeId).toBeNull()
  })

  it('o pasă scrie DOUĂ evenimente și mută tichetul', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'P', description: '', prefix: 'P' })
    const i = await repo.createIssue({ projectId: p.id, title: 'T' })
    const a = await repo.createAssignee('Alex')
    const { events, issue } = await repo.postToThread({
      issueId: i.id, projectId: p.id, body: 'ia-l tu', handoff: true, to: a.id,
    })
    expect(events.map((e) => e.kind)).toEqual(['comment', 'handoff'])
    expect(events[1].handoffFrom).toBeNull()
    expect(events[1].handoffTo).toBe(a.id)
    expect(issue.assigneeId).toBe(a.id)
  })

  it('nu scrie pasă când destinatarul ține deja tichetul', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'P', description: '', prefix: 'P' })
    const a = await repo.createAssignee('Alex')
    const i = await repo.createIssue({ projectId: p.id, title: 'T', assigneeId: a.id })
    const { events } = await repo.postToThread({
      issueId: i.id, projectId: p.id, body: 'inca ceva', handoff: true, to: a.id,
    })
    expect(events.map((e) => e.kind)).toEqual(['comment'])
  })

  it('„către nimeni" e o pasă reală, nu absența uneia', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'P', description: '', prefix: 'P' })
    const a = await repo.createAssignee('Alex')
    const i = await repo.createIssue({ projectId: p.id, title: 'T', assigneeId: a.id })
    const { events, issue } = await repo.postToThread({
      issueId: i.id, projectId: p.id, handoff: true, to: null,
    })
    expect(events.map((e) => e.kind)).toEqual(['handoff'])
    expect(events[0].handoffFrom).toBe(a.id)
    expect(events[0].handoffTo).toBeNull()
    expect(issue.assigneeId).toBeNull()
  })

  it('un gest gol nu scrie nimic', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'P', description: '', prefix: 'P' })
    const i = await repo.createIssue({ projectId: p.id, title: 'T' })
    const { events } = await repo.postToThread({ issueId: i.id, projectId: p.id, body: '   ' })
    expect(events).toEqual([])
  })
})
```

Fișierul are deja `beforeEach` care pune un `MemStorage` în
`globalThis.localStorage`, iar fiecare test își face repository-ul cu
`createLocalRepository()`. Nu adăuga alt helper.

- [ ] **Step 3: Rulează testele, verifică că pică**

Run: `npx vitest run src/data/localRepository.test.ts`
Expected: FAIL — `repo.postToThread is not a function`.

- [ ] **Step 4: Implementează în localRepository**

Adaugă `events: IssueEvent[]` și `seen: Record<string, string>` în forma bazei
locale (lângă `assignees`), cu `?? []` / `?? {}` la citire, ca migrațiile de
localStorage existente. Apoi metodele:

```ts
    async listEvents(issueId) {
      return clone(load().events ?? []).filter((e) => e.issueId === issueId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    async postToThread(input) {
      const db = load()
      const issue = db.issues.find((i) => i.id === input.issueId)
      if (!issue) throw new Error(`tichet inexistent: ${input.issueId}`)
      const body = (input.body ?? '').trim()
      const out: IssueEvent[] = []
      const at = new Date().toISOString()
      const base = {
        issueId: input.issueId, projectId: input.projectId,
        authorId: 'local', createdAt: at, editedAt: null,
      }
      if (body) {
        out.push({ ...base, id: crypto.randomUUID(), kind: 'comment', body,
                   handoffFrom: null, handoffTo: null })
      }
      const to = input.to ?? null
      if (input.handoff && issue.assigneeId !== to) {
        out.push({ ...base, id: crypto.randomUUID(), kind: 'handoff', body: '',
                   handoffFrom: issue.assigneeId, handoffTo: to })
        issue.assigneeId = to
      }
      db.events = [...(db.events ?? []), ...out]
      db.seen = { ...(db.seen ?? {}), [input.issueId]: at }
      save(db)
      return clone({ events: out, issue })
    },

    async markSeen(issueId) {
      const db = load()
      db.seen = { ...(db.seen ?? {}), [issueId]: new Date().toISOString() }
      save(db)
    },

    async listInbox() {
      const db = load()
      const events = db.events ?? []
      const seen = db.seen ?? {}
      return db.issues.filter((i) => i.assigneeId).map((i) => {
        const mine = events.filter((e) => e.issueId === i.id)
        const foreign = mine.filter((e) => e.authorId !== 'local')
        const last = mine[mine.length - 1]
        const lastForeign = foreign[foreign.length - 1]
        return {
          issueId: i.id, projectId: i.projectId, title: i.title, done: i.done,
          assigneeId: i.assigneeId,
          lastEventAt: last?.createdAt ?? null,
          lastForeignAt: lastForeign?.createdAt ?? null,
          lastForeignAuthor: lastForeign?.authorId ?? null,
          seenAt: seen[i.id] ?? null,
        }
      })
    },
```

Notă: în modul local nu există conturi, deci `authorId: 'local'` e o convenție
suficientă — `listInbox` o folosește ca să distingă „al meu" de „străin".

- [ ] **Step 5: Rulează testele**

Run: `npx vitest run src/data/localRepository.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/repository.ts src/data/localRepository.ts src/data/localRepository.test.ts
git commit -m "feat(fir): contractul de repository si implementarea locala"
```

---

### Task 4: Repository — implementarea Supabase

**Files:**
- Modify: `src/data/supabaseRepository.ts`
- Test: `src/data/supabaseRepository.test.ts`

**Interfaces:**
- Consumes: `NewThreadPost`, `IssueEvent`, `InboxRow` din Task 2 și 3; funcția
  `post_to_thread` și vederea `inbox_rows` din Task 1.
- Produces: aceleași patru metode, peste Supabase.

- [ ] **Step 1: Scrie maparea și testul ei**

Testele existente din `supabaseRepository.test.ts` testează funcții pure de
mapare, nu rețeaua. Urmează tiparul: exportă `rowToEvent` și `rowToInboxRow` și
testează-le.

```ts
it('rowToEvent mapează snake_case la camelCase', () => {
  expect(rowToEvent({
    id: 'e1', issue_id: 'T-1', project_id: 'p', kind: 'handoff',
    author_id: 'u1', body: '', handoff_from: null, handoff_to: 'a2',
    created_at: '2026-09-17T10:00:00Z', edited_at: null,
  })).toEqual({
    id: 'e1', issueId: 'T-1', projectId: 'p', kind: 'handoff',
    authorId: 'u1', body: '', handoffFrom: null, handoffTo: 'a2',
    createdAt: '2026-09-17T10:00:00Z', editedAt: null,
  })
})
```

- [ ] **Step 2: Rulează, verifică că pică**

Run: `npx vitest run src/data/supabaseRepository.test.ts`
Expected: FAIL — `rowToEvent` nu e exportat.

- [ ] **Step 3: Implementează**

```ts
export function rowToEvent(row: EventRow): IssueEvent {
  return {
    id: row.id, issueId: row.issue_id, projectId: row.project_id,
    kind: row.kind, authorId: row.author_id ?? null, body: row.body ?? '',
    handoffFrom: row.handoff_from ?? null, handoffTo: row.handoff_to ?? null,
    createdAt: row.created_at, editedAt: row.edited_at ?? null,
  }
}

// … în obiectul repository:
    async listEvents(issueId) {
      const { data, error } = await db.from('issue_events')
        .select('*').eq('issue_id', issueId).order('created_at')
      if (error) throw error
      return (data ?? []).map(rowToEvent)
    },

    async postToThread(input) {
      const { data, error } = await db.rpc('post_to_thread', {
        p_issue_id: input.issueId,
        p_project_id: input.projectId,
        p_body: input.body ?? '',
        p_handoff: input.handoff ?? false,
        p_to: input.to ?? null,
        p_attachment_ids: input.attachmentIds ?? [],
      })
      if (error) throw error
      // `to_jsonb(i)` nu poartă dependențele: ele stau în tabela `dependencies`.
      // Apelantul le păstrează din tichetul vechi — vezi Task 6.
      return {
        events: (data.events ?? []).map(rowToEvent),
        issue: rowToIssue(data.issue),
      }
    },

    async markSeen(issueId) {
      const { error } = await db.from('issue_seen')
        .upsert({ issue_id: issueId, seen_at: new Date().toISOString() },
                { onConflict: 'user_id,issue_id' })
      if (error) throw error
    },

    async listInbox() {
      const { data, error } = await db.from('inbox_rows')
        .select('*').eq('done', false)
      if (error) throw error
      return (data ?? []).map(rowToInboxRow)
    },
```

Cu maparea a doua, care lipsea din prima versiune a planului:

```ts
export function rowToInboxRow(row: InboxRowRaw): InboxRow {
  return {
    issueId: row.issue_id, projectId: row.project_id, title: row.title,
    done: row.done, assigneeId: row.assignee_id ?? null,
    lastEventAt: row.last_event_at ?? null,
    lastForeignAt: row.last_foreign_at ?? null,
    lastForeignAuthor: row.last_foreign_author ?? null,
    seenAt: row.seen_at ?? null,
  }
}
```

Testul lor merge direct pe funcțiile pure: clientul fals din
`supabaseRepository.test.ts` (`vi.hoisted`) știe `from().select().eq()`, dar
**nu** știe `rpc()`. Extinderea lui pentru un singur apel ar costa mai mult
decât aduce; `post_to_thread` se verifică live, la Step 5.

`markSeen` nu trimite `user_id`: îl pune politica RLS prin `auth.uid()`. Dacă
schema cere coloana explicit, adaug-o din sesiune — dar **niciodată** dintr-un
parametru primit de sus.

- [ ] **Step 4: Rulează**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verifică live, cu un script temporar**

```js
// tmp-thread-smoke.mjs — se șterge imediat după
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
console.log(await s.from('inbox_rows').select('*').limit(3))
```

Run: `node tmp-thread-smoke.mjs && rm tmp-thread-smoke.mjs`
Expected: răspuns fără eroare. Un `PGRST202` înseamnă că a lipsit
`notify pgrst, 'reload schema'` — rulează migrarea din nou.

- [ ] **Step 6: Commit**

```bash
git add src/data/supabaseRepository.ts src/data/supabaseRepository.test.ts
git commit -m "feat(fir): citirea si scrierea firului prin Supabase"
```

---

### Task 5: Identitatea din sesiune, și scoaterea auto-atribuirii

**Files:**
- Create: `scripts/link-assignees.mjs`
- Modify: `src/store.tsx` (`myAssigneeId`, `setMyAssigneeId`)
- Modify: `src/components/IssueForm.tsx:240` (`defaultAssigneeId`), plus locurile
  care cheamă `setMyAssigneeId`
- Modify: `src/components/IssueSheet.tsx`

**Interfaces:**
- Consumes: coloana `assignees.user_id` din Task 1.
- Produces: `myAssigneeId` derivat din sesiune (rămâne în contractul store-ului,
  cu același nume și tip `string | null`); `setMyAssigneeId` **dispare**.

- [ ] **Step 1: Scrie scriptul de legare**

`scripts/link-assignees.mjs` — listează conturile și rândurile, apoi leagă
perechile date ca argumente. Nicio potrivire automată după nume: ar lega tăcut
contul greșit de munca altcuiva, iar greșeala s-ar vedea abia în firul unui
tichet.

```js
// node scripts/link-assignees.mjs                      → listează
// node scripts/link-assignees.mjs <email> <assigneeId>  → leagă
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

const [email, assigneeId] = process.argv.slice(2)
const { data: { users } } = await s.auth.admin.listUsers()
const { data: rows } = await s.from('assignees').select('id, name, user_id').order('name')

if (!email || !assigneeId) {
  console.log('Conturi:'); users.forEach((u) => console.log(' ', u.email, u.id))
  console.log('Assignees:'); rows.forEach((r) => console.log(' ', r.id, r.name, r.user_id ? '(legat)' : ''))
  console.log('\nLeagă: node scripts/link-assignees.mjs <email> <assigneeId>')
  process.exit(0)
}
const user = users.find((u) => u.email === email)
if (!user) { console.error('cont inexistent:', email); process.exit(1) }
const { error } = await s.from('assignees').update({ user_id: user.id }).eq('id', assigneeId)
if (error) { console.error(error); process.exit(1) }
console.log('legat', email, '→', assigneeId)
```

- [ ] **Step 2: Rulează-l ca să vezi starea**

Run: `node scripts/link-assignees.mjs`
Expected: lista conturilor și a celor 3 rânduri („Alexandru", „ionu", „ionut").
**Nu lega nimic încă** — decide împreună cu omul care rând e al lui și dacă
duplicatul „ionu"/„ionut" se șterge. Asta e o decizie despre datele lui.

- [ ] **Step 3: Derivă `myAssigneeId` din sesiune**

În `src/store.tsx`: scoate starea `myAssigneeId` din `localStorage` și
`setMyAssigneeId` din contractul store-ului. În locul lor:

```ts
  // Cine sunt, ca assignee. Vine din sesiune, nu dintr-un „eu sunt X" salvat
  // local: creatorul unui tichet și autorul unui comentariu sunt fapte, iar un
  // `localStorage` se poate minți. `null` = contul nu e legat de niciun nume.
  const myAssigneeId = useMemo(
    () => assignees.find((a) => a.userId === session?.user.id)?.id ?? null,
    [assignees, session],
  )
```

`Assignee` primește `userId: string | null` în `src/lib/types.ts`, iar
`listAssignees` îl mapează din `user_id` în ambele repository-uri.

- [ ] **Step 4: Șterge auto-atribuirea**

`src/components/IssueForm.tsx:240` — șterge `defaultAssigneeId` și folosirea lui.
Un tichet nou se creează **întotdeauna** cu `assigneeId: null`.

```ts
// ȘTERGE:
const defaultAssigneeId = !isEdit && project?.type === 'personal' ? (myAssigneeId ?? null) : null
```

Apoi scoate fiecare apel `setMyAssigneeId(...)` din `IssueForm.tsx` (inclusiv
butonul „sunt eu" din `AssigneeSearch`) și din `IssueSheet.tsx`. `myAssigneeId`
rămâne CITIT în ambele — pentru „(eu)" de lângă nume.

- [ ] **Step 5: Verifică**

Run: `npm test && npm run typecheck`
Expected: PASS. Dacă un test se aștepta la auto-atribuire în proiecte
personale, actualizează-l — comportamentul s-a schimbat deliberat.

- [ ] **Step 6: Commit**

```bash
git add scripts/link-assignees.mjs src/store.tsx src/lib/types.ts src/data src/components/IssueForm.tsx src/components/IssueSheet.tsx
git commit -m "feat(pasare): identitatea vine din sesiune, tichetele noi nu se mai autoatribuie"
```

---

### Task 6: `Thread.tsx` — firul și caseta de scris

**Files:**
- Create: `src/components/Thread.tsx`
- Modify: `src/components/IssueForm.tsx` (înlocuiește secțiunea NOTE; extinde
  `isDirty`)
- Modify: `src/styles.css` (stiluri noi; șterge `.notes-*`)
- Test: `src/components/IssueForm.test.ts`

**Interfaces:**
- Consumes: `listEvents`, `postToThread` din Task 3/4; `AttachmentPicker` și
  `Attachments` existente.
- Produces: `<Thread issueId={string} projectId={string} onDirtyChange={(d: boolean) => void} />`.

- [ ] **Step 1: Scrie testul care pică**

În `src/components/IssueForm.test.ts`, lângă testele existente de `isDirty`:

```ts
it('un corp de comentariu nescris marchează formularul ca murdar', () => {
  expect(isFormDirty({ ...pristineEdit, commentDraft: 'ceva' })).toBe(true)
})
it('un draft golit după trimitere lasă formularul curat', () => {
  expect(isFormDirty({ ...pristineEdit, commentDraft: '' })).toBe(false)
})
it('draftul nu contează la creare — acolo nu există fir', () => {
  expect(isFormDirty({ ...pristineCreate, commentDraft: 'ceva' })).toBe(false)
})
```

Fișierul testează azi funcții pure extrase din formular. Dacă `isDirty` e încă
o expresie inline în componentă, **extrage-o întâi** într-o funcție pură
`isFormDirty(state)` exportată din `IssueForm.tsx`, fără să schimbi
comportamentul — atunci testul devine posibil.

- [ ] **Step 2: Rulează, verifică că pică**

Run: `npx vitest run src/components/IssueForm.test.ts`
Expected: FAIL — `commentDraft` nu există pe tipul de stare.

- [ ] **Step 3: Extinde `isDirty`**

Adaugă `commentDraft: string` în starea formularului și în funcția pură. **Doar
pe ramura de editare** (`isEdit`), niciodată pe cea de creare: un tichet
nesalvat n-are fir.

```ts
// ramura de editare, la capătul expresiei existente:
  || commentDraft.trim() !== ''
```

- [ ] **Step 4: Scrie `Thread.tsx`**

Cerințe de comportament, fiecare cu motivul ei:

```tsx
/**
 * Firul unui tichet: comentarii și pase, cronologic, plus caseta de scris.
 *
 * Trei lucruri pe care nu le face, deliberat:
 *  - NU are `overflow` propriu. În modal, coloana dreaptă se derulează deja; în
 *    panoul docat se derulează corpul întreg. Un al treilea scroller ar face
 *    firul inaccesibil în modal.
 *  - NU se randează pe un tichet nesalvat. `existing` e undefined până la
 *    primul save, iar salvarea remontează formularul.
 *  - NU salvează tichetul. „Trimite" scrie în fir; săgeata din antet salvează
 *    tichetul. Două butoane, două înțelesuri.
 */
export function Thread({ issueId, projectId, onDirtyChange }: {
  issueId: string
  projectId: string
  onDirtyChange(dirty: boolean): void
}) {
```

Structura de randare:

- Evenimentele, în ordine. `kind: 'comment'` → avatar + nume (serif) + oră
  (mono) + casetă pe `--surface` cu `box-shadow: var(--amb)`, `--surface-2` dacă
  e al meu. `authorId === null` → „Notă mutată", cu avatar gol.
- `kind: 'handoff'` → **fără casetă**. O linie „Ionuț → Alex" cu ora la capăt,
  aliniată la dreapta. E un eveniment, nu un mesaj; o casetă ar face-o să se
  citească drept replică goală.
- Caseta: `<textarea>` cu `border: 1px solid var(--line)` (excepția din regula
  „fără linii" — un câmp fără delimitare nu se mai citește ca un câmp), buton de
  agrafă care refolosește `AttachmentPicker`, buton „către…" care deschide
  selectorul, și „Trimite".
- Cu destinatar ales, butonul scrie **„Trimite și pasează"**.
- Selectorul de destinatar are „Nimănui" ca primă opțiune, cu subtitlul
  „rămâne la <creator>": e felul în care iei un tichet înapoi.
- `Enter` trimite, `Shift+Enter` face rând nou — ca `QuickAdd`. Nu trebuie gardă
  de tastatură: `shouldIgnoreKey` din `hooks.ts` iese deja pe `TEXTAREA`.

La trimitere:

```tsx
const res = await repository.postToThread({
  issueId, projectId, body, handoff: to !== undefined, to: to ?? null,
  attachmentIds: pendingAttachmentIds,
})
setEvents((prev) => [...prev, ...res.events])
setBody(''); setTo(undefined); setPendingAttachmentIds([])
onDirtyChange(false)   // OBLIGATORIU: altfel formularul rămâne murdar pe veci
                       // și fiecare click în listă e refuzat cu clipire.
```

`res.issue` **nu poartă dependențele** (`to_jsonb` citește doar tabela
`issues`). Când actualizezi tichetul în store, păstrează `deps` din cel vechi.

- [ ] **Step 5: Montează-l și șterge NOTE**

În `IssueForm.tsx`, înlocuiește blocul `.notes-section` (`:1369-1373`) cu:

```tsx
{isEdit && existing && (
  <Thread issueId={existing.id} projectId={project.id} onDirtyChange={setCommentDraftDirty} />
)}
```

Șterge: starea `notes` (`:261`), `notesSectionRef` / `notesMaxH` și
ResizeObserver-ul (`:350-369`), `notes` din `isDirty` (`:447`, `:452`), din
`qaPayload` (`:689`), din snapshotul optimist (`:717`) și din tichetul-țintă
sintetic (`:629`). Șterge `.notes-*` din `src/styles.css`.

Mecanica `notesMaxH` **nu se portează**: `closest('.sheet')` e `null` în panoul
lateral (`SplitView` randează `<aside class="split-pane">`), deci e deja moartă
acolo.

Scoate `notes` și din `Issue`, `NewIssue`, ambele repository-uri și `seed.ts`.
**`functions/api/` rămâne neatins.**

- [ ] **Step 6: Rulează**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Verifică în aplicație, în ambele teme**

Run: `npm run dev`, deschide un tichet, scrie un comentariu, atașează o poză,
pasează-l. Apoi lărgește fereastra peste 1200px și repetă din panoul lateral.
Verifică: nu apare un al doilea scrollbar în modal; ciorna supraviețuiește
comutării între modal și panou; după trimitere, un click pe alt rând din listă
**nu** mai e refuzat.

- [ ] **Step 8: Commit**

```bash
git add src/components/Thread.tsx src/components/IssueForm.tsx src/components/IssueForm.test.ts src/styles.css src/lib src/data
git commit -m "feat(fir): firul de comentarii inlocuieste campul de note"
```

---

### Task 7: Proveniența și deținătorul pe cardul tichetului

**Files:**
- Modify: `src/components/IssueSheet.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `issue.createdBy`, `issue.createdAt` (Task 1); `assignees` din store.
- Produces: nimic pentru alte sarcini.

- [ ] **Step 1: Adaugă câmpurile în model**

`Issue` primește `createdBy: string | null` și `createdAt: string`, mapate din
`created_by` / `created_at` în `supabaseRepository`, și puse la creare în
`localRepository`. Actualizează fixtures-urile din testele existente (caută
`assigneeId: null` — acolo se construiesc tichetele de test).

- [ ] **Step 2: Randează linia de proveniență**

Sub titlu, în `IssueSheet.tsx`:

```tsx
<div className="origin">
  <Avatar id={it.createdBy} />
  <span>creat de {creatorName ?? '—'}</span>
  <span className="dot">·</span>
  <time className="mono">{shortDate(it.createdAt)}</time>
</div>
{assignee
  ? <div className="holder"><span className="arrow">→</span><Avatar id={assignee.id} />
      <span className="who">{assignee.name}</span></div>
  : <div className="holder free">nepasat — stă la {creatorName ?? 'creator'}</div>}
```

Numele e limbă → serif. Data e cifră → mono. Jetonul „holder" n-are chenar:
`background: var(--surface-3)` și `border-radius: var(--r-s)`.

- [ ] **Step 3: Verifică vizual, în ambele teme**

Run: `npm run dev`. Un tichet vechi are `createdBy` null — trebuie să arate doar
data, fără „creat de —". Repar-o dacă arată altfel.

- [ ] **Step 4: Commit**

```bash
git add src/components/IssueSheet.tsx src/styles.css src/lib/types.ts src/data
git commit -m "feat(pasare): cardul arata cine l-a creat si pe cine sta"
```

---

### Task 8: Filtrul de om în „Listă"

**Files:**
- Modify: `src/components/ListView.tsx` (după linia 220 — **frate** al
  `.wave-sel`, nu copil)
- Modify: `src/styles.css`
- Test: `scripts/test-layout.mjs`

**Interfaces:**
- Consumes: `assignees`, `issues` din store.
- Produces: nimic pentru alte sarcini (stare locală vizualizării).

- [ ] **Step 1: Scrie testul de layout care pică**

În `scripts/test-layout.mjs`, un bloc nou după linia 120, pe tiparul fixture-DOM
de la `:40-54` plus măsurarea de la `:59-82`:

```js
/**
 * Bara de filtre de om stă pe rând PROPRIU. În `.wave-sel`, `.wave-tabs` are
 * `flex: 1` și `.wave-actions` `flex-shrink: 0` — un al treilea copil ar fura
 * din valuri. Fixture-ul pune cazul cel mai rău: patru jetoane cu nume lungi.
 */
const whoBar = () => `
<div class="wave-sel">
  <div class="wave-tabs"><button>Val 1</button><button>Val 2</button><button>Val 3</button></div>
  <div class="wave-actions"><button>A</button><button>B</button></div>
</div>
<div class="who-bar">
  <button class="who-chip">Toți <span class="n">12</span></button>
  <button class="who-chip">Nepasate <span class="n">7</span></button>
  <button class="who-chip on">Alexandru <span class="n">3</span></button>
  <button class="who-chip">Maria Popescu <span class="n">2</span></button>
</div>`

console.log('Bara de filtre de om (ListView) — valurile nu se strivesc:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${whoBar()}`)
  const m = await page.evaluate(() => {
    const tabs = document.querySelector('.wave-tabs')
    const bar = document.querySelector('.who-bar')
    const chip = document.querySelector('.who-chip')
    const chipStyle = getComputedStyle(chip)
    return {
      tabs: Math.round(tabs.getBoundingClientRect().width),
      chipH: Math.round(chip.getBoundingClientRect().height),
      // Bara își duce singură depășirea, prin scroll orizontal — nu o împinge
      // în pagină și nu se înfășoară.
      scrolls: bar.scrollWidth > Math.round(bar.getBoundingClientRect().width),
      overflowX: chipStyle.overflowX,
      // Un control fără fundal ȘI fără chenar e invizibil.
      visible: chipStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' || chipStyle.boxShadow !== 'none',
    }
  })
  await page.close()

  check(`valuri @${width}px`, m.tabs >= 120, `${m.tabs}px pentru taburile de val`)
  check(`jeton atingibil @${width}px`, m.chipH >= 28, `${m.chipH}px înălțime`)
  check(`bara se derulează @${width}px`, !m.scrolls || m.overflowX === 'auto', `overflow-x: ${m.overflowX}`)
  check(`jeton vizibil @${width}px`, m.visible, m.visible ? 'are fundal sau umbră' : 'INVIZIBIL')
}
```

`check(name, ok, detail)` e helperul care există deja în fișier; `CSS`,
`PHONE_WIDTHS` și `browser` la fel. Nu introduce `expect` — fișierul nu rulează
sub vitest.

- [ ] **Step 2: Rulează, verifică că pică**

Run: `npm run test:layout`
Expected: FAIL — `.who-bar` nu există în CSS, deci lățimea măsurată e 0.

- [ ] **Step 3: Randează bara**

În `ListView.tsx`, după `.wave-sel`:

```tsx
{holders.length > 0 && (
  <div className="who-bar">
    <button className={`who-chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>
      Toți <span className="n mono">{all.length}</span></button>
    {unassignedCount > 0 && (
      <button className={`who-chip ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>
        Nepasate <span className="n mono">{unassignedCount}</span></button>
    )}
    {holders.map((a) => (
      <button key={a.id} className={`who-chip ${filter === a.id ? 'on' : ''}`} onClick={() => setFilter(a.id)}>
        <Avatar id={a.id} />{a.name} <span className="n mono">{countFor(a.id)}</span></button>
    ))}
  </div>
)}
```

`holders` = doar oamenii care chiar au ceva în proiect. Un filtru cu zero e
zgomot, iar bara ar crește cu fiecare cont creat vreodată.

CSS:

```css
/* Rând propriu, nu al treilea copil al `.wave-sel`: acolo `.wave-tabs` are
   flex:1 și valurile s-ar strivi. Numărul de oameni nu e mărginit ca cel de
   valuri, deci scroll orizontal, nu wrap. */
.who-bar { display: flex; gap: 7px; padding: 8px 15px; overflow-x: auto;
           background: var(--surface); box-shadow: var(--amb); scrollbar-width: none; }
.who-bar::-webkit-scrollbar { display: none; }
.who-chip { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
            background: var(--surface-3); border: 0; border-radius: var(--r-m);
            padding: 6px 10px; color: var(--txt-dim); font-size: 13px; cursor: pointer; }
/* Activ = text plin + linie de 2px. Nicio casetă umplută, niciun gradient. */
.who-chip.on { color: var(--txt); box-shadow: inset 0 -2px 0 var(--accent); }
.who-chip .n { font-size: 10px; color: var(--txt-faint); }
.who-chip.on .n { color: var(--accent); }
```

Starea filtrului e locală vizualizării: **nu** în DB, **nu** în URL. E o
întrebare pusă acum („ce are Alex pe cap"), nu o preferință; iar în URL s-ar
bate cu restaurarea listei memorate din `LAST_VIEW_KEY`.

- [ ] **Step 4: Rulează testele**

Run: `npm run test:layout && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ListView.tsx src/styles.css scripts/test-layout.mjs
git commit -m "feat(lista): filtru de om, pe rand propriu ca sa nu striveasca valurile"
```

---

### Task 9: „Pe mine" — al patrulea ecran

**Files:**
- Create: `src/components/InboxView.tsx`
- Modify: `src/store.tsx` (`loadInbox`, memoizarea grupării)
- Modify: `src/App.tsx` (`Screen`, `TabBar`, `parseLastView`, `settleUrl`,
  efectul de boot, `exitSmartList`)
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/styles.css`
- Test: `scripts/test-nav.mjs`

**Interfaces:**
- Consumes: `listInbox` din Task 3/4; `groupInbox`, `isUnread` din Task 2.
- Produces: `InboxView`; `type Screen = SmartListKind | 'inbox'` în `App.tsx`.

- [ ] **Step 1: Încarcă inboxul în store**

Modelul e `loadDue`, nu `Promise.all`-ul per-proiect:

```ts
  const [inboxRaw, setInboxRaw] = useState<InboxRow[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)

  // Transversal pe proiecte, ca listDueIssues. NU în Promise.all-ul per-proiect:
  // acolo ar fi refăcut la fiecare comutare de proiect și ar lipsi exact când nu
  // e niciun proiect deschis — adică fix pe ecranul „Pe mine".
  const loadInbox = useCallback(async () => {
    try { setInboxRaw(await repository.listInbox()) } finally { setInboxLoaded(true) }
  }, [])

  const inbox = useMemo(() => groupInbox(inboxRaw), [inboxRaw])
```

Cheamă `loadInbox()` din efectul de boot (lângă `loadDue`) și din `refresh()`,
lângă `void loadDue()`. **Nu ridica `loading`.** Contractul e scris în
`store.tsx`: demontarea lui `<main>` scoate `SplitView`, `dockedIssueId` cade la
null și tichetul docat clipește ca modal.

- [ ] **Step 2: Scrie `InboxView.tsx`**

```tsx
/**
 * Cutia de pase. Lista e scurtă PRIN DEFINIȚIE: `assignee_id` gol înseamnă „al
 * meu prin creație", deci tichetele pe care ți le faci singur nu pot ajunge
 * niciodată aici. Golul e starea normală.
 */
export function InboxView({ onOpen }: { onOpen(issueId: string): void }) {
  const { inbox, inboxLoaded, myAssigneeId } = useHorizontal()
  if (!myAssigneeId) return (
    <p className="empty"><span className="big">Nu ești legat de niciun nume</span>
      Rulează <code>scripts/link-assignees.mjs</code> ca să legi contul de un assignee.</p>
  )
  if (!inboxLoaded) return <p className="empty">Se încarcă…</p>
  if (!inbox.fresh.length && !inbox.rest.length) return (
    <p className="empty"><span className="big">Nimic pe tine</span>
      Aici ajunge doar ce ți-a pasat cineva.<br />
      Tichetele pe care ți le faci singur nu apar niciodată.</p>
  )
  const row = (r: InboxRow) => (
    <button key={r.issueId} className="inbox-row" onClick={() => onOpen(r.issueId)}>
      {isUnread(r.lastForeignAt, r.seenAt) ? <span className="dot-new" /> : <span className="dot-gap" />}
      <div className="col">
        <div className="it">{r.title}</div>
        <div className="meta">
          <span className="proj mono">{r.issueId}</span>
          <Avatar userId={r.lastForeignAuthor} />
          <span>de la {assigneeForUser(r.lastForeignAuthor)?.name ?? '—'}</span>
          <time className="mono">{ago(r.lastEventAt)}</time>
        </div>
      </div>
    </button>
  )
  return (
    <div className="inbox-pad">
      {inbox.fresh.length > 0 && <><p className="grp">Necitite</p>{inbox.fresh.map(row)}</>}
      {inbox.rest.length > 0 && <><p className="grp">Mai devreme</p>{inbox.rest.map(row)}</>}
    </div>
  )
}
```

Tichetele se deschid prin `openTaskAnywhere` — singurul drum care încarcă
proiectul unui tichet străin, exact ca listele inteligente.

- [ ] **Step 3: Adaugă ecranul, FĂRĂ să atingi `SmartListKind`**

În `App.tsx`:

```tsx
// „Pe mine" NU e un SmartListKind. Un al patrulea `kind` ar trece de typecheck
// și ar strica trei lucruri: ecranul ar aștepta `dueLoaded`, deci o încărcare de
// scadențe care nu-l privește; ar cere un `defaultDueAt` pentru QuickAdd, pe un
// ecran care n-are zi; și ar primi FAB-ul de adăugare rapidă, unde crearea unei
// sarcini n-are sens.
type Screen = SmartListKind | 'inbox'
const [screen, setScreen] = useState<Screen | null>(null)
const smartList = screen === 'inbox' ? null : screen
```

`Header`, `Sidebar` și `SmartListView` rămân neatinse ca semnătură. `InboxView`
intră ca ramură nouă în lanțul de randare, **înaintea** celei de listă
inteligentă.

Patru locuri sunt obligatorii:
1. `parseLastView` — acceptă `smart:inbox`. Fără el „Pe mine" nu supraviețuiește
   unei reporniri, iar `pwa.ts` reîncarcă pagina la revenirea în tab.
2. `settleUrl` — tratează `inbox` ca pe o listă → path `/`. Fără el, ștergerea
   din „Pe mine" lasă `/project/<slug>` în bară și repornirea te mută pe board.
3. Efectul de boot — restaurează ecranul.
4. `exitSmartList` — șterge `LAST_VIEW_KEY` și pentru `inbox`.

`TabBar` primește al patrulea buton, cu badge-ul `inbox.fresh.length`:

```tsx
<button className={screen === 'inbox' ? 'on' : ''} onClick={() => onScreen('inbox')}>
  <span className="tb-ico"><Icon name="people" size={21} />
    {unread > 0 && <span className="tb-badge mono">{unread}</span>}</span>Pe mine
</button>
```

`people` trebuie să existe în `src/components/Icon.tsx` — un nume de **rol**, nu
de desen. Adaug-o dacă lipsește.

- [ ] **Step 4: Bulina se stinge cu întârziere**

La deschiderea unui tichet din cutie, `markSeen` se cheamă după ~900ms, nu
instant: altfel bulina dispare sub deget înainte să apuci să vezi de ce era
acolo.

- [ ] **Step 5: Extinde testul de navigare**

În `scripts/test-nav.mjs`, pe tiparul testelor existente (fișiere de profil
curate — istoricul altor teste ar falsifica un `back()`):

```js
// „Pe mine" supraviețuiește unei reporniri, ca „Azi".
await page.click('[data-tab="inbox"]')
await page.reload()
await expect(page.locator('.tabbar button.on')).toHaveText(/Pe mine/)
// O pasă din panoul lateral nu mută foaia pe alt ecran.
```

- [ ] **Step 6: Rulează totul**

Run: `npm test && npm run typecheck && npm run test:layout && npm run test:nav`
Expected: PASS. Bara de jos cu patru butoane se verifică la 320px, unde
„Proiecte" e cea mai lungă etichetă.

- [ ] **Step 7: Commit**

```bash
git add src/components/InboxView.tsx src/components/Sidebar.tsx src/App.tsx src/store.tsx src/styles.css scripts/test-nav.mjs
git commit -m "feat(pase): ecranul „Pe mine\", al patrulea tab"
```

---

### Task 10: Bancul de probă și referința din aplicație

**Files:**
- Modify: `design/build-preview.py`
- Modify: `src/components/InfoPanel.tsx`

**Interfaces:**
- Consumes: clasele CSS din Task 6, 7, 8, 9.
- Produces: nimic.

- [ ] **Step 1: Adaugă ecranele în bancul de probă**

În `design/build-preview.py`: ecrane noi pentru firul de comentarii, caseta de
scris, bara de filtre și cutia de pase. Plus, în galeria **„Controale"**, fiecare
clasă nouă în starea normală **și** în cea activă: `.who-chip`, `.who-chip.on`,
butonul „către" normal și cu destinatar ales, butonul „Trimite".

Galeria e locul unde se vede dacă un control a rămas fără fundal ȘI fără chenar
— typecheck-ul și testele trec, iar butonul e invizibil.

- [ ] **Step 2: Regenerează și deschide în AMBELE teme**

```bash
python3 design/build-preview.py
```

Deschide `design/preview.html`, comută tema, uită-te la ecranul „Controale".

- [ ] **Step 3: Adaugă regula în referința din aplicație**

`src/components/InfoPanel.tsx` — o linie despre regula centrală, la „regulile
care nu se văd din interfață": *un tichet fără assignee e al celui care l-a
creat; assignee-ul înseamnă „ți l-am pasat".* Fără ea, regula trăiește doar în
spec.

- [ ] **Step 4: Commit**

```bash
git add design/build-preview.py design/preview.html src/components/InfoPanel.tsx
git commit -m "docs(fir): bancul de proba si referinta din aplicatie"
```

---

### Task 11: Verificare finală și publicare

**Files:** niciunul nou.

- [ ] **Step 1: Rulează tot**

```bash
npm test && npm run typecheck && npm run test:layout && npm run test:nav
```

Expected: totul PASS. `npm run test:upgrade` **nu** e necesar — nimic din plan
n-a atins `src/sw.ts`, `src/pwa.ts` sau blocul VitePWA. Dacă l-ai atins, ai
greșit drumul; rulează-l și explică de ce.

- [ ] **Step 2: Verifică manual ciclul complet**

Cu două conturi (sau două ferestre): Alex creează un tichet → tu vezi „creat de
Alex" → scrii un comentariu cu o poză și îl pasezi înapoi lui Alex → tichetul
dispare din „Pe mine" la tine și apare la Alex cu bulină. În ambele teme, pe
lățime de telefon și peste 1200px.

- [ ] **Step 3: Leagă conturile în producție**

```bash
node scripts/link-assignees.mjs
node scripts/link-assignees.mjs <email> <assigneeId>
```

- [ ] **Step 4: Publică**

Push pe `master` publică direct pe <https://horizontal-dyx.pages.dev>. Migrarea
trebuie să fi rulat **înainte** — altfel aplicația nouă cere coloane care nu
există.

```bash
git push origin master
```

- [ ] **Step 5: Actualizează CLAUDE.md**

O secțiune nouă, „Firul și pasarea", cu regula centrală, de ce „Pe mine" nu e un
`SmartListKind`, și pasul de setup (`npm run migrate supabase/migration-comments.sql`
plus `scripts/link-assignees.mjs`). Commit separat.
