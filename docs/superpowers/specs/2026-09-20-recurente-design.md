# Recurențe — design

**Data:** 20 septembrie 2026. **Precedent:** `docs/superpowers/brainstorm/2026-08-24-mod-todo.md`,
secțiunea 7 („Recurență — amânat, dar coloana `rrule` se adaugă acum ca să nu fie
nevoie de a doua migrare"). Ziua aceea a venit.

## Ce există deja

- Coloana `issues.rrule text` (din `migration-todo.sql`), nefolosită de nimeni.
- `parseDue` recunoaște **două** tipare — „în fiecare luni" → `FREQ=WEEKLY`,
  „zilnic" → `FREQ=DAILY` — și le marchează ca spans refuzabile. Le recunoaște
  deliberat, ca fragmentul să nu rămână în titlu și să pară o eroare de parsare.
- `QuickAdd` arată jetonul „zilnic / săptămânal", `InfoPanel` îl descrie.
- **Nimic nu se întâmplă la bifare.** Un tichet „zilnic" bifat rămâne bifat.

Adică azi recurența e o etichetă. Designul ăsta îi adaugă motorul.

## Decizia centrală: un tichet care sare

La bifarea unei sarcini recurente, rândul **rămâne același**: `done` se reia pe
`false`, iar `due_at` avansează la următoarea apariție.

Alternativa — un rând-șablon plus câte un rând-instanță pe apariție — dă istoric
complet, dar plătește scump: ID-uri noi la fiecare apariție (deci `HZ-12` din bară
nu mai e un tichet, ci o serie), o întrebare „editez seria sau apariția?" în fiecare
formular, și un tabel care crește cu 365 de rânduri pe an pentru „bea apă".

Ce se pierde e istoricul apariției: aplicația nu poate spune „ai făcut-o marțea
trecută". Asumat: cererea nu există. Dacă apare, se adaugă separat, fără să strice
ce e aici.

### Saltul se calculează din ZIUA CURENTĂ, nu din scadență

Sarcină zilnică scadentă luni, n-o atingi până joi, joi o bifezi → **vineri**.

Nu marți. Regula „un pas de la scadență" ar fi corectă pentru o rată lunară, dar
pentru tot restul produce un tichet care rămâne roșu după ce l-ai făcut și
acumulează o datorie pe care nimeni n-o plătește. Zilele sărite dispar; nu sunt
datorate.

Consecință de reținut: două bifări în aceeași zi dau aceeași dată următoare. Nu e
un bug — o sarcină zilnică făcută de două ori azi tot mâine revine.

## Motorul

`src/lib/recurrence.ts` — pur, fără dependențe, cu fixtures, ca `engine.ts` și
`parseDue.ts`. Nu se pune logică de recurență în componente.

```ts
export interface Rec {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number          // ≥1; 1 nu se scrie în RRULE
  byday: number[]           // 0=duminică … 6=sâmbătă; doar WEEKLY
  bymonthday: number | null // doar MONTHLY
}

export function parseRrule(s: string | null): Rec | null
export function formatRrule(rec: Rec): string
export function describeRrule(rec: Rec): string        // RO: „la 2 zile", „lunea și joia"
export function nextOccurrence(rrule: string, from: Date, dueAt: string): string | null
```

**Subsetul RRULE acceptat.** `FREQ` (cele patru de mai sus), `INTERVAL`, `BYDAY`,
`BYMONTHDAY`. Fără `UNTIL`, fără `COUNT`, fără `BYSETPOS`. Un RRULE nerecunoscut
(scris de mână în bază, sau venit dintr-un import de mâine) întoarce `null` din
`parseRrule` și e tratat ca **absent**: tichetul se bifează normal. Nu aruncă.

**De ce nu biblioteca `rrule` de pe npm.** Aplicația e PWA offline-first: tot ce
importă intră în manifestul de precache, iar 30KB pentru un subset de patru
frecvențe e un preț plătit degeaba. Aceeași judecată ca la fontul de iconițe.

### `nextOccurrence` — regulile exacte

`from` e începutul zilei locale curente. Ora și `allDay` se păstrează din `dueAt`
(o sarcină zilnică la 14:00 rămâne la 14:00).

- **DAILY** — prima zi `> from` la distanță multiplu de `interval` de `dueAt`.
  Cu `interval = 1`, mâine.
- **WEEKLY** — dacă `byday` e gol, se deduce din ziua lui `dueAt`. Prima zi din
  `byday` strict după `from`; la trecerea săptămânii se sare `interval` săptămâni.
- **MONTHLY** — `bymonthday` (sau ziua din `dueAt`). **Se retează la lungimea
  lunii:** 31 ianuarie + lunar = 28 februarie, apoi 31 martie. Retezarea nu e
  memorată — se pleacă de fiecare dată de la ziua-țintă, altfel o sarcină de 31 ar
  aluneca pe 28 pe viață după o singură februarie.
- **YEARLY** — aceeași zi și lună, anul următor. 29 februarie → 28 februarie în
  anii nebisecți, aceeași regulă de retezare.

**Ora de vară.** Aritmetica se face pe componente locale (`setDate`/`setMonth`), nu
adunând milisecunde. O sarcină zilnică la 09:00 rămâne la 09:00 și peste schimbarea
orei; adunarea a 24h ar fi mutat-o la 08:00 sau 10:00, o dată pe an, pentru
totdeauna. Același motiv pentru care `all_day` există.

## Unde trăiește saltul: un trigger Postgres

`supabase/migration-recurrence.sql`:

```sql
alter table issues add column if not exists prev_due_at    timestamptz;
alter table issues add column if not exists prev_remind_at timestamptz;

-- before update, când `done` trece false→true și `rrule` e pus
create trigger issues_advance_recurrence before update on issues
  for each row execute function advance_recurrence();
```

Funcția: salvează `old.due_at` / `old.remind_at` în `prev_*`, calculează
următoarea apariție, mută `remind_at` cu **același decalaj** față de scadență
(deci `ReminderKind` rămâne ce era), și pune `new.done := false`.

**De ce trigger și nu cod de client.** Trei drumuri diferite bifează un tichet, și
doar unul e interfața:

1. `store.toggleDone` → `repository.updateIssue(id, { done: true })`.
2. Butonul „Gata" din notificare **fără nicio filă deschisă** → `reminder-action`,
   care face `db.from('issues').update({ done: true })` direct prin REST.
3. `functions/api/` (ticket-kit), cu cheia de serviciu.

Logica în store ar fi lăsat drumurile 2 și 3 să bifeze definitiv o sarcină
recurentă — exact drumul pe care omul îl folosește cel mai des dimineața, de pe
ecranul blocat. Un trigger e singura poziție din care toate trei sunt corecte, și
rămâne corect pentru al patrulea drum, care nu s-a scris încă.

Două lucruri ies gratis din poziția asta:

- `supabaseRepository.updateIssue` reciteşte rândul după update (`select().single()`
  la final), deci clientul primește înapoi rândul **deja sărit**, fără cod nou.
  Ecoul optimist arată bifa o clipă, apoi rândul revine cu data nouă — exact ce s-a
  întâmplat.
- Trigger-ul `issues_reset_reminder_sent` (din `migration-push.sql`) vede
  `remind_at` schimbat și golește `reminder_sent_at`. Mementoul apariției următoare
  se armează singur.

### Prețul: regula de salt trăiește în două limbi

TS (pentru interfață și `localRepository`, care n-are Postgres) și PL/pgSQL. Două
implementări ale aceleiași reguli înseamnă drift — nu „dacă", ci „când".

De aceea: **`npm run test:recurrence-sql`** rulează *aceleași fixtures* prin baza
reală, via `pg` (parametri separați, vezi CLAUDE.md — parola are `@` în ea). E
lent și cere rețea, deci nu intră în `npm test`, ca `test:layout` și `test:nav`.
Fără el, un tipar adăugat în TS trece toate testele și sare greșit în producție.

## Parserul

`parseDue.ts` capătă vocabularul întreg, cu spans ca acum (fiecare fragment
refuzabil separat):

| text | RRULE |
|---|---|
| `zilnic`, `daily`, `în fiecare zi` | `FREQ=DAILY` |
| `la 2 zile`, `din 3 în 3 zile`, `every 2 days` | `FREQ=DAILY;INTERVAL=2` |
| `în fiecare luni`, `lunea`, `every monday` | `FREQ=WEEKLY;BYDAY=MO` |
| `lunea și joia`, `luni, miercuri, vineri` | `FREQ=WEEKLY;BYDAY=MO,TH` |
| `săptămânal`, `weekly` | `FREQ=WEEKLY` (ziua din scadență) |
| `la 2 săptămâni` | `FREQ=WEEKLY;INTERVAL=2` |
| `lunar`, `în fiecare lună`, `monthly` | `FREQ=MONTHLY` |
| `pe 15 ale lunii`, `on the 15th` | `FREQ=MONTHLY;BYMONTHDAY=15` |
| `anual`, `în fiecare an`, `yearly` | `FREQ=YEARLY` |

**Recurență fără dată ⇒ scadența devine azi.** „zilnic bea apă" produce azi ca
primă apariție. Fără asta, motorul n-ar avea de unde pleca — o recurență e o
funcție de o dată de start.

Ciocnirea care trebuie rezolvată explicit: „în fiecare luni" setează **și** rrule,
**și** prima apariție (lunea următoare) — asta face deja. Dar „lunea" singur, fără
„în fiecare", e azi o simplă zi a săptămânii. Rămâne așa: „luni" = data, „lunea" /
„în fiecare luni" = recurență. Forma articulată e semnalul, în română.

`InfoPanel` primește exemplele noi în `GROUPS` — **calculate cu `parseDue` la
randare, nu scrise de mână**, ca tot tabelul de acolo. Regula din CLAUDE.md: dacă
adaugi un tipar în parser, adaugi un exemplu, nu o descriere.

## Interfața

**Rând „Repetare" în `IssueForm`**, imediat sub scadență. Închis arată
`describeRrule` sau nimic — absența e informația, ca la `DueChip`. Deschis, o foaie
mică: *niciodată · zilnic · săptămânal · lunar · anual · personalizat*.
„Personalizat" dă intervalul (`la [n] [zile|săptămâni|luni]`) și, pentru
săptămânal, zilele.

Rândul apare **doar dacă tichetul are scadență** (sau o capătă la alegerea unei
recurențe: scadența se completează cu azi). Un tichet de proiect fără dată nu vede
niciodată câmpul.

**`DueChip` capătă iconița `recurring`** (există deja în vocabularul `Icon`, o
folosește `QuickAdd`). Fiind în `DueChip`, apare la fel în „Ordine", în „Listă" și
în listele inteligente — același motiv pentru care clopoțelul e exportat de acolo.

**Anularea unui pas.** `Toast` capătă o acțiune opțională (`action: { label,
onClick }`). La bifarea unei sarcini recurente: „Gata · revine vineri —
**ANULEAZĂ**". Acțiunea cheamă `store.undoRecurringDone(id)`, care scrie
`{ dueAt: prev_due_at, remindAt: prev_remind_at, done: false }` și golește `prev_*`.
Trigger-ul nu se declanșează (`done` nu trece false→true), deci nu există buclă.

Un pas, nu un istoric: `prev_*` se suprascriu la fiecare salt. Greșeala pe care o
repară e „am atins bifa din greșeală", și aia se observă imediat.

## Ce NU se atinge

`computeLayers`, valurile, `post_to_thread`, `issue_events`, strategia de update a
service worker-ului, `functions/api`. Recurența trăiește exclusiv pe axa scadenței.
Un tichet recurent nu-și schimbă niciodată layerul la bifare — el nici nu devine
`done`, deci graful nici nu observă.

`localRepository` (modul local, fără conturi) face saltul în TS, la `updateIssue`,
cu aceeași `nextOccurrence`. Paritate, ca la restul câmpurilor de scadență.

## Teste

- `src/lib/recurrence.test.ts` — fixtures: cele patru frecvențe, interval, `BYDAY`
  multiplu, **31 ianuarie + lunar → 28 februarie → 31 martie**, 29 februarie +
  anual, bifare după trei zile sărite, ora de vară la 09:00 peste ultimul weekend
  din martie, RRULE nerecunoscut → `null`.
- `scripts/test-recurrence-sql.mjs` (`npm run test:recurrence-sql`) — aceleași
  fixtures prin Postgres.
- `src/lib/parseDue.test.ts` — un caz pe rând din tabelul de mai sus, plus „lunea"
  ≠ „luni", plus refuzul unui fragment de recurență.
- `npm run test:layout` — rândul nou din formular intră într-un rând de flex
  (scadența a strivit deja un câmp la 0px o dată).
- Manual, cu conturi reale: „Gata" din notificare **cu telefonul blocat și fila
  închisă** pe o sarcină zilnică → a doua zi vine mementoul următor. Ăsta e drumul
  pe care un client-side l-ar fi ratat, deci e drumul care se verifică.

## Ordinea de construcție

1. `recurrence.ts` + fixtures. Motorul se validează înainte să existe interfață
   peste el — la fel ca `engine.ts` față de `_EXPECTED_LAYERS`.
2. Migrarea + trigger-ul + `test:recurrence-sql`.
3. `parseDue` extins + exemplele din `InfoPanel`.
4. Rândul „Repetare" din formular + iconița din `DueChip`.
5. `Toast` cu acțiune + `undoRecurringDone`.
6. Paritate `localRepository`.

Pasul de setup: `npm run migrate supabase/migration-recurrence.sql`.
