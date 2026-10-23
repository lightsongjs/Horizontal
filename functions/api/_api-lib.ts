// functions/api/_api-lib.ts
// Reguli pure pentru rutele de teme, valuri și câmpurile noi de pe tichet
// (scadența, urgentul). Nimic de aici nu atinge rețeaua — testele le iau direct.

/** Fusul aplicației: o zi întreagă e 00:00 LOCAL (vezi supabase/migration-todo.sql). */
export const APP_TZ = 'Europe/Bucharest'

/** Cât e fusul `tz` înaintea UTC (ms) în clipa `ms`. Merge pe Workers, unde ceasul e UTC. */
function tzOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms
}

/** Ora de perete din `tz` → clipa UTC. Două treceri, ca la schimbarea orei să nimerească offsetul de atunci. */
export function localToUtc(y: number, m: number, d: number, hh: number, mm: number, tz = APP_TZ): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let t = wall - tzOffset(wall, tz)
  t = wall - tzOffset(t, tz)
  return new Date(t)
}

export interface DueFields {
  due_at: string | null
  all_day: boolean
  remind_at: string | null
}

/**
 * `due` din corpul cererii → coloanele tichetului, sau un cod de eroare.
 *
 * - `null` / `''` = fără scadență (și fără memento).
 * - `"2026-10-24"` = toată ziua: 00:00 la București, fără memento — o zi
 *   întreagă nu sună singură (`defaultReminder` din src/lib/schedule.ts).
 * - `"2026-10-24 15:30"` (sau cu `T`) = la ora aceea, ora României, cu
 *   mementoul la scadență, ca o captură cu oră din aplicație — DOAR dacă e
 *   în viitor: `send-reminders`, cutia de Linux și Android sună orice
 *   `remind_at` trecut, deci o dată veche scrisă de o unealtă ar suna pe loc.
 *
 * „Toată ziua” nu e un câmp separat: se citește din faptul că s-a scris o oră
 * sau nu, ca în formular (`fromInputs`) — două surse s-ar contrazice.
 */
export function parseDue(input: unknown, now: number = Date.now()): DueFields | { error: 'invalid_due' } {
  if (input === null || input === '') return { due_at: null, all_day: true, remind_at: null }
  if (typeof input !== 'string') return { error: 'invalid_due' }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(input.trim())
  if (!m) return { error: 'invalid_due' }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const timed = m[4] !== undefined
  const [hh, mm] = timed ? [Number(m[4]), Number(m[5])] : [0, 0]
  // O dată care nu există („31 februarie”) ar fi alunecat tăcut în martie.
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return { error: 'invalid_due' }
  if (hh > 23 || mm > 59) return { error: 'invalid_due' }
  const at = localToUtc(y, mo, d, hh, mm).toISOString()
  return { due_at: at, all_day: !timed, remind_at: timed && Date.parse(at) > now ? at : null }
}

/** Culoarea unei teme: `#RRGGBB`, ca paleta din aplicație. */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

/** `theme` din corp: `null` / `''` = fără temă; altfel cheia, ca text. */
export function normalizeTheme(v: unknown): { theme: string | null } | { error: 'invalid_theme' } {
  if (v === null || v === undefined || v === '') return { theme: null }
  if (typeof v !== 'string') return { error: 'invalid_theme' }
  return { theme: v }
}

export interface DueRow {
  due_at: string | null
  all_day: boolean | null
  urgent: boolean | null
}

/** Coloanele de scadență → câmpurile din răspuns, la fel peste tot. */
export function dueOut(row: DueRow): { dueAt: string | null; allDay: boolean; urgent: boolean } {
  return { dueAt: row.due_at ?? null, allDay: row.all_day ?? true, urgent: !!row.urgent }
}

export interface SupabaseWave {
  number: number
  name: string | null
  label: string | null
  position: number | null
}

export function waveOut(w: SupabaseWave) {
  return { number: w.number, name: w.name ?? '', label: w.label ?? '', position: w.position ?? w.number }
}

/** PostgREST: cheie duplicată (23505) — două creări simultane au ales același număr / aceeași cheie. */
export function isUniqueViolation(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && (detail as { code?: unknown }).code === '23505'
}
