/**
 * Planificatorul de mementouri al cutiei, pur: dată lista de la pagină și ora,
 * ce sună acum, ce se armează, ce notificare afișată se retrage. Procesul
 * principal îl recheamă de la zero la fiecare listă nouă, la fiecare timer
 * ajuns la termen și la trezirea din somn — timerele Node merg pe un ceas care
 * NU numără somnul, deci după o noapte cu capacul închis ar întârzia cu o noapte.
 */
export interface Reminder { key: string; id: string; at: number; title: string; body: string }

/** Aceeași regulă ca `TTL: 3600` la push: un memento răsuflat e zgomot, nu informație. */
export const MISSED_WINDOW_MS = 3_600_000
export const HORIZON_MS = 24 * 3_600_000

export interface Plan {
  fireNow: Reminder[]
  arm: { reminder: Reminder; delayMs: number }[]
  close: string[]
}

export function planReminders(next: Reminder[], now: number, fired: ReadonlySet<string>, shown: ReadonlySet<string>): Plan {
  const keys = new Set(next.map((r) => r.key))
  const plan: Plan = { fireNow: [], arm: [], close: [...shown].filter((k) => !keys.has(k)) }
  for (const r of next) {
    if (fired.has(r.key)) continue
    const delay = r.at - now
    if (delay <= 0) { if (-delay <= MISSED_WINDOW_MS) plan.fireNow.push(r); continue }
    if (delay <= HORIZON_MS) plan.arm.push({ reminder: r, delayMs: delay })
  }
  return plan
}

const str = (v: unknown): v is string => typeof v === 'string'

export function parseReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return []
  const out: Reminder[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (!str(o.key) || !str(o.id) || !str(o.at) || !str(o.title) || !str(o.body)) continue
    const at = Date.parse(o.at)
    if (!Number.isFinite(at)) continue
    out.push({ key: o.key, id: o.id, at, title: o.title, body: o.body })
  }
  return out
}
