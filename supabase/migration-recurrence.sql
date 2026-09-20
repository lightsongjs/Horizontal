-- Recurente: o sarcina bifata nu se inchide, ci sare la urmatoarea aparitie.
-- Ruleaza o data: npm run migrate supabase/migration-recurrence.sql
-- Safe to re-run.
--
-- De ce trigger si nu cod de client: trei drumuri diferite bifeaza un tichet -
-- interfata, butonul Gata din notificare FARA nicio fila deschisa
-- (supabase/functions/reminder-action, care scrie direct prin REST) si
-- functions/api (ticket-kit, cu cheia de serviciu). Logica in store ar fi lasat
-- ultimele doua sa inchida definitiv o sarcina recurenta.
--
-- Coloana `rrule` exista deja din migration-todo.sql. Aici nu se adauga coloane.

-- Fusul e o CONSTANTA, nu o preferinta per utilizator: aplicatia are azi
-- utilizatori intr-un singur fus. Daca apar in altul, aici se schimba - si
-- atunci `p_tz` devine o coloana pe `profiles`, nu un default.
create or replace function next_occurrence(
  p_rrule text,
  p_due   timestamptz,
  p_now   timestamptz,
  p_tz    text default 'Europe/Bucharest'
) returns timestamptz language plpgsql stable as $$
declare
  due_local timestamp;
  due_day   date;
  base      date;
  tod       time;
  freq      text;
  step      int;
  byday     int[] := '{}';
  target    int;
  cand      date := null;
  m0        date;
  gap       int;
  k         int;
  i         int;
begin
  if p_rrule is null or p_due is null then return null; end if;

  -- Chei pe care motorul TS le refuza explicit. A le ignora ar transforma o
  -- serie marginita (UNTIL, COUNT) intr-una fara sfarsit.
  if p_rrule ~ '(UNTIL|COUNT|BYSETPOS|BYMONTH=|BYWEEKNO|BYYEARDAY|WKST|BYHOUR|BYMINUTE)' then
    return null;
  end if;

  freq := substring(p_rrule from 'FREQ=([A-Z]+)');
  if freq is null or freq not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then return null; end if;

  step := coalesce(nullif(substring(p_rrule from 'INTERVAL=([0-9]+)'), '')::int, 1);
  if step < 1 then return null; end if;

  -- Toata aritmetica se face pe timestamp LOCAL, apoi rezultatul se intoarce in
  -- timestamptz. Asa ora 09:00 ramane 09:00 si peste schimbarea orei de vara;
  -- adunarea de `interval '1 day'` peste un timestamptz ar fi mutat-o cu o ora.
  due_local := p_due at time zone p_tz;
  due_day   := due_local::date;
  tod       := due_local::time;
  base      := greatest(due_day, (p_now at time zone p_tz)::date);

  if freq = 'DAILY' then
    gap  := base - due_day;
    k    := greatest(1, ceil((gap + 1)::numeric / step)::int);
    cand := due_day + k * step;

  elsif freq = 'WEEKLY' then
    select coalesce(array_agg(array_position(array['SU','MO','TU','WE','TH','FR','SA'], c) - 1), '{}')
      into byday
      from unnest(string_to_array(coalesce(substring(p_rrule from 'BYDAY=([A-Z,]+)'), ''), ',')) as c
     where c <> '';
    if coalesce(array_length(byday, 1), 0) = 0 then
      byday := array[extract(dow from due_day)::int];
    end if;
    -- Scanare zi cu zi, ca in TS: paritatea se vede la citire, nu doar la rulare.
    for i in 1..366 loop
      if extract(dow from (base + i))::int = any(byday)
         and ((date_trunc('week', (base + i)::timestamp)::date
               - date_trunc('week', due_day::timestamp)::date) / 7) % step = 0 then
        cand := base + i;
        exit;
      end if;
    end loop;

  elsif freq = 'MONTHLY' then
    target := coalesce(nullif(substring(p_rrule from 'BYMONTHDAY=([0-9]+)'), '')::int,
                       extract(day from due_day)::int);
    for k in 1..120 loop
      m0   := (date_trunc('month', due_day::timestamp) + make_interval(months => k * step))::date;
      -- Retezare la lungimea lunii, pornind de fiecare data de la ziua-TINTA.
      cand := m0 + least(target, extract(day from (m0 + interval '1 month - 1 day'))::int) - 1;
      exit when cand > base;
      cand := null;
    end loop;

  else -- YEARLY
    for k in 1..20 loop
      m0   := make_date(extract(year from due_day)::int + k * step, extract(month from due_day)::int, 1);
      cand := m0 + least(extract(day from due_day)::int,
                         extract(day from (m0 + interval '1 month - 1 day'))::int) - 1;
      exit when cand > base;
      cand := null;
    end loop;
  end if;

  if cand is null then return null; end if;
  return (cand + tod) at time zone p_tz;
end;
$$;

create or replace function advance_recurrence() returns trigger language plpgsql as $$
declare
  nxt   timestamptz;
  delta interval;
begin
  if new.done and not old.done and new.rrule is not null and new.due_at is not null then
    nxt := next_occurrence(new.rrule, new.due_at, now());
    if nxt is not null then
      -- Mementoul pastreaza acelasi decalaj fata de scadenta, deci ReminderKind
      -- din formular ramane ce era, fara sa-l recalculeze cineva.
      if new.remind_at is not null then delta := new.due_at - new.remind_at; end if;
      new.due_at    := nxt;
      new.remind_at := case when delta is null then null else nxt - delta end;
      -- Nu se inchide: sarcina recurenta n-are stare finala.
      new.done := false;
    end if;
  end if;
  return new;
end;
$$;

-- Ordinea trigger-elor BEFORE UPDATE e ALFABETICA dupa nume, iar asta conteaza:
-- `issues_advance_recurrence` ruleaza inaintea lui `issues_reset_reminder_sent`
-- (din migration-push.sql), deci al doilea vede `remind_at` deja schimbat si
-- goleste `reminder_sent_at`. Adica mementoul aparitiei urmatoare se armeaza
-- singur. Daca redenumesti vreodata trigger-ul asta, verifica litera.
drop trigger if exists issues_advance_recurrence on issues;
create trigger issues_advance_recurrence before update on issues
  for each row execute function advance_recurrence();
