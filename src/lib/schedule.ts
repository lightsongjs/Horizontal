// Logica pură de timp pentru modul To-Do: ce e „azi", ce e restant, în ce
// ordine se așază sarcinile unei zile. Fără I/O, fără React — testată pe
// fixtures, ca `engine.ts`.
//
// Toate deciziile se iau în ziua LOCALĂ a userului. „Azi" nu e un interval UTC:
// la 01:00 în București, UTC e încă ieri. De asta nimic de aici nu compară
// string-uri ISO între ele — se compară timpi și se bucketizează pe zile locale.

import type { Issue } from './types'
import type { DueRange } from '../data/repository'

/**
 * Câmpurile de timp ale unui tichet fără scadență. Un tichet de proiect nu are
 * scadență; o sarcină o primește explicit. Constanta ține seed-ul și
 * fixture-urile sincronizate cu modelul: un câmp nou se adaugă o dată, aici,
 * nu în fiecare obiect literal.
 */
export const NO_SCHEDULE = {
  dueAt: null,
  allDay: true,
  remindAt: null,
  rrule: null,
} satisfies Pick<Issue, 'dueAt' | 'allDay' | 'remindAt' | 'rrule'>

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Câte zile locale sunt între ziua lui `iso` și ziua lui `now`. 0 = azi, 1 = mâine. */
export function dayOffset(iso: string, now: Date): number {
  const a = startOfLocalDay(new Date(iso)).getTime()
  const b = startOfLocalDay(now).getTime()
  // Rotunjire, nu împărțire exactă: la trecerea la ora de vară o zi locală are
  // 23 sau 25 de ore, deci diferența nu e un multiplu de 86400000.
  return Math.round((a - b) / 86_400_000)
}

/** Ora din scadență e reală doar dacă sarcina nu e de zi întreagă. */
export function hasTime(issue: Pick<Issue, 'dueAt' | 'allDay'>): boolean {
  return !!issue.dueAt && !issue.allDay
}

/**
 * Restanță = nefinalizată și trecută. Pentru o sarcină cu oră, „trecut"
 * înseamnă chiar ora ei. Pentru una de zi întreagă înseamnă o zi ANTERIOARĂ:
 * altfel orice sarcină de azi fără oră ar fi restantă de la 00:00, adică toată
 * ziua în care trebuia făcută.
 */
export function isOverdue(issue: Pick<Issue, 'dueAt' | 'allDay' | 'done'>, now: Date): boolean {
  if (issue.done || !issue.dueAt) return false
  if (issue.allDay) return dayOffset(issue.dueAt, now) < 0
  return new Date(issue.dueAt).getTime() < now.getTime()
}

/**
 * Fereastra pe care o cere aplicația de la depozit: tot ce e nefinalizat cu
 * scadență înainte de sfârșitul zilei a șaptea, plus bifatele de azi încolo.
 * O singură interogare hrănește toate cele trei liste și numerele din sidebar.
 */
export function smartListRange(now: Date): DueRange {
  const today = startOfLocalDay(now)
  return {
    to: addDays(today, SMART_LIST_DAYS).toISOString(),
    doneFrom: today.toISOString(),
  }
}

/** „Next 7 days" = azi + următoarele șase. */
export const SMART_LIST_DAYS = 7

/**
 * Ordinea: ziua întâi, apoi în interiorul zilei cele fără oră deasupra, apoi
 * cronologic, apoi urgentele (aceeași regulă ca `orderIdsByUrgency`).
 *
 * Ziua e primul criteriu, nu „fără oră întâi": lista de restanțe se întinde pe
 * mai multe zile, iar o sarcină de zi întreagă de ieri nu are voie să sară
 * peste una cu oră de acum trei zile. În interiorul unei zile, „fără oră"
 * înseamnă „cândva azi", deci stă sus ca plan, nu îngropată între ore.
 */
export function compareDue(a: Issue, b: Issue): number {
  const at = a.dueAt ? new Date(a.dueAt).getTime() : 0
  const bt = b.dueAt ? new Date(b.dueAt).getTime() : 0
  const ad = a.dueAt ? startOfLocalDay(new Date(a.dueAt)).getTime() : 0
  const bd = b.dueAt ? startOfLocalDay(new Date(b.dueAt)).getTime() : 0
  if (ad !== bd) return ad - bd
  if (hasTime(a) !== hasTime(b)) return hasTime(a) ? 1 : -1
  if (at !== bt) return at - bt
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
  return a.id.localeCompare(b.id)
}

export interface SmartLists {
  /** Nefinalizate, scadență trecută. Cel mai vechi primul. */
  overdue: Issue[]
  /** Nefinalizate cu scadență azi. */
  today: Issue[]
  /** Nefinalizate cu scadență mâine. */
  tomorrow: Issue[]
  /** Zilele 0..6, fiecare cu sarcinile ei nefinalizate. Restanțele NU intră. */
  week: { offset: number; date: Date; issues: Issue[] }[]
  /** Bifate azi — pentru secțiunea colapsată din lista de azi. */
  doneToday: Issue[]
}

/**
 * Taie o listă de tichete cu scadență în cele trei liste inteligente.
 *
 * Restanțele apar NUMAI în `overdue`, niciodată în `today` sau în `week`: o
 * restanță e o problemă de azi, dar „Next 7 days" e o listă despre ce urmează.
 * Dublarea ar face ca aceeași sarcină să fie numărată de două ori în badge-uri.
 */
export function buildSmartLists(issues: Issue[], now: Date): SmartLists {
  const overdue: Issue[] = []
  const byOffset = new Map<number, Issue[]>()
  const doneToday: Issue[] = []

  for (const it of issues) {
    if (!it.dueAt) continue
    const off = dayOffset(it.dueAt, now)
    if (it.done) {
      if (off === 0) doneToday.push(it)
      continue
    }
    if (isOverdue(it, now)) {
      overdue.push(it)
      continue
    }
    if (off >= 0 && off < SMART_LIST_DAYS) {
      const bucket = byOffset.get(off)
      if (bucket) bucket.push(it)
      else byOffset.set(off, [it])
    }
  }

  overdue.sort(compareDue)
  doneToday.sort(compareDue)
  const today = startOfLocalDay(now)
  const week = Array.from({ length: SMART_LIST_DAYS }, (_, offset) => ({
    offset,
    date: addDays(today, offset),
    issues: (byOffset.get(offset) ?? []).sort(compareDue),
  }))

  return { overdue, today: week[0].issues, tomorrow: week[1].issues, week, doneToday }
}

// ── Punte către <input type="date"> și <input type="time"> ──────────────────
// Inputurile native vorbesc în ora LOCALĂ, modelul în ISO-UTC. Toată conversia
// stă aici, ca nicio componentă să nu improvizeze un `slice(0, 10)` pe un ISO —
// care ar da ziua UTC, adică ziua greșită pentru jumătate din zi.

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO → `YYYY-MM-DD` în ziua locală. */
export function toDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO → `HH:MM` local. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Valorile din inputuri → câmpurile modelului.
 *
 * Ora goală înseamnă **toată ziua**, iar `allDay` nu e un comutator separat pe
 * care userul îl poate contrazice: se citește din faptul că a scris o oră sau
 * nu. Două surse de adevăr pentru aceeași informație se desincronizează
 * întotdeauna. Fără dată nu există scadență, oricâtă oră ar fi scrisă.
 */
export function fromInputs(date: string, time: string): { dueAt: string | null; allDay: boolean } {
  if (!date) return { dueAt: null, allDay: true }
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time ? time.split(':').map(Number) : [0, 0]
  // Constructorul cu componente separate creează data în fusul local — exact ce
  // vrem. `new Date('2026-08-24')` ar fi interpretat UTC.
  return { dueAt: new Date(y, m - 1, d, hh, mm, 0, 0).toISOString(), allDay: !time }
}

/** Cât înainte de scadență sună mementoul. */
export type ReminderKind = 'none' | 'due' | 'm30' | 'd1'

/**
 * Regula din brainstorming: o sarcină **cu oră** sună implicit la scadență; una
 * **de zi întreagă** nu sună singură (ar suna la miezul nopții) — intră în
 * rezumatul de dimineață, care e o treabă separată, a serverului.
 */
export function defaultReminder(allDay: boolean): ReminderKind {
  return allDay ? 'none' : 'due'
}

export function reminderAt(dueAt: string | null, kind: ReminderKind): string | null {
  if (!dueAt || kind === 'none') return null
  const t = new Date(dueAt).getTime()
  if (kind === 'due') return new Date(t).toISOString()
  if (kind === 'm30') return new Date(t - 30 * 60_000).toISOString()
  return new Date(t - 24 * 60 * 60_000).toISOString()
}

/** Inversul: din ce e salvat, ce opțiune e bifată în formular. */
export function reminderKindOf(dueAt: string | null, remindAt: string | null): ReminderKind {
  if (!dueAt || !remindAt) return 'none'
  const delta = new Date(dueAt).getTime() - new Date(remindAt).getTime()
  if (delta === 0) return 'due'
  if (delta === 30 * 60_000) return 'm30'
  if (delta === 24 * 60 * 60_000) return 'd1'
  return 'due'
}

// ── Data în forma zz-ll-aaaa ────────────────────────────────────────────────
// Un `<input type="date">` nativ își afișează data în formatul BROWSERULUI, iar
// acela nu se poate impune: nici `lang`, nici CSS, nici un atribut nu-l schimbă.
// Un browser în engleză arată `mm/dd/yyyy`, ceea ce pentru o dată românească e
// ambiguu până la periculos — 03-04 e 3 aprilie sau 4 martie?
//
// De asta câmpul de dată e un text mascat, iar conversia stă aici.

/** ISO → `zz-ll-aaaa`, în ziua locală. */
export function toDisplayDate(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

/** Ce scrie în câmpul gol. Literele sunt cele românești: zi, lună, an. */
export const DATE_PLACEHOLDER = 'zz-ll-aaaa'

/**
 * `zz-ll-aaaa` → `aaaa-ll-zz` (forma pe care o consumă `fromInputs`), sau null
 * dacă data nu e completă ori nu există în calendar.
 *
 * Validarea e prin dus-întors, nu prin comparat numere: `new Date(2026, 1, 31)`
 * nu aruncă, se mută liniștit pe 3 martie. Verificăm că ziua ieșită e ziua
 * cerută — altfel „31-02-2026" ar fi acceptat ca o dată care nu există.
 */
export function fromDisplayDate(text: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const day = Number(dd), month = Number(mm), year = Number(yyyy)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (d.getDate() !== day || d.getMonth() !== month - 1 || d.getFullYear() !== year) return null
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Ce se vede în câmp după fiecare tastă: cifrele primite, cu cratimele puse
 * automat. Nimic altceva nu trece — o literă tastată din greșeală nu are ce să
 * caute într-o dată, iar șase cifre nu pot deveni o dată de patru cifre pe an.
 *
 * Nu completează și nu ghicește: `4` rămâne `4`, nu devine `04`. Altfel n-ai
 * putea scrie ziua 14, fiindcă primul `1` s-ar transforma în `01`.
 */
export function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter((p) => p !== '')
  // Cratima se pune doar DUPĂ ce grupul e complet, ca ștergerea să funcționeze
  // firesc: un backspace peste „24-" lasă „24", nu „24-" din nou.
  let out = parts.join('-')
  if (digits.length === 2 || digits.length === 4) out += '-'
  return out
}

/** `aaaa-ll-zz` (valoarea unui input nativ de dată) → `zz-ll-aaaa`. */
export function displayFromInputDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

// ── Ora în forma hh:mm, 24 de ore ───────────────────────────────────────────
// Același motiv ca la dată: un `<input type="time">` nativ afișează 12 sau 24 de
// ore după locale-ul browserului. „3:30 PM" într-o interfață românească e la fel
// de nelalocul lui ca „08/24/2026", și încape mai greu.

export const TIME_PLACEHOLDER = 'hh:mm'

/** Ce se vede în câmp după fiecare tastă. Ca `maskDateInput`: nu ghicește. */
export function maskTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits.length === 2 ? `${digits}:` : digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/**
 * `hh:mm` → aceeași valoare normalizată, sau null dacă nu e o oră.
 *
 * `24:00` e respins: o zi are orele 0–23, iar „24:00" ar fi de fapt ziua
 * următoare — exact confuzia pe care nu vrem s-o salvăm.
 */
export function fromTimeText(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}
