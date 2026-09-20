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
  due_local  timestamp;
  due_day    date;
  base       date;
  tod        time;
  rrule_up   text;
  parts      text[];
  part       text;
  eq_pos     int;
  pkey       text;
  pval       text;
  freq       text;
  interval_s text;
  byday_s    text;
  bymonth_s  text;
  step       int;
  byday      int[] := '{}';
  code       text;
  day_idx    int;
  target     int;
  cand       date := null;
  m0         date;
  gap        int;
  k          int;
  i          int;
begin
  if p_rrule is null or p_due is null then return null; end if;

  -- Lista ALBA, in oglinda cu `parseRrule` din TS: orice cheie necunoscuta,
  -- orice pereche fara `=`, respinge tot RRULE-ul. UNTIL, COUNT, BYSETPOS
  -- etc. cad prin CONSTRUCTIE (nu sunt in lista de patru chei), nu printr-o
  -- lista neagra de nume care ar trebui tinuta manual la zi si care poate
  -- ramane in urma cand apare o cheie noua, necunoscuta inca.
  rrule_up := upper(p_rrule);
  parts := string_to_array(rrule_up, ';');
  foreach part in array parts loop
    if part = '' then continue; end if;
    eq_pos := position('=' in part);
    if eq_pos = 0 then return null; end if;
    pkey := substring(part from 1 for eq_pos - 1);
    pval := substring(part from eq_pos + 1);
    if pkey not in ('FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY') then return null; end if;
    if pkey = 'FREQ' then freq := pval;
    elsif pkey = 'INTERVAL' then interval_s := pval;
    elsif pkey = 'BYDAY' then byday_s := pval;
    else bymonth_s := pval;
    end if;
  end loop;

  if freq is null or freq not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then return null; end if;

  -- INTERVAL: intreg pozitiv, implicit 1. Regexul respinge "-1" si "abc" (nu
  -- sunt numai cifre); "0" trece regexul dar cade la verificarea de sub el,
  -- exact ca in TS.
  if interval_s is null then
    step := 1;
  elsif interval_s !~ '^[0-9]+$' then
    return null;
  else
    step := interval_s::int;
  end if;
  if step < 1 then return null; end if;

  -- BYMONTHDAY: validat CHIAR DACA freq nu e MONTHLY - ca in TS, unde
  -- valoarea e verificata neconditionat si folosita (sau aruncata) abia la
  -- capatul functiei de parsare.
  if bymonth_s is not null then
    if bymonth_s !~ '^[0-9]+$' then return null; end if;
    target := bymonth_s::int;
    if target < 1 or target > 31 then return null; end if;
  end if;
  if freq <> 'MONTHLY' then target := null; end if;

  -- BYDAY: fiecare cod trebuie sa fie o zi cunoscuta, validat CHIAR DACA freq
  -- nu e WEEKLY - un cod gresit ("XX") respinge tot RRULE-ul, nu e ignorat
  -- tacit ca zgomot.
  if byday_s is not null then
    if byday_s = '' then return null; end if;
    foreach code in array string_to_array(byday_s, ',') loop
      day_idx := array_position(array['SU','MO','TU','WE','TH','FR','SA'], code);
      if code = '' or day_idx is null then return null; end if;
      byday := byday || (day_idx - 1);
    end loop;
  end if;
  if freq <> 'WEEKLY' then byday := '{}'; end if;

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
    target := coalesce(target, extract(day from due_day)::int);
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
      --
      -- new.due_at si new.remind_at sunt perechea din ACEEASI stare finala a
      -- randului (ce a scris update-ul, nu ce era inainte). Nu inlocui cu
      -- old.due_at: ar aduna un decalaj intre o scadenta veche si un memento
      -- nou, care n-a existat niciodata ca pereche.
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
