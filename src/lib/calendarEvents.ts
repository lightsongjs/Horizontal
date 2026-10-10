// Evenimentele din Google Calendar în listele de zi („Azi", „Mâine", „7 zile")
// — pur, testat pe fixtures, ca `schedule.ts`. Nimic de aici nu e o sarcină:
// un eveniment nu se bifează, nu se glisează, nu se numără în sertar. Stă doar
// lângă sarcini, la ora lui, ca ziua să se citească într-un singur loc.
//
// Toate deciziile se iau în ziua LOCALĂ, ca în `schedule.ts`.

import { addDays, hasTime, startOfLocalDay } from './schedule'
import { formatTimeRange } from './pushPayload'
import type { Issue } from './types'
import {
  EVENT_LATE_MINUTES, eventNotificationTitle, eventReminderId, eventReminderTimes,
} from '../../supabase/functions/_shared/eventReminders.ts'

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  allDay: boolean
  /** Cu oră: ISO. Toată ziua: null. */
  startAt: string | null
  endAt: string | null
  /** Toată ziua: `YYYY-MM-DD`, sfârșitul EXCLUSIV (ca la Google). Cu oră: null. */
  startDate: string | null
  endDate: string | null
  location: string | null
  meetUrl: string | null
  htmlLink: string | null
  /** `responseStatus` al omului; 'declined' se arată tăiat și nu sună. */
  response: string | null
}

export interface CalendarInfo {
  id: string
  accountId: string
  name: string
  /** Hex din Google. Null → culoarea de rezervă a aplicației. */
  color: string | null
  enabled: boolean
  isPrimary: boolean
}

export interface CalendarAccount {
  id: string
  email: string
  /** 'reconnect' = Google a refuzat tokenul; evenimentele rămase sunt vechi. */
  status: 'ok' | 'reconnect'
  lastSyncedAt: string | null
  lastError: string | null
  calendars: CalendarInfo[]
}

/** O apariție a unui eveniment într-o zi anume (un multi-zi are câte una pe zi). */
export interface EventOccurrence {
  key: string
  event: CalendarEvent
  color: string
  calendarName: string
  /** 1..days. Un eveniment de o zi are 1/1. */
  day: number
  days: number
  /**
   * În banda din capul zilei: toată ziua, sau a doua zi încolo a unui eveniment
   * cu oră care trece de miezul nopții (pe ziua aceea n-are o oră de start).
   */
  band: boolean
  startMs: number
  endMs: number
  /** S-a terminat — se estompează. */
  ended: boolean
  declined: boolean
}

export interface DayEvents {
  band: EventOccurrence[]
  timed: EventOccurrence[]
}

/** Culoarea când Google n-a dat una (n-ar trebui, dar o bară invizibilă ar minți). */
export const FALLBACK_COLOR = 'var(--accent)'

const DAY_MS = 86_400_000

function localDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const dayDiff = (a: Date, b: Date) => Math.round((startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()) / DAY_MS)

/** Prima zi locală și câte zile ocupă. `null` = capete stricate. */
export function eventSpan(e: CalendarEvent): { first: Date; days: number; startMs: number; endMs: number } | null {
  if (e.allDay) {
    const s = e.startDate ? localDate(e.startDate) : null
    const en = e.endDate ? localDate(e.endDate) : null
    if (!s || !en) return null
    // Sfârșitul e exclusiv: 12 → 13 e o zi. Unul greșit (egal) tot o zi.
    const days = Math.max(1, dayDiff(s, en))
    return { first: s, days, startMs: s.getTime(), endMs: en.getTime() }
  }
  const s = e.startAt ? Date.parse(e.startAt) : NaN
  const en = e.endAt ? Date.parse(e.endAt) : NaN
  if (!Number.isFinite(s) || !Number.isFinite(en)) return null
  // Un eveniment care se termină FIX la miezul nopții nu se revarsă în ziua
  // următoare: 22:00–00:00 e o seară, nu „ziua 1/2".
  const lastInstant = Math.max(s, en - 1)
  const first = startOfLocalDay(new Date(s))
  return { first, days: dayDiff(first, new Date(lastInstant)) + 1, startMs: s, endMs: Math.max(s, en) }
}

/** Calendarele pornite, după id — un eveniment al unui calendar oprit (rămas în cache) nu se arată. */
export function enabledCalendars(accounts: CalendarAccount[]): Map<string, CalendarInfo> {
  const out = new Map<string, CalendarInfo>()
  for (const a of accounts) for (const c of a.calendars) if (c.enabled) out.set(c.id, c)
  return out
}

/** Evenimentele unei zile, despărțite în bandă și rânduri cu oră. */
export function eventsOn(events: CalendarEvent[], calendars: Map<string, CalendarInfo>, day: Date, now: Date): DayEvents {
  const band: EventOccurrence[] = []
  const timed: EventOccurrence[] = []
  const dayStart = startOfLocalDay(day)
  const nextDay = addDays(dayStart, 1).getTime()
  for (const e of events) {
    const cal = calendars.get(e.calendarId)
    if (!cal) continue
    const span = eventSpan(e)
    if (!span) continue
    const i = dayDiff(span.first, dayStart)
    if (i < 0 || i >= span.days) continue
    const inBand = e.allDay || i > 0
    const occ: EventOccurrence = {
      key: `${e.id}@${i}`,
      event: e,
      color: cal.color || FALLBACK_COLOR,
      calendarName: cal.name,
      day: i + 1,
      days: span.days,
      band: inBand,
      startMs: inBand ? dayStart.getTime() : span.startMs,
      endMs: span.endMs,
      // O zi întreagă s-a terminat când a trecut ziua ei (aici: ziua listei).
      ended: e.allDay ? now.getTime() >= Math.min(nextDay, span.endMs) : now.getTime() >= span.endMs,
      declined: e.response === 'declined',
    }
    ;(inBand ? band : timed).push(occ)
  }
  band.sort((a, b) => a.event.title.localeCompare(b.event.title) || a.key.localeCompare(b.key))
  timed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.key.localeCompare(b.key))
  return { band, timed }
}

export type DayRow =
  | { kind: 'issue'; issue: Issue }
  | { kind: 'event'; occ: EventOccurrence }

/**
 * Sarcinile zilei (deja în ordinea `compareDue`) cu evenimentele cu oră,
 * amestecate pe oră. Sarcinile FĂRĂ oră rămân sus — „cândva azi" e planul
 * zilei, nu ceva ce se întâmplă la 00:00. La aceeași oră evenimentul vine
 * întâi: o ședință la 10 nu se mută, o sarcină de la 10 da.
 */
export function mergeDay(issues: Issue[], timed: EventOccurrence[]): DayRow[] {
  const out: DayRow[] = []
  const timedIssues: Issue[] = []
  for (const it of issues) {
    if (hasTime(it)) timedIssues.push(it)
    else out.push({ kind: 'issue', issue: it })
  }
  let i = 0
  let j = 0
  while (i < timedIssues.length || j < timed.length) {
    const it = timedIssues[i]
    const ev = timed[j]
    if (ev && (!it || ev.startMs <= Date.parse(it.dueAt!))) { out.push({ kind: 'event', occ: ev }); j++ }
    else { out.push({ kind: 'issue', issue: it }); i++ }
  }
  return out
}

/** Ora din rând: `10:00–11:00`; pe a doua zi a unui multi-zi, nimic (stă în bandă). */
export function occurrenceTime(o: EventOccurrence): string | null {
  if (o.band || !o.event.startAt || !o.event.endAt) return null
  return formatTimeRange(o.event.startAt, o.event.endAt)
}

/** „ziua 2/5" — doar pentru ce ține mai mult de o zi. */
export function occurrenceDayLabel(o: Pick<EventOccurrence, 'day' | 'days'>): string | null {
  return o.days > 1 ? `ziua ${o.day}/${o.days}` : null
}

export const eventTitle = (e: Pick<CalendarEvent, 'title'>) => e.title.trim() || '(fără titlu)'

// ── mementourile pentru cutia de Linux ──────────────────────────────────────

/** Forma unui memento de cutie (`DesktopReminder` din `desktopBridge.ts`), fără importul ciclic. */
export interface EventDesktopReminder {
  key: string
  id: string
  at: string
  title: string
  body: string
  dueAt: null
  allDay: false
  kind: 'event'
}

/**
 * Cele două mementouri (−10 min, start) ale evenimentelor cu oră, pentru cutia
 * de Linux. Regula de retragere e a cutiei: o cheie care lipsește din listă își
 * închide notificarea. De-aia:
 *  - „Peste 10 min" stă în listă până la start — atunci pleacă, iar
 *    notificarea lui se închide singură, lăsând loc lui „Acum";
 *  - „Acum" stă `EVENT_LATE_MINUTES` după start, apoi se retrage — o ședință
 *    în curs nu mai are nevoie de un memento pe ecran.
 * Refuzatele, cele de toată ziua și calendarele oprite nu sună (ca push-ul).
 */
export function upcomingEventReminders(
  events: CalendarEvent[],
  calendars: Map<string, CalendarInfo>,
  now: Date,
  horizonMs = DAY_MS,
): EventDesktopReminder[] {
  const t = now.getTime()
  const out: EventDesktopReminder[] = []
  for (const e of events) {
    if (e.allDay || !e.startAt || !e.endAt || e.response === 'declined' || !calendars.has(e.calendarId)) continue
    const start = Date.parse(e.startAt)
    if (!Number.isFinite(start) || start - t > horizonMs) continue
    const body = [formatTimeRange(e.startAt, e.endAt), e.location].filter(Boolean).join(' · ')
    for (const { stage, at } of eventReminderTimes(e.startAt)) {
      const until = stage === 'pre' ? start : start + EVENT_LATE_MINUTES * 60_000
      if (t >= until) continue
      const iso = new Date(at).toISOString()
      const id = eventReminderId(e.id)
      out.push({ key: `${id}@${iso}`, id, at: iso, title: eventNotificationTitle(stage, e.title), body, dueAt: null, allDay: false, kind: 'event' })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

// ── foaia evenimentului ─────────────────────────────────────────────────────

const DAYS = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const dayName = (d: Date) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`

/**
 * Când, în cuvinte: „luni, 12 octombrie · 10:00–11:00", „luni, 12 octombrie ·
 * toată ziua", „12 octombrie – 14 octombrie". Pentru foaia de citit.
 */
export function eventWhen(e: CalendarEvent): string {
  const span = eventSpan(e)
  if (!span) return ''
  const first = span.first
  if (span.days === 1) {
    const time = !e.allDay && e.startAt && e.endAt ? formatTimeRange(e.startAt, e.endAt) : 'toată ziua'
    return `${dayName(first)} · ${time}`
  }
  const last = addDays(first, span.days - 1)
  if (e.allDay) return `${dayName(first)} – ${dayName(last)}`
  const s = new Date(e.startAt!)
  const en = new Date(e.endAt!)
  const hm = (d: Date) => formatTimeRange(d.toISOString(), d.toISOString())
  return `${dayName(first)}, ${hm(s)} – ${dayName(last)}, ${hm(en)}`
}
