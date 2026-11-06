-- Seriile de mementouri: „la fiecare 15 minute până la 10", „din oră în oră
-- între 9 și 17, zilnic". Rulează o dată, ÎNAINTE de push și înainte de
-- deploy-ul funcțiilor: npm run migrate supabase/migration-ping-series.sql
-- Re-rulabilă: fiecare pas verifică ce există deja.
--
-- O serie e UN tichet, cu o coloană în plus:
--   remind_at  = primul ping și ancora grilei,
--   due_at     = capătul ferestrei (ultimul ping e <= el),
--   ping_every = pasul, în minute,
--   rrule      = în ce zile revine seria (null = doar azi) — sensul lui de azi;
--                seria NU se codifică în rrule: peste tot în cod `rrule` nenul
--                înseamnă „recurentă".
-- Nimic nu se scrie în bază la fiecare ping: cine sună calculează singur unde e
-- pe grilă (`supabase/functions/_shared/pings.ts`, `core/Pings.kt`).
-- `reminder_sent_at` înseamnă, pe o serie, „ultimul ping trimis" — vezi
-- `send-reminders`, care îl revendică înainte de a trimite.
--
-- Ordinea de deploy: migrarea → `supabase functions deploy send-reminders` și
-- `supabase functions deploy reminder-action --no-verify-jwt` → push → APK.
-- Fără coloană, `send-reminders` nou cade (filtrează pe `ping_every`), iar
-- citirea nativă a APK-ului nou primește 400.

alter table issues add column if not exists ping_every smallint;

-- 1–720 de minute: o serie trăiește într-o singură zi, iar sub un minut nu
-- există ping (cronul rulează la minut). Același plafon ca `PING_MAX_MINUTES`.
alter table issues drop constraint if exists issues_ping_every_range;
alter table issues add constraint issues_ping_every_range
  check (ping_every is null or ping_every between 1 and 720);

-- Ce caută cronul la fiecare minut: seriile deschise (trimiterea pe `remind_at`,
-- rostogolirea pe `due_at`). Puține rânduri, deci un index parțial mic.
create index if not exists issues_ping_series_idx on issues (remind_at)
  where ping_every is not null and not done;

-- O serie zilnică NEBIFATĂ, cu fereastra trecută, trece pe următoarea ei zi.
-- Bifată („Gata azi") face asta deja trigger-ul de recurență; nebifată n-ar
-- mai suna niciodată — mâine `remind_at` ar fi tot cel de ieri.
--
-- Scadența sare cu `next_occurrence` (aceeași regulă ca bifarea: din ziua
-- CURENTĂ, zilele sărite dispar), iar mementoul își ține distanța față de
-- capăt, deci fereastra rămâne aceeași, în altă zi. Oglinda în TS, pentru modul
-- local: `rollPingSeries` din `src/lib/pingSeries.ts`; `npm run
-- test:ping-series-sql` le compară pe aceleași cazuri.
--
-- `reminder_sent_at` se golește explicit, deși `issues_reset_reminder_sent` o
-- face oricum (remind_at se schimbă): regula „ultimul ping trimis" e a seriei,
-- n-are voie să depindă de un trigger scris pentru altceva.
--
-- O serie doar de azi (`rrule` null) rămâne restantă: n-are unde să sară.
create or replace function roll_ping_series() returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update issues i
     set due_at           = x.nxt,
         remind_at        = case when i.remind_at is null then null else x.nxt - (i.due_at - i.remind_at) end,
         reminder_sent_at = null
    from (
      select id, next_occurrence(rrule, due_at, now()) as nxt
        from issues
       where ping_every is not null and rrule is not null and not done and due_at < now()
    ) x
   where i.id = x.id and x.nxt is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Numai cronul o cheamă. Nu strică nimic chemată de altcineva, dar n-are de
-- ce să fie un RPC al aplicației.
revoke all on function roll_ping_series() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function roll_ping_series() from anon, authenticated';
  end if;
end $$;

-- La fiecare minut, ca `send-reminders`. Idempotent: reluarea migrării nu
-- produce două programări.
create extension if not exists pg_cron;
select cron.unschedule('roll-ping-series') where exists (select 1 from cron.job where jobname = 'roll-ping-series');
select cron.schedule('roll-ping-series', '* * * * *', $$ select roll_ping_series() $$);

-- Verificare:
--   select jobname, schedule, active from cron.job where jobname = 'roll-ping-series';
--   select id, due_at, remind_at, ping_every, rrule from issues where ping_every is not null;
