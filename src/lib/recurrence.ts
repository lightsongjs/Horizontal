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
 * Plafonul lui `INTERVAL`. Un „la 999 de ani" e deja absurd; peste atât,
 * aritmetica se rupe în AMÂNDOUĂ limbile, și nu la fel: în Postgres
 * `INTERVAL=99999999999` nu încape în `int4`, iar castul ARUNCĂ — un trigger
 * `before update` care aruncă anulează tot update-ul, deci rândul nu s-ar mai
 * putea bifa deloc. În TS, `addDays` dă `Invalid Date` și `toISOString()`
 * aruncă, exact ce spune specul că nu se întâmplă („Nu aruncă").
 *
 * Valoarea e oglindită în `next_occurrence()` din migrare (acolo, ca lungime a
 * literalului după tăierea zerourilor din față) și are fixtures în amândouă.
 */
const MAX_INTERVAL = 999

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
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null

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

/**
 * A sărit sarcina la aparița următoare, sau a fost o bifă obișnuită?
 *
 * Adevărul e ce a întors baza, nu ce a cerut clientul: un trigger poate
 * refuza un RRULE pe care clientul l-ar fi acceptat, iar serverul poate
 * normaliza `dueAt` (fus orar, rotunjire) fără ca sarcina să fi sărit deloc.
 * Trei condiții, toate pe rezultat:
 *   1. s-a cerut `done: true` — o debifare n-are cum să sară nimic;
 *   2. rândul s-a întors `done: false` — semnătura triggerului de recurență
 *      (`advance_recurrence` din `migration-recurrence.sql`, oglindit în
 *      `localRepository`);
 *   3. are o scadență NOUĂ, diferită de cea de dinainte — o normalizare care
 *      păstrează aceeași dată nu e un salt.
 *
 * `saved: null` înseamnă „scrierea a picat” (store-ul nu ajunge niciodată aici
 * pe drumul de eroare, dar contractul rămâne explicit și testabil): niciun
 * răspuns înseamnă niciun salt.
 */
export function didJumpOnComplete(
  requestedDone: boolean,
  prevDueAt: string | null,
  saved: { done: boolean; dueAt: string | null } | null,
): boolean {
  if (!saved) return false
  return requestedDone && !saved.done && saved.dueAt !== null && saved.dueAt !== prevDueAt
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
  // O scadență pe care `Date` n-o poate citi nu e o eroare de aici: e o dată
  // pe care n-o știm. „Nu știu" se spune cu `null`, ca la un RRULE străin —
  // altfel aritmetica de mai jos ar duce la `Invalid Date` și `toISOString()`
  // ar arunca tocmai din funcția despre care specul spune că nu aruncă.
  if (!Number.isFinite(due.getTime())) return null
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

  if (!day || !Number.isFinite(day.getTime())) return null
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), due.getHours(), due.getMinutes(), 0, 0)
  if (!Number.isFinite(at.getTime())) return null
  return at.toISOString()
}

/**
 * Ziua în care ÎNCEPE o recurență care numește o zi — „vinerea raport" e
 * vinerea care vine, nu azi.
 *
 * Există fiindcă altfel parserul ar fi avut nevoie de propriul „care e
 * următoarea vineri" și de propriul „care e următorul 15" — o a doua
 * aritmetică de calendar, care ar fi driftat de motor exact ca SQL-ul, doar
 * fără testul care prinde driftul. Aici se cere motorului: grila se ancorează
 * pe AZI și se cere pasul următor de pe ea.
 *
 * Strict DUPĂ azi, nu „de azi înainte", fiindcă asta e deja convenția
 * aplicației pentru o zi numită: „luni" spus într-o luni înseamnă lunea
 * viitoare (`parseDue`), iar specul cere ca „în fiecare luni" să pornească
 * „lunea următoare". Cele două formulări trebuie să dea aceeași zi.
 *
 * `null` înseamnă „recurența asta nu numește nicio zi" (zilnic, săptămânal
 * fără BYDAY, lunar fără BYMONTHDAY, anual) — atunci apelantul aplică regula
 * din spec: o recurență fără dată pornește de azi.
 */
export function firstOccurrence(rrule: string | null, from: Date): string | null {
  const rec = parseRrule(rrule)
  if (!rec) return null
  const namesADay = (rec.freq === 'WEEKLY' && rec.byday.length > 0) || (rec.freq === 'MONTHLY' && !!rec.bymonthday)
  if (!namesADay) return null
  const today = startOfLocalDay(from)
  return nextOccurrence(rrule, today, today.toISOString())
}
