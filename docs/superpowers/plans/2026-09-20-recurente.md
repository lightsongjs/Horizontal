# Recurențe — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O sarcină cu `rrule` bifată nu se închide — sare singură la următoarea apariție, cu mementoul mutat odată cu ea, indiferent din ce drum a fost bifată.

**Architecture:** Motorul de date e un modul TS pur (`src/lib/recurrence.ts`), oglindit într-o funcție Postgres (`next_occurrence`) pe care un trigger `before update` o cheamă la fiecare trecere `done: false → true`. Trigger-ul e poziția din care toate cele trei drumuri de bifare (interfață, `reminder-action` fără filă, `functions/api`) sunt corecte fără cod duplicat în fiecare. Oglinda TS/SQL e păzită de un test de paritate care rulează aceleași fixtures prin baza reală. Interfața nu conține logică de dată: alege un RRULE, îl afișează prin `describeRrule`, atât.

**Tech Stack:** TypeScript + React 19 + Vite, Supabase (Postgres + RLS + edge functions Deno), vitest, `pg` pentru scripturi de bază, Playwright pentru testele de geometrie. **Nicio dependență nouă.**

**Spec:** `docs/superpowers/specs/2026-09-20-recurente-design.md`

## Global Constraints

- **Fără dependențe npm noi.** Subsetul RRULE se scrie de mână; biblioteca `rrule` (~30KB) ar intra în manifestul de precache al PWA-ului.
- **Subsetul RRULE acceptat:** `FREQ` ∈ {`DAILY`,`WEEKLY`,`MONTHLY`,`YEARLY`}, `INTERVAL`, `BYDAY`, `BYMONTHDAY`. Orice altă cheie (`UNTIL`, `COUNT`, `BYSETPOS`, …) ⇒ RRULE **nerecunoscut** ⇒ tratat ca absent (tichetul se bifează normal). Nu se aruncă niciodată.
- **Fusul orar din SQL e constanta `'Europe/Bucharest'`**, parametru cu valoare implicită pe `next_occurrence`. TS folosește fusul browserului. Testul de paritate rulează cu `TZ=Europe/Bucharest`, altfel compară mere cu pere.
- **Aritmetica de dată se face pe componente locale** (`setDate`/`setMonth` în TS, `at time zone` în SQL), niciodată prin adunare de milisecunde. O sarcină zilnică la 09:00 rămâne la 09:00 peste schimbarea orei de vară.
- **Saltul se calculează din `greatest(ziua curentă, ziua scadenței)`**, nu dintr-un pas de la scadență. Zilele sărite dispar, nu se acumulează.
- **`computeLayers`, valurile, `issue_events`, `post_to_thread` și strategia de update a service worker-ului nu se ating.** Recurența trăiește exclusiv pe axa scadenței.
- **Nu se dă `git push`.** Pe `master`, un push publică imediat în producție (CLAUDE.md). Commit-uri da, push nu — omul decide când.
- **Textele de interfață sunt în română**, cu diacritice.
- **Fără emoji.** Iconițele vin din `src/components/Icon.tsx`, cu nume de rol.

## File Structure

| fișier | rol |
|---|---|
| `src/lib/recurrence.ts` (nou) | Motorul pur: `parseRrule`, `formatRrule`, `describeRrule`, `nextOccurrence`. Singurul loc cu aritmetică de recurență în TS. |
| `src/lib/recurrence.test.ts` (nou) | Fixtures. Sursa de adevăr pentru testul de paritate SQL. |
| `supabase/migration-recurrence.sql` (nou) | `next_occurrence()` + trigger `issues_advance_recurrence`. |
| `scripts/test-recurrence-sql.mjs` (nou) | Rulează fixture-urile prin Postgres. `npm run test:recurrence-sql`. |
| `src/data/localRepository.ts` (mod.) | Paritate: saltul în TS, unde nu există Postgres. |
| `src/lib/parseDue.ts` (mod.) | Vocabularul de recurență: interval, zile multiple, lunar, anual. |
| `src/components/InfoPanel.tsx` (mod.) | Exemplele noi, calculate cu `parseDue`. |
| `src/components/RecurrencePicker.tsx` (nou) | Foaia mică de „personalizat": interval + zilele săptămânii. Nu atinge stiva de foi. |
| `src/components/IssueForm.tsx` (mod.) | Rândul „Repetare", sub scadență. |
| `src/components/DueChip.tsx` (mod.) | Iconița `recurring`, deci apare la fel în toate cele trei moduri de afișare. |
| `src/components/QuickAdd.tsx` (mod.) | Jetonul de recurență prin `describeRrule`, nu prin `if`-uri pe string. |
| `src/components/Toast.tsx` (mod.) | Acțiune opțională. |
| `src/store.tsx` (mod.) | `recurrenceUndo`, `undoRecurrence`, `clearRecurrenceUndo`. |
| `src/App.tsx` (mod.) | Leagă toast-ul de acțiune. |
| `src/styles.css` (mod.) | `.due-recur`, `.rp-*`, `.toast-act`. |
| `package.json` (mod.) | Scriptul `test:recurrence-sql`. |
| `CLAUDE.md` (mod.) | Secțiunea „Recurențe" + pasul de migrare. |

---

### Task 1: Motorul pur — `src/lib/recurrence.ts`

**Files:**
- Create: `src/lib/recurrence.ts`
- Create: `src/lib/recurrence.fixtures.ts`
- Create: `src/lib/recurrence.test.ts`

**Interfaces:**
- Consumes: `startOfLocalDay`, `addDays` din `src/lib/schedule.ts`.
- Produces:
  - `interface Rec { freq: 'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY'; interval: number; byday: number[]; bymonthday: number | null }` (`byday`: 0 = duminică … 6 = sâmbătă)
  - `parseRrule(s: string | null): Rec | null`
  - `formatRrule(rec: Rec): string`
  - `describeRrule(s: string | null): string` — textul românesc, `''` dacă nu e recunoscut
  - `nextOccurrence(rrule: string | null, from: Date, dueAt: string | null): string | null`

- [ ] **Step 1: Write the failing test**

Întâi fixture-urile, într-un fișier **fără niciun import de vitest** — scriptul
de paritate din Task 2 le citește din Node, unde `vitest` nu există.

Creează `src/lib/recurrence.fixtures.ts`:

```ts
// Cazurile de recurență, o singură dată, pentru două limbi.
//
// `recurrence.test.ts` le trece prin motorul TS; `scripts/test-recurrence-sql.mjs`
// prin `next_occurrence()` din Postgres. Un caz adăugat aici e verificat automat
// în amândouă. Fișierul NU importă vitest: scriptul îl încarcă din Node.

/** Ziua locală `y-m-d` la ora `h:mi`, ca ISO. Luna e 1-based aici, ca în vorbire. */
function iso(y: number, m: number, d: number, h = 9, mi = 0): string {
  return new Date(y, m - 1, d, h, mi, 0, 0).toISOString()
}

export interface Fixture {
  name: string
  rrule: string
  /** Scadența de dinainte de salt. */
  due: string
  /** „Acum" — ziua din care se calculează saltul. */
  from: string
  /** Ziua locală așteptată, `YYYY-MM-DD HH:mm`, sau `null` dacă nu se sare. */
  want: string | null
}

export const FIXTURES: Fixture[] = [
```

(conținutul tabelului e cel de mai jos, la Step 1b)

Apoi `src/lib/recurrence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FIXTURES } from './recurrence.fixtures'
import { describeRrule, formatRrule, jumpNotice, nextOccurrence, parseRrule } from './recurrence'

// Luni, 24 august 2026 — aceeași ancoră ca în `schedule.test.ts`.
const NOW = new Date(2026, 7, 24, 8, 40)

/** Ce zi locală a ieșit, în forma `2026-08-25 09:00`. Compararea de ISO-uri ar
 *  fi ascuns exact bug-ul de fus pe care testele astea îl caută. */
function local(s: string | null): string | null {
  if (!s) return null
  const d = new Date(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

describe('parseRrule', () => {
  it('citește subsetul acceptat', () => {
    expect(parseRrule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1, byday: [], bymonthday: null })
    expect(parseRrule('FREQ=DAILY;INTERVAL=2')).toMatchObject({ freq: 'DAILY', interval: 2 })
    expect(parseRrule('FREQ=WEEKLY;BYDAY=MO,TH')).toMatchObject({ freq: 'WEEKLY', byday: [1, 4] })
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=15')).toMatchObject({ freq: 'MONTHLY', bymonthday: 15 })
    expect(parseRrule('FREQ=YEARLY')).toMatchObject({ freq: 'YEARLY' })
  })

  it('refuză ce nu tratează — un RRULE nerecunoscut e ca unul absent', () => {
    expect(parseRrule(null)).toBeNull()
    expect(parseRrule('')).toBeNull()
    expect(parseRrule('FREQ=HOURLY')).toBeNull()
    // UNTIL/COUNT ar mărgini seria; a le ignora ar transforma o serie finită
    // într-una infinită — mai rău decât a nu o repeta deloc.
    expect(parseRrule('FREQ=DAILY;UNTIL=20261231T000000Z')).toBeNull()
    expect(parseRrule('FREQ=DAILY;COUNT=10')).toBeNull()
    expect(parseRrule('FREQ=MONTHLY;BYSETPOS=3;BYDAY=TU')).toBeNull()
    expect(parseRrule('FREQ=DAILY;INTERVAL=0')).toBeNull()
  })

  it('face drumul dus-întors', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY;BYDAY=MO,TH',
                     'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=YEARLY']) {
      expect(formatRrule(parseRrule(s)!)).toBe(s)
    }
  })
})

describe('describeRrule', () => {
  it('spune în română ce s-a ales', () => {
    expect(describeRrule('FREQ=DAILY')).toBe('zilnic')
    expect(describeRrule('FREQ=DAILY;INTERVAL=2')).toBe('la 2 zile')
    expect(describeRrule('FREQ=WEEKLY')).toBe('săptămânal')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO')).toBe('lunea')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('lunea și joia')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('lunea, miercurea și vinerea')
    expect(describeRrule('FREQ=WEEKLY;INTERVAL=2')).toBe('la 2 săptămâni')
    expect(describeRrule('FREQ=MONTHLY')).toBe('lunar')
    expect(describeRrule('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('pe 15 ale lunii')
    expect(describeRrule('FREQ=YEARLY')).toBe('anual')
    expect(describeRrule('FREQ=HOURLY')).toBe('')
  })
})

```

- [ ] **Step 1b: Tabelul de fixtures**

Conținutul lui `FIXTURES` din `src/lib/recurrence.fixtures.ts`:

```ts
  { name: 'zilnic, bifată în ziua scadenței', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-25 09:00' },
  { name: 'zilnic, trei zile sărite — sare din AZI, nu din scadență', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 27), want: '2026-08-28 09:00' },
  { name: 'zilnic, bifată înainte de scadență — tot un pas mai departe', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 26), from: iso(2026, 8, 24), want: '2026-08-27 09:00' },
  { name: 'la 2 zile, cu zile sărite — rămâne pe grila scadenței', rrule: 'FREQ=DAILY;INTERVAL=2',
    due: iso(2026, 8, 24), from: iso(2026, 8, 27), want: '2026-08-28 09:00' },
  { name: 'săptămânal fără BYDAY — ziua vine din scadență', rrule: 'FREQ=WEEKLY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-31 09:00' },
  { name: 'lunea și joia, bifată luni', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-27 09:00' },
  { name: 'lunea și joia, bifată joi', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    due: iso(2026, 8, 27), from: iso(2026, 8, 27), want: '2026-08-31 09:00' },
  { name: 'la 2 săptămâni, lunea', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-09-07 09:00' },
  { name: 'lunar pe 15', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
    due: iso(2026, 8, 15), from: iso(2026, 8, 24), want: '2026-09-15 09:00' },
  { name: 'lunar pe 31 → februarie se retează la 28', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    due: iso(2027, 1, 31), from: iso(2027, 1, 31), want: '2027-02-28 09:00' },
  { name: 'lunar pe 31 → retezarea NU se memorează, martie revine pe 31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    due: iso(2027, 2, 28), from: iso(2027, 2, 28), want: '2027-03-31 09:00' },
  { name: 'anual pe 29 februarie → an nebisect, 28', rrule: 'FREQ=YEARLY',
    due: iso(2028, 2, 29), from: iso(2028, 2, 29), want: '2029-02-28 09:00' },
  { name: 'anual obișnuit', rrule: 'FREQ=YEARLY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2027-08-24 09:00' },
  { name: 'zi întreagă — ora 00:00 se păstrează', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24, 0, 0), from: iso(2026, 8, 24), want: '2026-08-25 00:00' },
  { name: 'peste trecerea la ora de vară — ora locală rămâne 09:00', rrule: 'FREQ=DAILY',
    due: iso(2027, 3, 27), from: iso(2027, 3, 27), want: '2027-03-28 09:00' },
  { name: 'peste trecerea la ora de iarnă — ora locală rămâne 09:00', rrule: 'FREQ=DAILY',
    due: iso(2026, 10, 24), from: iso(2026, 10, 24), want: '2026-10-25 09:00' },
  { name: 'RRULE nerecunoscut — nu sare', rrule: 'FREQ=DAILY;COUNT=3',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
]
```

Și, înapoi în `src/lib/recurrence.test.ts`, partea care le rulează:

```ts
describe('nextOccurrence', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      expect(local(nextOccurrence(f.rrule, new Date(f.from), f.due))).toBe(f.want)
    })
  }

  it('fără scadență nu are de unde pleca', () => {
    expect(nextOccurrence('FREQ=DAILY', NOW, null)).toBeNull()
  })
})

describe('jumpNotice', () => {
  it('spune când revine', () => {
    // Luna scurtă o dă `toShortDate` — rulează-l o dată și pune AICI ce
    // întoarce el, nu ce presupui tu.
    expect(jumpNotice(new Date(2026, 7, 25, 9, 0).toISOString())).toMatch(/^Gata · revine /)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/recurrence.test.ts`
Expected: FAIL — `Failed to resolve import "./recurrence"`.

- [ ] **Step 3: Write the implementation**

Creează `src/lib/recurrence.ts`:

```ts
// Motorul de recurență: din ce RRULE avem și când suntem, care e următoarea
// apariție. Pur, fără dependențe, testat pe fixtures — ca `engine.ts` și
// `schedule.ts`. Nu pune logică de recurență în componente.
//
// Subsetul acceptat e mic și deliberat: FREQ (patru valori), INTERVAL, BYDAY,
// BYMONTHDAY. Biblioteca `rrule` de pe npm ar fi acoperit tot iCalendar, dar
// aplicația e PWA offline-first — tot ce se importă intră în manifestul de
// precache, iar 30KB pentru patru frecvențe e un preț plătit degeaba. Aceeași
// judecată ca la fontul de iconițe.
//
// ORICE se schimbă aici se schimbă și în `next_occurrence()` din
// `supabase/migration-recurrence.sql`, iar `npm run test:recurrence-sql`
// verifică asta pe aceleași fixtures. Regula de salt trăiește în două limbi
// fiindcă bifarea vine din trei drumuri, dintre care doar unul e clientul.

import { addDays, startOfLocalDay, toShortDate } from './schedule'

export interface Rec {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  /** ≥ 1. Valoarea 1 nu se scrie în RRULE. */
  interval: number
  /** 0 = duminică … 6 = sâmbătă. Gol pentru orice altceva decât WEEKLY. */
  byday: number[]
  /** Doar MONTHLY. */
  bymonthday: number | null
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Ziua articulată, forma în care se scrie o recurență în română: „lunea". */
const DAY_NAMES = ['duminica', 'lunea', 'marțea', 'miercurea', 'joia', 'vinerea', 'sâmbăta']

/** Cheile pe care le înțelegem. Orice alta face RRULE-ul nerecunoscut. */
const KNOWN_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY'])

/**
 * RRULE → `Rec`, sau `null`.
 *
 * `null` înseamnă „nu știu să repet asta", iar apelantul tratează tichetul ca
 * nerecurent — se bifează normal. Nu aruncă: un RRULE scris de mână în bază sau
 * venit dintr-un import de mâine n-are voie să strice bifarea.
 *
 * `UNTIL` și `COUNT` sunt refuzate anume, nu ignorate: ignorate ar transforma o
 * serie mărginită într-una fără sfârșit.
 */
export function parseRrule(s: string | null): Rec | null {
  if (!s) return null
  const parts = s.split(';').filter(Boolean)
  const map = new Map<string, string>()
  for (const p of parts) {
    const i = p.indexOf('=')
    if (i < 0) return null
    const key = p.slice(0, i).toUpperCase()
    if (!KNOWN_KEYS.has(key)) return null
    map.set(key, p.slice(i + 1).toUpperCase())
  }

  const freq = map.get('FREQ')
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null

  const interval = map.has('INTERVAL') ? Number(map.get('INTERVAL')) : 1
  if (!Number.isInteger(interval) || interval < 1) return null

  let byday: number[] = []
  if (map.has('BYDAY')) {
    byday = map.get('BYDAY')!.split(',').map((c) => DAY_CODES.indexOf(c))
    if (byday.some((i) => i < 0)) return null
    byday.sort((a, b) => a - b)
  }

  let bymonthday: number | null = null
  if (map.has('BYMONTHDAY')) {
    bymonthday = Number(map.get('BYMONTHDAY'))
    if (!Number.isInteger(bymonthday) || bymonthday < 1 || bymonthday > 31) return null
  }

  // BYDAY pe altceva decât WEEKLY și BYMONTHDAY pe altceva decât MONTHLY n-ar
  // avea unde să fie folosite; le scoatem ca `formatRrule` să nu le scrie la loc.
  return {
    freq,
    interval,
    byday: freq === 'WEEKLY' ? byday : [],
    bymonthday: freq === 'MONTHLY' ? bymonthday : null,
  }
}

export function formatRrule(rec: Rec): string {
  let s = `FREQ=${rec.freq}`
  if (rec.interval > 1) s += `;INTERVAL=${rec.interval}`
  if (rec.freq === 'WEEKLY' && rec.byday.length) s += `;BYDAY=${rec.byday.map((i) => DAY_CODES[i]).join(',')}`
  if (rec.freq === 'MONTHLY' && rec.bymonthday) s += `;BYMONTHDAY=${rec.bymonthday}`
  return s
}

/** „lunea, miercurea și vinerea" — ultima legătură e „și", ca în vorbire. */
function joinRo(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} și ${items[items.length - 1]}`
}

/**
 * Ce se arată omului. `''` pentru un RRULE nerecunoscut sau absent — interfața
 * atunci nu afișează nimic, iar absența e informația (ca la `DueChip`).
 */
export function describeRrule(s: string | null): string {
  const rec = parseRrule(s)
  if (!rec) return ''
  const every = (n: number, one: string, many: string) => (n === 1 ? one : `la ${n} ${many}`)
  switch (rec.freq) {
    case 'DAILY':
      return every(rec.interval, 'zilnic', 'zile')
    case 'WEEKLY': {
      const head = every(rec.interval, 'săptămânal', 'săptămâni')
      if (!rec.byday.length) return head
      const days = joinRo(rec.byday.map((i) => DAY_NAMES[i]))
      return rec.interval === 1 ? days : `${head}, ${days}`
    }
    case 'MONTHLY': {
      const head = every(rec.interval, 'lunar', 'luni')
      if (!rec.bymonthday) return head
      return rec.interval === 1 ? `pe ${rec.bymonthday} ale lunii` : `${head}, pe ${rec.bymonthday}`
    }
    default:
      return every(rec.interval, 'anual', 'ani')
  }
}

/**
 * Ce scrie în toast după ce o sarcină recurentă a sărit.
 *
 * Stă aici, lângă motor, nu în store: e o propoziție despre o dată, iar așa se
 * testează fără să pornească React și fără să atingă Supabase.
 */
export function jumpNotice(dueAt: string): string {
  return `Gata · revine ${toShortDate(dueAt)}`
}

function daysInMonth(y: number, m: number): number {
  // Ziua 0 a lunii următoare = ultima zi a lunii cerute.
  return new Date(y, m + 1, 0).getDate()
}

/** Lunea săptămânii lui `d`, ca să se poată număra săptămâni întregi. */
function weekStart(d: Date): Date {
  const x = startOfLocalDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

function weeksBetween(a: Date, b: Date): number {
  // Rotunjire, nu împărțire exactă: o săptămână cu schimbare de oră n-are
  // 7×86400000 ms. Același motiv ca la `dayOffset` din `schedule.ts`.
  return Math.round((weekStart(b).getTime() - weekStart(a).getTime()) / (7 * 86_400_000))
}

/**
 * Următoarea apariție, ca ISO — sau `null` dacă nu e cazul.
 *
 * Se pleacă de la `max(ziua lui from, ziua scadenței)` și se cere strict mai
 * mult decât atât. Adică: bifezi o sarcină zilnică restantă de luni, joi → sare
 * pe vineri. Zilele sărite dispar; nu sunt datorate. Iar bifarea în avans
 * („zilnică scadentă poimâine, o fac azi") tot înaintează, altfel ar rămâne
 * scadentă poimâine și ai face-o de două ori.
 *
 * Ora și minutul se păstrează din `dueAt` — inclusiv `00:00`, convenția pentru
 * zi întreagă. Aritmetica e pe componente locale, nu pe milisecunde, deci ora
 * de vară nu deplasează sarcina cu un ceas o dată pe an, pentru totdeauna.
 */
export function nextOccurrence(rrule: string | null, from: Date, dueAt: string | null): string | null {
  const rec = parseRrule(rrule)
  if (!rec || !dueAt) return null

  const due = new Date(dueAt)
  const dueDay = startOfLocalDay(due)
  const base = new Date(Math.max(startOfLocalDay(from).getTime(), dueDay.getTime()))
  let day: Date | null = null

  if (rec.freq === 'DAILY') {
    const gap = Math.round((base.getTime() - dueDay.getTime()) / 86_400_000)
    // Primul multiplu de `interval` care trece strict de `base`. Cu interval 1
    // e „mâine"; cu 2, se rămâne pe grila pornită de la scadență.
    const k = Math.max(1, Math.ceil((gap + 1) / rec.interval))
    day = addDays(dueDay, k * rec.interval)
  } else if (rec.freq === 'WEEKLY') {
    const days = rec.byday.length ? rec.byday : [dueDay.getDay()]
    // Scanare zi cu zi, nu aritmetică deșteaptă: e aceeași în TS și în SQL,
    // deci paritatea e evidentă la citire, nu doar la rulare.
    for (let i = 1; i <= 366; i++) {
      const c = addDays(base, i)
      if (!days.includes(c.getDay())) continue
      if (weeksBetween(dueDay, c) % rec.interval !== 0) continue
      day = c
      break
    }
  } else if (rec.freq === 'MONTHLY') {
    const target = rec.bymonthday ?? dueDay.getDate()
    for (let k = 1; k <= 120; k++) {
      const y = dueDay.getFullYear()
      const m = dueDay.getMonth() + k * rec.interval
      // Retezarea se aplică de fiecare dată pornind de la ziua-ȚINTĂ, nu de la
      // ce a ieșit luna trecută: altfel o sarcină de 31 ar aluneca pe 28 pe
      // viață după o singură februarie.
      const c = new Date(y, m, Math.min(target, daysInMonth(y, m)))
      if (c.getTime() > base.getTime()) { day = c; break }
    }
  } else {
    for (let k = 1; k <= 20; k++) {
      const y = dueDay.getFullYear() + k * rec.interval
      const m = dueDay.getMonth()
      const c = new Date(y, m, Math.min(dueDay.getDate(), daysInMonth(y, m)))
      if (c.getTime() > base.getTime()) { day = c; break }
    }
  }

  if (!day) return null
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), due.getHours(), due.getMinutes(), 0, 0).toISOString()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/recurrence.test.ts`
Expected: PASS, toate cazurile.

- [ ] **Step 5: Rulează fixture-urile și într-un fus cu oră de vară**

Run: `TZ=Europe/Bucharest npx vitest run src/lib/recurrence.test.ts`
Expected: PASS. Cele două cazuri de schimbare a orei sunt informative doar într-un fus care chiar face schimbarea; într-un mediu pe UTC trec fără să demonstreze nimic.

- [ ] **Step 6: Typecheck și suita întreagă**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/recurrence.ts src/lib/recurrence.test.ts
git commit -m "feat(recurență): motorul pur — RRULE subset, următoarea apariție"
```

---

### Task 2: Migrarea, trigger-ul și testul de paritate

**Files:**
- Create: `supabase/migration-recurrence.sql`
- Create: `scripts/test-recurrence-sql.mjs`
- Modify: `package.json` (secțiunea `scripts`)

**Interfaces:**
- Consumes: `FIXTURES` exportat din `src/lib/recurrence.test.ts` (Task 1).
- Produces: funcția SQL `next_occurrence(p_rrule text, p_due timestamptz, p_now timestamptz, p_tz text default 'Europe/Bucharest') returns timestamptz` și trigger-ul `issues_advance_recurrence` pe `issues`. Scriptul `npm run test:recurrence-sql`.

- [ ] **Step 1: Scrie migrarea**

Creează `supabase/migration-recurrence.sql`:

```sql
-- Recurențe: o sarcină bifată nu se închide, ci sare la următoarea apariție.
-- Rulează o dată: npm run migrate supabase/migration-recurrence.sql
-- Safe to re-run.
--
-- De ce trigger și nu cod de client: trei drumuri diferite bifează un tichet —
-- interfața, butonul Gata din notificare FARA nicio fila deschisa
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
-- goleste `reminder_sent_at`. Adica mementoul apariției urmatoare se armeaza
-- singur. Daca redenumesti vreodata trigger-ul asta, verifica litera.
drop trigger if exists issues_advance_recurrence on issues;
create trigger issues_advance_recurrence before update on issues
  for each row execute function advance_recurrence();
```

- [ ] **Step 2: Aplică migrarea**

Run: `npm run migrate supabase/migration-recurrence.sql`
Expected: fără eroare. (Dacă `.env` nu are cheile `PG_*`, oprește-te și spune — nu inventa credențiale.)

- [ ] **Step 3: Scrie testul de paritate**

Creează `scripts/test-recurrence-sql.mjs`:

```js
// Paritate TS ↔ SQL pentru recurență: `npm run test:recurrence-sql`
//
// Regula de salt exista in doua limbi — `src/lib/recurrence.ts` (pentru
// interfata si pentru modul local, care n-are Postgres) si `next_occurrence()`
// din migrarea de recurente (pentru cele trei drumuri de bifare care trec prin
// baza). Doua implementari ale aceleiasi reguli driftează; intrebarea e cand.
//
// Scriptul trece ACELEASI fixtures prin amandoua. Un caz adaugat in
// `src/lib/recurrence.fixtures.ts` e verificat automat si aici.
//
// De ce nu in `npm test`: cere retea si credentiale, ca `test:layout` si
// `test:nav`. De ce `pg` si nu supabase-js: parametri separati, fiindca parola
// are `@` in ea (vezi CLAUDE.md).

// ÎNAINTE de orice `new Date`: fusul trebuie sa fie cel pe care il presupune si
// SQL-ul, altfel comparam mere cu pere si testul cade pe nimic.
process.env.TZ = 'Europe/Bucharest'

import pg from 'pg'
import { config } from 'dotenv'
import { build } from 'esbuild'

config()

/**
 * Incarca un modul TypeScript in Node fara unealta noua: esbuild e deja in
 * node_modules (il aduce vite), iar rezultatul se importa ca data URL.
 */
async function loadTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' })
  const code = Buffer.from(out.outputFiles[0].text).toString('base64')
  return import(`data:text/javascript;base64,${code}`)
}

const { FIXTURES } = await loadTs('src/lib/recurrence.fixtures.ts')
const { nextOccurrence } = await loadTs('src/lib/recurrence.ts')

const client = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

/** ISO → `2026-08-25 09:00` în ora locală (care e Europe/Bucharest, vezi sus). */
function local(s) {
  if (!s) return null
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

await client.connect()
let failed = 0
for (const f of FIXTURES) {
  const ts = local(nextOccurrence(f.rrule, new Date(f.from), f.due))
  const { rows } = await client.query('select next_occurrence($1, $2::timestamptz, $3::timestamptz) as n', [
    f.rrule, f.due, f.from,
  ])
  const sql = local(rows[0].n ? new Date(rows[0].n).toISOString() : null)
  const ok = ts === f.want && sql === f.want
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${f.name}\n      așteptat ${f.want} · TS ${ts} · SQL ${sql}`)
}
await client.end()

console.log(failed ? `\n${failed} nepotriviri.` : `\n${FIXTURES.length} cazuri, TS și SQL de acord.`)
process.exit(failed ? 1 : 0)
```

- [ ] **Step 4: Adaugă scriptul în `package.json`**

În `"scripts"`, după `"test:nav"`:

```json
    "test:nav": "node scripts/test-nav.mjs",
    "test:recurrence-sql": "node scripts/test-recurrence-sql.mjs"
```

- [ ] **Step 5: Rulează paritatea**

Run: `npm run test:recurrence-sql`
Expected: `17 cazuri, TS și SQL de acord.` Dacă un caz diferă, **SQL-ul se
corectează, nu fixture-ul** — fixture-ul e contractul.

- [ ] **Step 6: Verifică trigger-ul pe un rând real**

Run:

```bash
node -e "
import('pg').then(async ({default: pg}) => {
  const {config} = await import('dotenv'); config()
  const c = new pg.Client({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DATABASE,user:process.env.PG_USER,password:process.env.PG_PASSWORD,ssl:{rejectUnauthorized:false}})
  await c.connect()
  const {rows:[p]} = await c.query('select id from projects limit 1')
  const {rows:[i]} = await c.query(\"insert into issues (project_id, title, due_at, all_day, remind_at, rrule) values (\$1, 'PROBA recurență', now(), false, now() - interval '30 min', 'FREQ=DAILY') returning id, due_at, remind_at, done\", [p.id])
  await c.query('update issues set done = true where id = \$1', [i.id])
  const {rows:[a]} = await c.query('select due_at, remind_at, done, reminder_sent_at from issues where id = \$1', [i.id])
  console.log('înainte:', i); console.log('după:  ', a)
  await c.query('delete from issues where id = \$1', [i.id])
  await c.end()
})
"
```

Expected: `due_at` avansat cu o zi, `remind_at` la 30 min înaintea noii scadențe, `done: false`, `reminder_sent_at: null`. Rândul de probă se șterge singur.

- [ ] **Step 7: Commit**

```bash
git add supabase/migration-recurrence.sql scripts/test-recurrence-sql.mjs package.json
git commit -m "feat(recurență): saltul în trigger, cu test de paritate TS/SQL"
```

---

### Task 3: Paritate în modul local

**Files:**
- Modify: `src/data/localRepository.ts` (metoda `updateIssue`)
- Create: `src/data/localRepository.test.ts` (dacă nu există; altfel adaugă în el)

**Interfaces:**
- Consumes: `nextOccurrence` din `src/lib/recurrence.ts` (Task 1).
- Produces: nimic nou în afară — `updateIssue` întoarce rândul deja sărit, exact ca Supabase.

- [ ] **Step 1: Write the failing test**

Creează (sau extinde) `src/data/localRepository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { localRepository } from './localRepository'

describe('localRepository — recurență', () => {
  beforeEach(() => { localStorage.clear() })

  it('o sarcină recurentă bifată sare, nu se închide', async () => {
    const projects = await localRepository.listProjects()
    const due = new Date(2026, 7, 24, 9, 0, 0, 0)
    const created = await localRepository.createIssue({
      projectId: projects[0].id,
      title: 'bea apă',
      dueAt: due.toISOString(),
      allDay: false,
      remindAt: new Date(due.getTime() - 30 * 60_000).toISOString(),
      rrule: 'FREQ=DAILY',
    })

    const saved = await localRepository.updateIssue(created.id, { done: true })

    expect(saved.done).toBe(false)
    const next = new Date(saved.dueAt!)
    expect(next.getDate()).toBe(25)
    expect(next.getHours()).toBe(9)
    // Decalajul mementoului se păstrează.
    expect(new Date(saved.dueAt!).getTime() - new Date(saved.remindAt!).getTime()).toBe(30 * 60_000)
  })

  it('o sarcină fără rrule se închide normal', async () => {
    const projects = await localRepository.listProjects()
    const created = await localRepository.createIssue({ projectId: projects[0].id, title: 'una singură' })
    const saved = await localRepository.updateIssue(created.id, { done: true })
    expect(saved.done).toBe(true)
  })
})
```

> Dacă `createIssue` din `localRepository` cere alte câmpuri obligatorii, uită-te
> în `NewIssue` din `src/data/repository.ts` și completează-le — nu schimba tipul.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/localRepository.test.ts`
Expected: FAIL — `expected true to be false` (bifarea închide tichetul azi).

- [ ] **Step 3: Implementează saltul**

În `src/data/localRepository.ts`, adaugă importul:

```ts
import { nextOccurrence } from '../lib/recurrence'
```

și înlocuiește corpul lui `updateIssue`:

```ts
    async updateIssue(id: string, patch: Partial<Issue>) {
      const db = load()
      const issue = db.issues.find((i) => i.id === id)
      if (!issue) throw new Error(`Unknown issue ${id}`)
      Object.assign(issue, patch)

      // Oglinda trigger-ului `issues_advance_recurrence` din Supabase: aici nu
      // există Postgres care să facă saltul, iar modul local n-are voie să se
      // comporte altfel. Ce e în `supabase/migration-recurrence.sql` e legea;
      // asta doar o repetă în TS.
      if (patch.done === true && issue.rrule && issue.dueAt) {
        const nxt = nextOccurrence(issue.rrule, new Date(), issue.dueAt)
        if (nxt) {
          const delta = issue.remindAt ? new Date(issue.dueAt).getTime() - new Date(issue.remindAt).getTime() : null
          issue.dueAt = nxt
          issue.remindAt = delta === null ? null : new Date(new Date(nxt).getTime() - delta).toISOString()
          issue.done = false
        }
      }

      save(db)
      return clone(issue)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/localRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Suita întreagă + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/localRepository.ts src/data/localRepository.test.ts
git commit -m "feat(recurență): paritate în modul local"
```

---

### Task 4: Vocabularul din text — `parseDue` + `InfoPanel`

**Files:**
- Modify: `src/lib/parseDue.ts:130-141` (blocul „recurență")
- Modify: `src/lib/parseDue.test.ts`
- Modify: `src/components/InfoPanel.tsx:36-39` (grupul „Recurență") și `explain()`

**Interfaces:**
- Consumes: `formatRrule`, `describeRrule` din `src/lib/recurrence.ts`.
- Produces: `ParsedDue.rrule` capătă valori din tot subsetul, nu doar `FREQ=DAILY`/`FREQ=WEEKLY`.

- [ ] **Step 1: Write the failing test**

În `src/lib/parseDue.test.ts`, adaugă un `describe` nou (ancora `NOW` din fișier e luni, 24 august 2026):

```ts
describe('recurență în text', () => {
  const r = (s: string) => parseDue(s, NOW).rrule

  it('zilnic și intervalul de zile', () => {
    expect(r('zilnic bea apă')).toBe('FREQ=DAILY')
    expect(r('în fiecare zi bea apă')).toBe('FREQ=DAILY')
    expect(r('daily standup')).toBe('FREQ=DAILY')
    expect(r('la 2 zile udă florile')).toBe('FREQ=DAILY;INTERVAL=2')
    expect(r('din 3 în 3 zile verifică')).toBe('FREQ=DAILY;INTERVAL=3')
    expect(r('every 2 days water')).toBe('FREQ=DAILY;INTERVAL=2')
  })

  it('ziua săptămânii, una sau mai multe', () => {
    expect(r('în fiecare luni raport')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('lunea raport')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('every monday report')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('lunea și joia sala')).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(r('săptămânal sinteza')).toBe('FREQ=WEEKLY')
    expect(r('la 2 săptămâni retrospectivă')).toBe('FREQ=WEEKLY;INTERVAL=2')
  })

  it('lunar și anual', () => {
    expect(r('lunar plătește chiria')).toBe('FREQ=MONTHLY')
    expect(r('pe 15 ale lunii plătește factura')).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(r('anual revizie')).toBe('FREQ=YEARLY')
    expect(r('în fiecare an revizie')).toBe('FREQ=YEARLY')
  })

  it('„luni" e o zi, „lunea" e o recurență — forma articulată e semnalul', () => {
    expect(r('luni raport')).toBeNull()
    expect(parseDue('luni raport', NOW).dueAt).not.toBeNull()
  })

  it('o recurență fără dată pornește de azi — motorul are nevoie de un start', () => {
    const p = parseDue('zilnic bea apă', NOW)
    expect(p.dueAt).not.toBeNull()
    expect(new Date(p.dueAt!).getDate()).toBe(24)
    expect(p.title).toBe('bea apă')
  })

  it('fragmentul de recurență se poate refuza ca oricare altul', () => {
    const p = parseDue('la 2 zile de concediu', NOW)
    expect(p.spans.length).toBeGreaterThan(0)
    const rejected = ['la 2 zile']
    expect(parseDue(maskRejected('la 2 zile de concediu', rejected), NOW).rrule).toBeNull()
  })
})
```

> `maskRejected` e deja importat în fișierul de test; dacă nu, adaugă-l la import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/parseDue.test.ts`
Expected: FAIL pe „la 2 zile", „lunea", „lunar", „pe 15", „anual".

- [ ] **Step 3: Înlocuiește blocul de recurență din `parseDue`**

În `src/lib/parseDue.ts`, adaugă importul:

```ts
import { formatRrule } from './recurrence'
```

și înlocuiește blocul de la comentariul „── recurență" (liniile ~130-141) cu:

```ts
  // ── recurență. Se caută ÎNAINTE de ziua relativă și de ora liberă: „la 2
  //    zile" trebuie să fie o recurență, nu o scadență „peste 2 zile", iar
  //    fragmentul consumat de aici nu mai e disponibil pentru celelalte tipare.
  //
  //    Forma ARTICULATĂ e semnalul, în română: „luni" e o zi, „lunea" e o
  //    recurență. De aceea lista de mai jos e separată de `DAYS_RO`.
  const DAYS_RO_ART = ['duminica', 'lunea', 'martea', 'miercurea', 'joia', 'vinerea', 'sambata']

  // „la 2 zile", „din 3 în 3 zile", „every 2 days"
  m = hay.match(/\b(?:la|every)\s+(\d+)\s*(?:de\s+)?(zile|zi|days|day|saptamani|saptamana|weeks|week|luni|luna|months|month|ani|an|years|year)\b/)
    ?? hay.match(/\bdin\s+(\d+)\s+in\s+\d+\s+(zile|zi|saptamani|saptamana|luni|luna|ani|an)\b/)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    // Atenție: „luni" e ambiguu — ziua sau pluralul lui „lună". Aici, după un
    // număr („la 2 luni"), e unitatea; ca zi a săptămânii n-ar avea sens.
    const freq = /^(zile|zi|days|day)$/.test(unit) ? 'DAILY'
      : /^(saptamani|saptamana|weeks|week)$/.test(unit) ? 'WEEKLY'
      : /^(luni|luna|months|month)$/.test(unit) ? 'MONTHLY' : 'YEARLY'
    if (n >= 1) { rrule = formatRrule({ freq, interval: n, byday: [], bymonthday: null }); hit(m) }
  }

  // „în fiecare luni", „every monday", „în fiecare zi/săptămână/lună/an"
  if (!rrule) {
    m = hay.match(/\b(?:in fiecare|fiecare|every)\s+([a-z]+)\b/)
    if (m) {
      const w = m[1]
      const dow = DAYS_RO.indexOf(w) >= 0 ? DAYS_RO.indexOf(w) : DAYS_EN.indexOf(w)
      if (dow >= 0) { rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: [dow], bymonthday: null }); hit(m) }
      else if (/^(zi|day)$/.test(w)) { rrule = 'FREQ=DAILY'; hit(m) }
      else if (/^(saptamana|week)$/.test(w)) { rrule = 'FREQ=WEEKLY'; hit(m) }
      else if (/^(luna|month)$/.test(w)) { rrule = 'FREQ=MONTHLY'; hit(m) }
      else if (/^(an|year)$/.test(w)) { rrule = 'FREQ=YEARLY'; hit(m) }
    }
  }

  // Zilele articulate, una sau mai multe: „lunea", „lunea și joia",
  // „luni, miercuri și vineri" NU intră aici (neaticulate = date), dar
  // „lunea, miercurea si vinerea" da.
  if (!rrule) {
    const days: number[] = []
    const re = /\b(duminica|lunea|martea|miercurea|joia|vinerea|sambata)\b/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(hay))) {
      const i = DAYS_RO_ART.indexOf(mm[1])
      if (i >= 0 && !days.includes(i)) days.push(i)
      spans.push([mm.index, mm.index + mm[0].length])
    }
    if (days.length) {
      rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: days.sort((a, b) => a - b), bymonthday: null })
      // Legătura dintre două zile („și", „,") rămâne în titlu ca resturi; le
      // scoate `stripSpans` doar dacă sunt lipite de spans. Le prindem explicit.
      const glue = hay.match(/\b(?:si|and)\b/)
      if (glue && days.length > 1) hit(glue)
    }
  }

  // „zilnic", „daily", „săptămânal", „lunar", „anual"
  if (!rrule) {
    m = hay.match(/\b(?:zilnic|daily)\b/)
    if (m) { rrule = 'FREQ=DAILY'; hit(m) }
    m = hay.match(/\b(?:saptamanal|weekly)\b/)
    if (m) { rrule = 'FREQ=WEEKLY'; hit(m) }
    m = hay.match(/\b(?:lunar|monthly)\b/)
    if (m) { rrule = 'FREQ=MONTHLY'; hit(m) }
    m = hay.match(/\b(?:anual|yearly|annually)\b/)
    if (m) { rrule = 'FREQ=YEARLY'; hit(m) }
  }

  // „pe 15 ale lunii", „on the 15th"
  m = hay.match(/\bpe\s+(\d{1,2})\s+ale\s+lunii\b/) ?? hay.match(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (m) {
    const d = Number(m[1])
    if (d >= 1 && d <= 31) {
      rrule = formatRrule({ freq: 'MONTHLY', interval: 1, byday: [], bymonthday: d })
      hit(m)
    }
  }
```

Apoi, la finalul funcției, **înainte** de `return`, adaugă regula „recurență fără dată":

```ts
  // O recurență e o funcție de o dată de start. Dacă textul n-a dat una, ziua
  // de azi e singurul început care nu cere nimic de la om.
  //
  // Se face aici, nu în blocul de sus, ca o zi scrisă explicit („în fiecare
  // luni") să câștige: acolo `day` e deja pus.
```

(codul care urmează — `const base = day ? ... : startOfLocalDay(now)` — face deja
exact asta, fiindcă `spans.length > 0` când s-a recunoscut o recurență. Verifică
doar că gardul `if (spans.length === 0)` de mai sus **nu** iese devreme când
singurul lucru recunoscut e recurența; dacă iese, mută comentariul și lasă codul.)

> **Ordine, atenție:** blocul de recurență trebuie să rămână **primul** din
> funcție, înaintea zilei relative. „la 2 zile" altfel ar fi prins de tiparul
> „peste/in N zile"? Nu — acela cere `peste|in`, nu `la`. Dar „la 2" e și un
> tipar de oră („la 14"): ora se caută **după**, iar `hit()` a marcat deja
> fragmentul. Rulează testele; dacă „la 2 zile" ajunge oră, mută verificarea de
> oră după recurență (e deja acolo) și adaugă `\s*(?:zile|zi)` ca excludere în
> tiparul de oră.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/parseDue.test.ts`
Expected: PASS, inclusiv testele vechi (nu s-au schimbat: `în fiecare luni` întoarce acum `FREQ=WEEKLY;BYDAY=MO`, deci **testul vechi de la linia ~81 trebuie actualizat** la noua valoare — e o precizare, nu o regresie).

- [ ] **Step 5: Actualizează `InfoPanel`**

În `src/components/InfoPanel.tsx`, importă `describeRrule` și înlocuiește linia din `explain()`:

```ts
  const rec = r.rrule ? ` · ${describeRrule(r.rrule)}` : ''
```

și grupul de exemple:

```ts
  {
    title: 'Recurență',
    note: 'Forma articulată e semnalul: „luni" e o zi, „lunea" se repetă.',
    examples: [
      'zilnic', 'la 2 zile', 'în fiecare luni', 'lunea și joia',
      'săptămânal', 'la 2 săptămâni', 'lunar', 'pe 15 ale lunii', 'anual',
    ],
  },
```

- [ ] **Step 6: Verifică panoul în aplicație**

Run: `npm run dev`, deschide aplicația, `Ctrl+,`.
Expected: fiecare exemplu din grup arată o interpretare, niciunul nu apare „neînțeles". Închide serverul după.

- [ ] **Step 7: Typecheck + suita**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/parseDue.ts src/lib/parseDue.test.ts src/components/InfoPanel.tsx
git commit -m "feat(recurență): vocabularul din text — interval, zile multiple, lunar, anual"
```

---

### Task 5: Rândul „Repetare" din formular

**Files:**
- Create: `src/components/RecurrencePicker.tsx`
- Modify: `src/components/IssueForm.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `parseRrule`, `formatRrule`, `describeRrule` (Task 1); clasele `pills-row`, `if-sub-label`, `if-meta-pill` care există deja.
- Produces: `<RecurrencePicker value={string|null} onChange={(rrule: string|null) => void} onClose={() => void} />`

- [ ] **Step 1: Write the failing test**

Creează `src/components/RecurrencePicker.test.ts` (test pe logica pură de preseturi, nu pe randare — restul componentelor din proiect se testează la fel):

```ts
import { describe, expect, it } from 'vitest'
import { PRESETS, presetOf } from './RecurrencePicker'

describe('preseturi de repetare', () => {
  it('recunoaște presetul unui RRULE simplu', () => {
    expect(presetOf(null)).toBe('none')
    expect(presetOf('FREQ=DAILY')).toBe('FREQ=DAILY')
    expect(presetOf('FREQ=WEEKLY')).toBe('FREQ=WEEKLY')
    expect(presetOf('FREQ=MONTHLY')).toBe('FREQ=MONTHLY')
    expect(presetOf('FREQ=YEARLY')).toBe('FREQ=YEARLY')
  })

  it('orice altceva e „personalizat" — inclusiv un RRULE nerecunoscut', () => {
    expect(presetOf('FREQ=DAILY;INTERVAL=2')).toBe('custom')
    expect(presetOf('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('custom')
    expect(presetOf('FREQ=DAILY;COUNT=3')).toBe('custom')
  })

  it('preseturile sunt exact cele cinci de pe rând', () => {
    expect(PRESETS.map((p) => p.value)).toEqual([null, 'FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/RecurrencePicker.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Scrie componenta**

Creează `src/components/RecurrencePicker.tsx`:

```tsx
// Foaia mică de „personalizat": interval și, pentru săptămânal, zilele.
//
// NU e o foaie din stiva de foi (`SheetHost`): o stivă înseamnă o intrare de
// istoric, iar Back-ul de pe telefon ar trebui atunci să închidă un selector,
// nu formularul. Un control dintr-un formular se poartă ca un `<select>`, nu ca
// un ecran — se închide cu Escape sau cu un click pe fundal, și atât.
//
// Preseturile (zilnic/săptămânal/lunar/anual) NU sunt aici: stau ca jetoane pe
// rândul din formular, la o atingere distanță. Aici se intră doar pentru ce nu
// încape pe un rând.

import { useEffect, useState } from 'react'
import { formatRrule, parseRrule, type Rec } from '../lib/recurrence'

export const PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: 'fără' },
  { value: 'FREQ=DAILY', label: 'zilnic' },
  { value: 'FREQ=WEEKLY', label: 'săptămânal' },
  { value: 'FREQ=MONTHLY', label: 'lunar' },
  { value: 'FREQ=YEARLY', label: 'anual' },
]

/** Ce jeton e aprins pe rând. Tot ce nu e preset curat e „personalizat". */
export function presetOf(rrule: string | null): string {
  if (!rrule) return 'none'
  const hit = PRESETS.find((p) => p.value === rrule)
  return hit?.value ?? 'custom'
}

const UNITS: { freq: Rec['freq']; one: string; many: string }[] = [
  { freq: 'DAILY', one: 'zi', many: 'zile' },
  { freq: 'WEEKLY', one: 'săptămână', many: 'săptămâni' },
  { freq: 'MONTHLY', one: 'lună', many: 'luni' },
  { freq: 'YEARLY', one: 'an', many: 'ani' },
]

const DAY_SHORT = ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S']
const DAY_FULL = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']

export function RecurrencePicker({
  value,
  onChange,
  onClose,
}: {
  value: string | null
  onChange: (rrule: string | null) => void
  onClose: () => void
}) {
  const start = parseRrule(value) ?? { freq: 'DAILY' as const, interval: 2, byday: [], bymonthday: null }
  const [rec, setRec] = useState<Rec>(start)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  const set = (patch: Partial<Rec>) => setRec((r) => ({ ...r, ...patch }))
  const toggleDay = (i: number) =>
    set({ byday: rec.byday.includes(i) ? rec.byday.filter((d) => d !== i) : [...rec.byday, i].sort((a, b) => a - b) })

  return (
    <>
      <div className="rp-back" onClick={onClose} />
      <div className="rp" role="dialog" aria-label="Repetare personalizată">
        <div className="rp-row">
          <span className="if-sub-label">La fiecare</span>
          <input
            className="rp-n"
            type="text"
            inputMode="numeric"
            value={String(rec.interval)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2))
              set({ interval: n >= 1 ? n : 1 })
            }}
            aria-label="La câte unități se repetă"
          />
          <div className="pills-row">
            {UNITS.map((u) => (
              <button
                key={u.freq}
                type="button"
                className={`if-meta-pill ${rec.freq === u.freq ? 'active' : ''}`}
                onClick={() => set({ freq: u.freq, byday: [], bymonthday: null })}
              >
                {rec.interval === 1 ? u.one : u.many}
              </button>
            ))}
          </div>
        </div>

        {rec.freq === 'WEEKLY' && (
          <div className="rp-row">
            <span className="if-sub-label">În zilele</span>
            <div className="pills-row">
              {DAY_SHORT.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  className={`if-meta-pill rp-day ${rec.byday.includes(i) ? 'active' : ''}`}
                  onClick={() => toggleDay(i)}
                  aria-label={DAY_FULL[i]}
                  aria-pressed={rec.byday.includes(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {rec.freq === 'MONTHLY' && (
          <div className="rp-row">
            <span className="if-sub-label">În ziua</span>
            <input
              className="rp-n"
              type="text"
              inputMode="numeric"
              value={rec.bymonthday ? String(rec.bymonthday) : ''}
              placeholder="ca scadența"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2))
                set({ bymonthday: n >= 1 && n <= 31 ? n : null })
              }}
              aria-label="Ziua din lună"
            />
            {/* Ziua 31 nu există în toate lunile: se retează, nu se sare peste. */}
            {rec.bymonthday && rec.bymonthday > 28 && (
              <span className="due-hint">în lunile mai scurte, ultima zi</span>
            )}
          </div>
        )}

        <div className="rp-acts">
          <button type="button" className="if-meta-pill" onClick={onClose}>Renunță</button>
          <button
            type="button"
            className="if-meta-pill active"
            onClick={() => { onChange(formatRrule(rec)); onClose() }}
          >
            Gata
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/RecurrencePicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Leagă rândul în `IssueForm`**

În `src/components/IssueForm.tsx`:

1. Importuri: `import { describeRrule } from '../lib/recurrence'`, `import { PRESETS, RecurrencePicker, presetOf } from './RecurrencePicker'`.
2. Stare, lângă celelalte de scadență (în jurul liniei 385):

```tsx
  const [rrule, setRrule] = useState<string | null>(existing?.rrule ?? null)
  const [showRecur, setShowRecur] = useState(false)
```

3. La salvare, unde se construiește patch-ul de scadență (liniile ~519, ~773 și obiectul optimist de la ~800), trimite `rrule` în loc de `null`:

```tsx
    rrule,
```

(atenție la linia 800: acolo scrie azi `rrule: null` — se înlocuiește cu `rrule`.)

4. Rândul, în `if-bar-sub`, **imediat după** blocul `due-reminder`:

```tsx
          {/* Repetarea are sens doar peste o scadență: o recurență e o funcție
              de o dată de start. Fără dată, rândul nici nu apare. */}
          {dueDate && (
            <div className="pills-row due-recur">
              <span className="if-sub-label">Repetare</span>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  tabIndex={-1}
                  type="button"
                  className={`if-meta-pill reminder-pill ${presetOf(rrule) === (p.value ?? 'none') ? 'active' : ''}`}
                  onClick={() => setRrule(p.value)}
                >
                  {p.label}
                </button>
              ))}
              <button
                tabIndex={-1}
                type="button"
                className={`if-meta-pill reminder-pill ${presetOf(rrule) === 'custom' ? 'active' : ''}`}
                onClick={() => setShowRecur(true)}
                title="Interval, zile ale săptămânii"
              >
                {presetOf(rrule) === 'custom' ? describeRrule(rrule) || 'personalizat' : 'personalizat…'}
              </button>
            </div>
          )}
          {showRecur && (
            <RecurrencePicker value={rrule} onChange={setRrule} onClose={() => setShowRecur(false)} />
          )}
```

5. Recurența venită din titlu: în efectul care aplică `titleDate` (în jurul liniei 470), adaugă, în aceeași ramură:

```tsx
    if (titleDate.active && parsed.rrule) setRrule(parsed.rrule)
```

6. Câmpul murdar: unde se compară starea cu `existing` (liniile ~126-132), adaugă `rrule !== (existing?.rrule ?? null)` la condiția de „s-a schimbat ceva", altfel o recurență adăugată fără altă modificare n-ar activa salvarea și `setDockedDirty` n-ar afla de ea.

- [ ] **Step 6: Stiluri**

În `src/styles.css`, lângă `.due-reminder` (în jurul liniei 4847):

```css
.due-recur { margin-top: 2px; }
/* Foaia de repetare personalizată. Fundal propriu peste fundalul paginii, cu
   umbră ambientală — fără chenar, ca orice altă suprafață (regula 1). */
.rp-back { position: fixed; inset: 0; z-index: 130; background: rgba(0, 0, 0, 0.32); }
.rp {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  transform: translateX(-50%);
  z-index: 131;
  width: min(94vw, 420px);
  padding: 14px;
  border-radius: var(--r);
  background: var(--surface);
  box-shadow: var(--amb-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rp-n {
  width: 56px;
  padding: 4px 8px;
  border-radius: var(--r-m);
  /* Chenarul rămâne: un câmp fără delimitare nu se mai citește ca un câmp
     (excepția din regula 1). */
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--txt);
  font-family: var(--mono);
  font-size: 13px;
}
.rp-day { min-width: 30px; justify-content: center; font-family: var(--mono); }
.rp-acts { display: flex; justify-content: flex-end; gap: 8px; }
```

> Verifică numele variabilelor în `:root`-ul din capul fișierului: folosește doar
> jetoane care EXISTĂ (`--surface`, `--surface-2`, `--surface-3`, `--line`,
> `--txt`, `--amb-lg`, `--r`, `--r-m`, `--mono`). Nu inventa altele.

- [ ] **Step 7: Verifică vizual, în ambele teme**

Run: `python3 design/build-preview.py` apoi deschide `design/preview.html`, ecranul „Controale".
Expected: jetoanele de repetare se văd în ambele teme, atât normale cât și active. Verifică în special că jetonul neactiv nu rămâne fără fundal ȘI fără chenar (regresia clasică din CLAUDE.md).

- [ ] **Step 8: Geometrie**

Run: `npm run test:layout`
Expected: PASS. Rândul nou intră într-un rând de flex — exact clasa de regresie pe care testul o prinde.

- [ ] **Step 9: Typecheck + suita**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/RecurrencePicker.tsx src/components/RecurrencePicker.test.ts src/components/IssueForm.tsx src/styles.css
git commit -m "feat(recurență): rândul Repetare în formular, cu foaie de personalizare"
```

---

### Task 6: Recurența se vede pe tichet

**Files:**
- Modify: `src/components/DueChip.tsx`
- Modify: `src/components/DueChip.test.ts`
- Modify: `src/components/QuickAdd.tsx:225-235`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `describeRrule` (Task 1), `Icon name="recurring"` (există deja în `Icon.tsx:129`).
- Produces: `DueChip` acceptă și `rrule` în `Due`.

- [ ] **Step 1: Write the failing test**

În `src/components/DueChip.test.ts`, adaugă (adaptează la felul în care fișierul construiește tichetele — probabil testează `dueTitle`, nu randarea):

```ts
  it('titlul spune și că se repetă', () => {
    const t = dueTitle(
      { dueAt: new Date(2026, 7, 24, 9, 0).toISOString(), allDay: false, remindAt: null, done: false, rrule: 'FREQ=DAILY' },
      new Date(2026, 7, 24, 8, 0),
    )
    expect(t).toContain('zilnic')
  })

  it('un tichet care nu se repetă nu spune nimic despre asta', () => {
    const t = dueTitle(
      { dueAt: new Date(2026, 7, 24, 9, 0).toISOString(), allDay: false, remindAt: null, done: false, rrule: null },
      new Date(2026, 7, 24, 8, 0),
    )
    expect(t).not.toContain('zilnic')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DueChip.test.ts`
Expected: FAIL — `rrule` nu e în tipul `Due`, iar `dueTitle` nu-l folosește.

- [ ] **Step 3: Implementează**

În `src/components/DueChip.tsx`:

```ts
import { describeRrule } from '../lib/recurrence'
...
type Due = Pick<Issue, 'dueAt' | 'allDay' | 'remindAt' | 'done' | 'rrule'>
```

în `dueTitle`, înainte de `return`:

```ts
  const rec = describeRrule(issue.rrule)
  if (rec) parts.push(`se repetă ${rec}`)
```

și în componentă, lângă clopoțel:

```tsx
      {issue.rrule && describeRrule(issue.rrule) && (
        <span className="t-recur" aria-label={`Se repetă ${describeRrule(issue.rrule)}`}>
          <Icon name="recurring" size={12} />
        </span>
      )}
```

CSS, lângă `.t-bell`:

```css
.t-recur { display: inline-flex; align-items: center; color: var(--txt-faint); }
```

> Dacă `.t-bell` are deja exact regula asta, refolosește-o: `className="t-bell"`
> pe ambele, și nicio clasă nouă. Două desene cu culori diferite pentru „semn
> mic pe chip" ar fi exact ce evită vocabularul comun de iconițe.

- [ ] **Step 4: `QuickAdd` prin `describeRrule`**

În `src/components/QuickAdd.tsx`, linia ~232, înlocuiește `if`-ul pe string:

```tsx
            <span className="chip"><Icon name="recurring" size={12} /> {describeRrule(parsed.rrule)}</span>
```

(cu importul aferent). Motivul intră în comentariu: un `if` pe `'FREQ=DAILY'`
minte de îndată ce parserul învață al treilea tipar — și tocmai a învățat opt.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/DueChip.test.ts && npm run typecheck`
Expected: PASS. Typecheck-ul va arăta fiecare loc care construiește un `Due` fără `rrule` — completează-le cu `rrule: null` sau cu câmpul real.

- [ ] **Step 6: Verifică în aplicație**

Run: `npm run dev`; creează prin quick add `zilnic bea apă`, uită-te în „Azi" și în „Listă".
Expected: jetonul de scadență arată iconița de repetare; `title` (hover pe desktop) spune „se repetă zilnic".

- [ ] **Step 7: Commit**

```bash
git add src/components/DueChip.tsx src/components/DueChip.test.ts src/components/QuickAdd.tsx src/styles.css
git commit -m "feat(recurență): semnul de repetare pe jetonul de scadență"
```

---

### Task 7: Bifarea care sare, cu un pas înapoi

**Files:**
- Modify: `src/components/Toast.tsx`
- Modify: `src/store.tsx` (interfața `HorizontalState` ~linia 134, `toggleDone` ~651, obiectul `value` ~868)
- (`jumpNotice` e deja scris și testat în Task 1 — aici doar se folosește.)
- Modify: `src/App.tsx:906`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `jumpNotice` din `src/lib/recurrence.ts` (Task 1).
- Produces pe `HorizontalState`:
  - `recurrenceUndo: { id: string; label: string } | null`
  - `undoRecurrence(): Promise<void>`
  - `clearRecurrenceUndo(): void`
- `Toast` primește `action?: { label: string; onClick: () => void }`.

- [ ] **Step 1: Verifică mesajul**

`jumpNotice` există din Task 1. Rulează-l o dată ca să vezi forma exactă a zilei
scurte și, dacă testul din `recurrence.test.ts` a rămas pe potrivire laxă
(`toMatch`), strânge-l acum la valoarea reală:

Run: `npx vitest run src/lib/recurrence.test.ts -t jumpNotice`
Expected: PASS.

- [ ] **Step 2: Implementează în store**

În `src/store.tsx`, importă `jumpNotice` din `./lib/recurrence` și adaugă starea
lângă `error`:

```ts
  // Un pas înapoi, ținut în memorie cât ține toast-ul: valorile dinainte de
  // salt. Nu în bază — greșeala pe care o repară („am atins bifa din greșeală")
  // se observă imediat sau deloc, iar două coloane nefolosite după trei secunde
  // ar fi fost greutate moartă în model.
  const [recurrenceUndo, setRecurrenceUndo] = useState<
    { id: string; label: string; dueAt: string | null; remindAt: string | null } | null
  >(null)
```

în `toggleDone`, după `upsertIssue(saved)`:

```ts
        // Saltul e recunoscut după rezultat, nu ghicit dinainte: adevărul e ce
        // a întors baza (trigger-ul poate refuza un RRULE pe care clientul l-ar
        // fi acceptat). `saved.done === false` după ce am cerut `true` e
        // semnătura lui.
        if (done && !saved.done && saved.dueAt && saved.dueAt !== current.dueAt) {
          setRecurrenceUndo({ id, label: jumpNotice(saved.dueAt), dueAt: current.dueAt, remindAt: current.remindAt })
        }
```

acțiunile:

```ts
  const clearRecurrenceUndo = useCallback(() => setRecurrenceUndo(null), [])

  const undoRecurrence = useCallback(async () => {
    const u = recurrenceUndo
    if (!u) return
    setRecurrenceUndo(null)
    try {
      const saved = await repository.updateIssue(u.id, { dueAt: u.dueAt, remindAt: u.remindAt, done: false })
      upsertIssue(saved)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [recurrenceUndo, upsertIssue])
```

Adaugă cele trei în `interface HorizontalState` și în obiectul `value`.

> Trigger-ul nu se declanșează la anulare: `done` nu trece `false → true`, deci
> nu există buclă. Merită comentariul chiar acolo.

- [ ] **Step 3: `Toast` cu acțiune**

`src/components/Toast.tsx`:

```tsx
const DURATION = 2600
/** Cu o acțiune, mesajul trebuie să apuce să fie CITIT și apăsat. */
const DURATION_ACTION = 6000

export function Toast({
  message,
  onDone,
  action,
}: {
  message: string | null
  onDone: () => void
  action?: { label: string; onClick: () => void }
}) {
  useEffect(() => {
    if (!message) return
    const id = setTimeout(onDone, action ? DURATION_ACTION : DURATION)
    return () => clearTimeout(id)
  }, [message, onDone, action])

  return (
    <div className={`toast ${message ? 'on' : ''}`} role="status" aria-live="polite">
      {message}
      {message && action && (
        <button type="button" className="toast-act" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
```

CSS, lângă `.toast`:

```css
.toast { display: flex; align-items: center; gap: 12px; }
.toast-act {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent);
  background: none;
  cursor: pointer;
  padding: 2px 4px;
}
```

> `.toast` are deja proprietăți; adaugă `display:flex` la regula existentă, nu
> într-o a doua regulă cu același selector.

- [ ] **Step 4: Leagă în `App.tsx`**

Linia 906:

```tsx
      <Toast
        message={recurrenceUndo ? recurrenceUndo.label : notice}
        onDone={recurrenceUndo ? clearRecurrenceUndo : clearNotice}
        action={recurrenceUndo ? { label: 'ANULEAZĂ', onClick: undoRecurrence } : undefined}
      />
```

cu `recurrenceUndo`, `clearRecurrenceUndo`, `undoRecurrence` luate din `useHorizontal()` (sau cum se numește hook-ul de store în fișier — uită-te la celelalte câmpuri folosite acolo).

- [ ] **Step 5: Run tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Verifică ciclul complet, în aplicație**

Run: `npm run dev`
1. Quick add: `zilnic la 9 bea apă`. Sarcina apare în „Azi".
2. Bifeaz-o. Expected: dispare din „Azi", toast-ul spune „Gata · revine <mâine>".
3. Apasă ANULEAZĂ. Expected: revine în „Azi", nebifată, cu scadența de azi.
4. Bifeaz-o din nou, lasă toast-ul să treacă, deschide „Mâine". Expected: e acolo.

- [ ] **Step 7: Navigare**

Run: `npm run test:nav`
Expected: PASS. (Bifarea dintr-o listă inteligentă atinge exact zona pe care testul o păzește.)

- [ ] **Step 8: Commit**

```bash
git add src/store.tsx src/components/Toast.tsx src/App.tsx src/styles.css
git commit -m "feat(recurență): bifarea sare, cu un pas de anulat"
```

---

### Task 8: Documentația și verificarea finală

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/brainstorm/2026-08-24-mod-todo.md` (rândul 6 din „Ordinea de construcție")

- [ ] **Step 1: Secțiunea din `CLAUDE.md`**

După secțiunea „Mod To-Do", înainte de „Obstacole", adaugă:

```markdown
## Recurențe — un tichet care sare

O sarcină cu `rrule` bifată **nu se închide**: `due_at` avansează la următoarea
apariție, `remind_at` se mută cu același decalaj, `done` rămâne `false`. Nu
există rânduri-instanță și nu există istoric al apariției — asumat, vezi
`docs/superpowers/specs/2026-09-20-recurente-design.md`.

**Saltul se calculează din ziua CURENTĂ**, nu cu un pas de la scadență: bifezi
joi o sarcină zilnică restantă de luni → sare pe vineri. Zilele sărite dispar;
nu sunt datorate. Altfel o sarcină făcută ar rămâne roșie și ar acumula o
datorie pe care nimeni n-o plătește.

**Saltul trăiește într-un trigger Postgres** (`issues_advance_recurrence`,
`supabase/migration-recurrence.sql`), nu în store. Trei drumuri bifează un
tichet și doar unul e interfața: butonul „Gata" din notificare **fără nicio
filă deschisă** scrie prin `reminder-action` direct în REST, iar `functions/api`
scrie cu cheia de serviciu. Logica în client le-ar fi lăsat pe ultimele două să
închidă definitiv o sarcină recurentă. Ordinea alfabetică a trigger-elor
`before update` contează și e în favoarea noastră: `issues_advance_recurrence`
rulează înaintea lui `issues_reset_reminder_sent`, deci mementoul apariției
următoare se armează singur.

**Regula de salt e scrisă în două limbi** — `src/lib/recurrence.ts` (interfață +
modul local, care n-are Postgres) și PL/pgSQL. De aceea
**`npm run test:recurrence-sql`** trece ACELEAȘI fixtures prin baza reală.
Rulează-l după orice atingere a oricăreia dintre cele două. Un caz nou se adaugă
în `FIXTURES`, nu într-un `it` separat — acolo îl vede și SQL-ul.

Fusul din SQL e constanta `'Europe/Bucharest'`. Un utilizator în alt fus ar
sări cu o zi; atunci `p_tz` devine o coloană, nu un default.

Vocabularul din text (`parseDue`): `zilnic`, `la 2 zile`, `în fiecare luni`,
`lunea și joia`, `săptămânal`, `lunar`, `pe 15 ale lunii`, `anual`, plus EN.
**Forma articulată e semnalul:** „luni" e o dată, „lunea" e o recurență.
Subsetul RRULE e mic și închis (`FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`);
`UNTIL` și `COUNT` sunt **refuzate**, nu ignorate — ignorate ar face o serie
mărginită să curgă la nesfârșit.

Anularea e un pas, ținut în memoria paginii cât ține toast-ul, nu în bază.

Setup: `npm run migrate supabase/migration-recurrence.sql`.
```

- [ ] **Step 2: Închide rândul din brainstorm**

În `docs/superpowers/brainstorm/2026-08-24-mod-todo.md`, rândul 6:

```markdown
6. ✅ **Recurență.** Motorul există (2026-09-20): `src/lib/recurrence.ts` +
   trigger Postgres. Vezi `docs/superpowers/specs/2026-09-20-recurente-design.md`.
```

- [ ] **Step 3: Verificarea completă**

Run, pe rând, și **citește ieșirea fiecăruia**:

```bash
npm run typecheck
npm test
npm run test:recurrence-sql
npm run test:layout
npm run test:nav
```

Expected: toate PASS. `npm run test:upgrade` **nu** e necesar: nu s-au atins
`src/sw.ts`, `src/pwa.ts` sau blocul VitePWA.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/brainstorm/2026-08-24-mod-todo.md
git commit -m "docs(recurență): regulile care nu se văd din cod"
```

- [ ] **Step 5: NU da push**

Un push pe `master` publică în producție, pe telefonul omului. Spune-i că
ramura e gata și că mai lipsesc doi pași pe care îi face el sau îi ceri explicit:
`npm run migrate supabase/migration-recurrence.sql` pe baza de producție, și
apoi pushul.

---

## Verificare manuală, la final (nu se poate automatiza)

Drumul pe care o implementare client-side l-ar fi ratat, deci singurul care chiar
trebuie văzut cu ochii:

1. Creează o sarcină zilnică cu memento peste 2 minute.
2. **Închide complet fila** (și aplicația de pe telefon, dacă acolo testezi).
3. Când vine notificarea, apasă **„Gata"** de pe ecranul blocat.
4. Deschide aplicația. Sarcina trebuie să fie **nebifată, scadentă mâine**, cu
   mementoul rearmat (`reminder_sent_at` null în bază).

Dacă la pasul 4 sarcina e bifată, trigger-ul nu s-a aplicat pe baza respectivă —
migrarea n-a rulat acolo.
