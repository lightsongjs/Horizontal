-- Google Calendar, etapa 1 (doar citire): conturile legate, calendarele lor și
-- evenimentele din fereastra „7 zile". Totul e PERSONAL: RLS doar pe
-- `user_id = auth.uid()` — un calendar nu e al proiectului, e al omului.
--
-- Scriu NUMAI funcțiile edge (`google-oauth`, `calendar-sync`, cu cheia de
-- serviciu). Clientul citește, plus două lucruri: comutatorul unui calendar
-- (doar coloana `enabled`) și nimic altceva. Deconectarea trece prin funcție,
-- fiindcă trebuie să revoce și tokenul la Google.
--
-- Rulează: npm run migrate supabase/migration-calendar.sql   (re-rulabil)
-- Înainte (o dată): funcțiile deployate — cronul de la capăt le cheamă.

-- ── 1. conturile ────────────────────────────────────────────────────────────
create table if not exists public.calendar_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  email          text not null,
  -- 'reconnect' = Google a refuzat refresh token-ul (revocat, parolă schimbată,
  -- 6 luni fără folosire). Evenimentele vechi rămân, dar nu se mai mișcă —
  -- Integrări spune asta pe față.
  status         text not null default 'ok' check (status in ('ok', 'reconnect')),
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  unique (user_id, email)
);

-- ── 2. tokenurile — NICIODATĂ citibile din client ───────────────────────────
-- Tabel separat, cu RLS pornit și FĂRĂ nicio politică: numai cheia de serviciu
-- (care ocolește RLS) ajunge la el. Și criptat (AES-GCM, `_shared/secretBox.ts`,
-- cheia e un secret al funcțiilor): un dump al bazei nu dă acces la calendare.
create table if not exists public.calendar_tokens (
  account_id        uuid primary key references public.calendar_accounts(id) on delete cascade,
  refresh_token_enc text not null,
  updated_at        timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
revoke all on public.calendar_tokens from anon, authenticated;

-- ── 3. calendarele unui cont ────────────────────────────────────────────────
create table if not exists public.calendar_calendars (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.calendar_accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  google_id  text not null,
  name       text not null,
  -- Culoarea din Google (`backgroundColor`), hex. E a omului, ca accentele de proiect.
  color      text,
  -- Sărbătorile și zilele de naștere pornesc oprite (`defaultEnabled`).
  enabled    boolean not null default true,
  is_primary boolean not null default false,
  unique (account_id, google_id)
);
create index if not exists calendar_calendars_user_idx on public.calendar_calendars (user_id);

-- ── 4. evenimentele ─────────────────────────────────────────────────────────
-- Două forme de timp, ca în Google: cu oră (`start_at`/`end_at`) sau de toată
-- ziua (`start_date`/`end_date`, sfârșit EXCLUSIV). O zi întreagă nu e un
-- interval UTC: „12 octombrie" e 12 octombrie în orice fus, deci nu se
-- convertește într-un timestamptz care ar aluneca la miezul nopții.
create table if not exists public.calendar_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  calendar_id   uuid not null references public.calendar_calendars(id) on delete cascade,
  google_id     text not null,
  title         text not null default '',
  all_day       boolean not null default false,
  start_at      timestamptz,
  end_at        timestamptz,
  start_date    date,
  end_date      date,
  location      text,
  meet_url      text,
  html_link     text,
  -- `responseStatus` al omului: accepted / declined / tentative / needsAction,
  -- null dacă e evenimentul lui fără invitați. 'declined' nu sună.
  response      text,
  -- Cele două mementouri (−10 min, start), marcate de `send-reminders`.
  pre_sent_at   timestamptz,
  start_sent_at timestamptz,
  updated_at    timestamptz not null default now(),
  unique (calendar_id, google_id),
  check ((all_day and start_date is not null and end_date is not null)
      or (not all_day and start_at is not null and end_at is not null))
);
create index if not exists calendar_events_user_idx on public.calendar_events (user_id);
-- Fereastra cronului de mementouri: evenimentele cu oră din jurul lui „acum".
create index if not exists calendar_events_start_idx on public.calendar_events (start_at) where not all_day;

-- O ședință mutată sună din nou la ora nouă — tiparul `issues_reset_reminder_sent`.
-- Sincronizarea face upsert, nu delete+insert, tocmai ca marcajele să
-- supraviețuiască unei rulări în care nimic nu s-a schimbat.
create or replace function public.calendar_events_reset_sent() returns trigger language plpgsql as $$
begin
  if new.start_at is distinct from old.start_at then
    new.pre_sent_at := null;
    new.start_sent_at := null;
  end if;
  return new;
end $$;
drop trigger if exists calendar_events_reset_sent on public.calendar_events;
create trigger calendar_events_reset_sent before update on public.calendar_events
for each row execute function public.calendar_events_reset_sent();

-- Un calendar oprit își ia evenimentele cu el, în aceeași tranzacție: listele
-- nu mai au ce filtra, iar cronul de mementouri nu mai sună pentru el.
-- Pornirea înapoi le aduce la următoarea sincronizare (clientul o cere imediat).
create or replace function public.calendar_calendars_disable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.enabled and not new.enabled then
    delete from public.calendar_events where calendar_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists calendar_calendars_disable on public.calendar_calendars;
create trigger calendar_calendars_disable after update of enabled on public.calendar_calendars
for each row execute function public.calendar_calendars_disable();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
alter table public.calendar_accounts enable row level security;
alter table public.calendar_calendars enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists cal_accounts_own on public.calendar_accounts;
create policy cal_accounts_own on public.calendar_accounts for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists cal_calendars_own on public.calendar_calendars;
create policy cal_calendars_own on public.calendar_calendars for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists cal_calendars_toggle on public.calendar_calendars;
create policy cal_calendars_toggle on public.calendar_calendars for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists cal_events_own on public.calendar_events;
create policy cal_events_own on public.calendar_events for select to authenticated
using (user_id = (select auth.uid()));

-- Granturile, explicit: Supabase dă implicit totul pe tabelele noi lui `anon`
-- și `authenticated`. Clientul citește și poate schimba DOAR `enabled`.
revoke all on public.calendar_accounts, public.calendar_calendars, public.calendar_events from anon, authenticated;
grant select on public.calendar_accounts, public.calendar_calendars, public.calendar_events to authenticated;
grant update (enabled) on public.calendar_calendars to authenticated;

-- ── 6. cronul de sincronizare ───────────────────────────────────────────────
-- Tiparul din migration-cron.sql (aceleași două secrete din Vault). La 15
-- minute: o ședință pusă acum pe telefon apare în „Azi" și sună în cel mult
-- un sfert de oră; la revenirea în aplicație clientul cere oricum o rundă.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('calendar-sync') where exists (select 1 from cron.job where jobname = 'calendar-sync');
select cron.schedule('calendar-sync', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
