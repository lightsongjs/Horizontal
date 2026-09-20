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
  --
  -- Plafonul de LUNGIME e ce tine functia sa nu ARUNCE: `INTERVAL=99999999999`
  -- nu incape in int4, iar castul ridica eroare - intr-un trigger `before
  -- update`, asta anuleaza tot update-ul, deci randul nu se mai poate bifa
  -- deloc. Si nu cere junk pus de mana in baza: parserul de text il producea
  -- din „la 99999999999 zile". Zerourile din fata se taie inainte de numarat,
  -- ca `0005` sa ramana 5, exact ca `Number('0005')` in TS. 999 = MAX_INTERVAL
  -- din `src/lib/recurrence.ts`.
  if interval_s is null then
    step := 1;
  elsif interval_s !~ '^[0-9]+$' then
    return null;
  elsif length(ltrim(interval_s, '0')) > 3 then
    return null;
  else
    step := interval_s::int;
  end if;
  if step < 1 or step > 999 then return null; end if;

  -- BYMONTHDAY: validat CHIAR DACA freq nu e MONTHLY - ca in TS, unde
  -- valoarea e verificata neconditionat si folosita (sau aruncata) abia la
  -- capatul functiei de parsare.
  if bymonth_s is not null then
    if bymonth_s !~ '^[0-9]+$' then return null; end if;
    -- Acelasi plafon de lungime ca la INTERVAL, si din acelasi motiv: castul e
    -- INAINTEA verificarii 1..31, deci `BYMONTHDAY=99999999999` arunca inainte
    -- sa apuce cineva sa spuna ca nu e o zi din luna.
    if length(ltrim(bymonth_s, '0')) > 2 then return null; end if;
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

  -- Aritmetica sta intr-un bloc care PRINDE depasirile, fiindca regula e a
  -- functiei intregi, nu a unei linii: `next_occurrence` raspunde „nu stiu" cu
  -- null, ca la un RRULE strain. E chemata dintr-un trigger `before update`,
  -- iar acolo o eroare nu e un raspuns - e tot update-ul anulat, adica un rand
  -- care nu se mai poate bifa. Plafoanele de mai sus opresc literalele scrise
  -- de om; asta opreste si ce iese din inmultire (`due_day + k * step` pe o
  -- scadenta absurda deja aflata in baza), unde TS intoarce oricum null.
  begin
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
  exception
    when numeric_value_out_of_range or datetime_field_overflow then return null;
  end;
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
      -- Mementoul aparitiei urmatoare pleaca NELIVRAT. Pana acum asta o facea
      -- `issues_reset_reminder_sent` pentru noi; de cand saltul ruleaza dupa el
      -- (vezi nota de la trigger), si-o face singur.
      new.reminder_sent_at := null;
      -- Nu se inchide: sarcina recurenta n-are stare finala.
      new.done := false;
    end if;
  end if;

  -- Un memento care ajunge in TRECUT pe un rand recurent pleaca marcat ca deja
  -- livrat. Regula e scrisa o data, aici, fiindca aceeasi gaura se deschide pe
  -- doua drumuri:
  --
  --   * saltul de mai sus, cand decalajul ales de om e mai mare decat pasul
  --     recurentei - „cu o zi inainte" pe o sarcina ZILNICA da mereu un memento
  --     de ieri. Cronul l-ar trimite in minutul urmator, pentru o sarcina pe
  --     care omul tocmai a bifat-o, si asa in FIECARE zi;
  --   * ANULEAZA (`undoRecurrence`), care rescrie scadenta si mementoul de
  --     dinainte de salt - adica un memento deja trecut si deja trimis, caruia
  --     `issues_reset_reminder_sent` tocmai i-a sters urma fiindca `remind_at`
  --     s-a schimbat. Fara regula asta, mementoul primit acum trei minute se
  --     retrimite.
  --
  -- Decalajul ales ramane intreg pentru aparitiile urmatoare, unde incape - a
  -- goli `remind_at` in schimb ar fi pierdut tacit setarea omului dupa o
  -- singura bifare. Randurile FARA `rrule` nu se ating: acolo o scadenta pusa
  -- in trecut cu mana suna la primul cron, ca pana acum, si e o consecinta a
  -- unui gest, nu ceva ce se intampla singur.
  if new.rrule is not null
     and new.remind_at is not null
     and new.remind_at is distinct from old.remind_at
     and new.remind_at <= now()
     and new.reminder_sent_at is null then
    new.reminder_sent_at := now();
  end if;

  return new;
end;
$$;

-- Ordinea trigger-elor BEFORE UPDATE e ALFABETICA dupa nume, iar asta conteaza
-- - acum in sens INVERS fata de prima versiune a fisierului. `zz_` pune saltul
-- DUPA `issues_reset_reminder_sent` (din migration-push.sql).
--
-- De ce s-a intors ordinea: inainte saltul rula primul si se bizuia pe celalalt
-- sa goleasca `reminder_sent_at`. Dar saltul are nevoie sa si PUNA campul ala,
-- cand mementoul calculat cade in trecut (vezi nota din functie) - iar o
-- decizie luata primul ar fi fost stearsa de al doilea, tacut. Asa, saltul
-- decide singur tot ce tine de el: scadenta, mementoul, urma trimiterii si
-- `done`, intr-un singur loc care se citeste dintr-o data.
--
-- Numele urat e pretul ordinii, si se plateste o singura data. Daca il
-- redenumesti, verifica litera: trebuie sa ramana dupa `issues_reset_...`.
drop trigger if exists issues_advance_recurrence on issues;
drop trigger if exists issues_zz_advance_recurrence on issues;
create trigger issues_zz_advance_recurrence before update on issues
  for each row execute function advance_recurrence();
