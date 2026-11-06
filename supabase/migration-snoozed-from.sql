-- Amânarea nu mai trece la apariția următoare. Rulează o dată, ÎNAINTE de
-- deploy-ul funcției și ÎNAINTE de push: npm run migrate supabase/migration-snoozed-from.sql
-- Re-rulabilă: coloana cu `if not exists`, funcția cu `create or replace`.
--
-- Incidentul (ROUTIN-12, 2026-11-06, dovedit din jurnalele de producție): o
-- sarcină zilnică (scadența 08:00, mementoul la scadență) a fost amânată de mai
-- multe ori pe 3 noiembrie; ultima amânare de 15 min a pus `remind_at` =
-- 12:00:39. Apoi a fost bifată. Saltul ținea `delta := due_at - remind_at`,
-- deci amânarea (-4h00m39s) a devenit decalajul planificat: de atunci sună în
-- fiecare zi la 12:00:39 în loc de 08:00.
--
-- Regula nouă:
--   snoozed_from = mementoul PLANIFICAT al apariției curente, dinaintea primei
--                  amânări; null = neamânat. Cât e amânată, `due_at -
--                  snoozed_from` e decalajul ales de om.
--   * Amânările scriu `remind_at` = ținta ȘI `snoozed_from = coalesce(
--     snoozed_from, remind_at)` — a doua amânare păstrează baza primei. Una
--     care mută și scadența („mâine 9:00", „altă oră" pe Android) mută baza cu
--     aceeași distanță. Regula: `snoozeBase` (`src/lib/reminderAction.ts`,
--     port `core/SnoozeTarget.kt`, fixtures `reminderAction.fixtures.json`);
--     scriitorii: pagina (`reminderMutation`, `runNativeAction` — și cutia de
--     Linux, prin pagină), APK-ul (`ActionReceiver`, `SnoozeActivity`, coada
--     nativă) și `reminder-action` (notificarea fără nicio filă deschisă).
--   * Saltul de mai jos: `delta := due_at - coalesce(snoozed_from, remind_at)`,
--     apoi `snoozed_from := null` — apariția nouă nu e amânată. Oglinda TS:
--     `applyIssuePatch`/`moveDue` (`src/lib/issuePatch.ts`), fixtures comune
--     `ADVANCE_FIXTURES` din `src/lib/recurrence.fixtures.ts`, verificate aici
--     de `npm run test:recurrence-sql` (Postgres de unică folosință).
--   * O scriere de PLAN din pagină (formularul, foaia de dată, „Mâine") care
--     schimbă mementoul sau scadența trimite `snoozed_from: null` (`planPatch`).
--     `functions/api` și `tk` NU golesc încă: o reprogramare de acolo pe o
--     sarcină amânată sare la bifă de la planul vechi — doar pentru apariția aia.
--
-- Ordinea de deploy: migrarea → `supabase functions deploy reminder-action
-- --no-verify-jwt` → push → APK (`versionCode 24`). Fără coloană, pagina nouă
-- nu mai poate salva un memento (trimite `snoozed_from`), `reminder-action` nou
-- cade la amânare, iar citirea nativă a APK-ului nou primește 400.
--
-- Rândurile deja stricate (ROUTIN-12 sună acum la 12:00:39) NU se repară
-- singure: migrarea nu are de unde ști ora planificată. Se pune la loc din
-- formular, o dată.

alter table issues add column if not exists snoozed_from timestamptz;

-- Copia integrală a funcției din `migration-recurrence.sql`, cu cele două
-- schimbări marcate „snoozed_from". `next_occurrence` și trigger-ul
-- (`issues_zz_advance_recurrence`) rămân cele de acolo.
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
      --
      -- snoozed_from: decalajul e cel PLANIFICAT. Pe o sarcina amanata
      -- `remind_at` e ora amanarii; baza dinaintea primei amanari e in
      -- `snoozed_from` (ROUTIN-12, 2026-11-06 - vezi antetul).
      if new.remind_at is not null then delta := new.due_at - coalesce(new.snoozed_from, new.remind_at); end if;
      new.due_at    := nxt;
      new.remind_at := case when delta is null then null else nxt - delta end;
      -- snoozed_from: aparitia noua pleaca neamanata.
      new.snoozed_from := null;
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
