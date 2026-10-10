// supabase/functions/_shared/eventReminders.ts
//
// Mementourile EVENIMENTELOR din Google Calendar — pur, fără Deno, fără rețea.
// Importat de trei părți, ca regula și textul să existe o singură dată:
//   - `send-reminders` (web push, serverul decide CÂND),
//   - `src/lib/pushPayload.ts` (service worker-ul: CE scrie notificarea),
//   - `src/lib/calendarEvents.ts` (pagina → cutia de Linux).
//
// Două mementouri pe eveniment cu oră: cu 10 minute înainte și la start. Nu
// pentru cele de toată ziua (ar suna la miezul nopții) și nu pentru cele
// refuzate de om (`responseStatus = declined`): un „Acum: ședința X" la care ai
// spus deja „nu" e exact zgomotul care învață omul să ignore notificările.

/** Cât înainte de start sună primul memento. */
export const EVENT_PRE_MINUTES = 10
/**
 * Cât DUPĂ start mai are sens „Acum: …". Cronul rulează la minut, deci în mod
 * normal pleacă în primul minut; fereastra acoperă un cron întârziat sau o
 * sincronizare care a adus evenimentul abia după ce a început. Mai târziu de
 * atât nu mai e un memento, e zgomot (aceeași regulă ca `TTL: 3600` la tichete,
 * strânsă pe măsura unei ședințe).
 */
export const EVENT_LATE_MINUTES = 10

export type EventStage = 'pre' | 'now'

/** Câmpurile de care are nevoie decizia — forma rândului din `calendar_events`. */
export interface EventReminderRow {
  id: string
  all_day: boolean
  start_at: string | null
  response: string | null
  pre_sent_at: string | null
  start_sent_at: string | null
}

export interface EventReminderDecision {
  /** Ce se trimite acum. `null` = nimic (dar `mark` poate tot să marcheze). */
  send: EventStage | null
  /**
   * Ce coloane se marchează ca trimise. Un „Acum" trimis marchează și „pre"-ul
   * netrimis: altfel cronul următor ar trimite „Peste 10 min" pentru o ședință
   * care a început deja.
   */
  mark: { pre: boolean; start: boolean }
}

const MIN = 60_000

/** Se sună deloc pentru evenimentul ăsta? */
export function remindable(row: Pick<EventReminderRow, 'all_day' | 'start_at' | 'response'>): boolean {
  if (row.all_day || !row.start_at) return false
  if (row.response === 'declined') return false
  return Number.isFinite(Date.parse(row.start_at))
}

/**
 * Ce face cronul ACUM cu un eveniment. Pur: `send-reminders` o cheamă pe fiecare
 * rând din fereastra lui, apoi trimite și marchează ce i se spune.
 */
export function decideEventReminder(row: EventReminderRow, nowMs: number): EventReminderDecision {
  const none: EventReminderDecision = { send: null, mark: { pre: false, start: false } }
  if (!remindable(row)) return none
  const start = Date.parse(row.start_at!)
  if (nowMs < start - EVENT_PRE_MINUTES * MIN) return none

  if (nowMs < start) {
    if (row.pre_sent_at) return none
    return { send: 'pre', mark: { pre: true, start: false } }
  }

  if (row.start_sent_at) return none
  // Răsuflat: se marchează fără să sune, ca să nu rămână în coadă.
  const late = nowMs >= start + EVENT_LATE_MINUTES * MIN
  return { send: late ? null : 'now', mark: { pre: !row.pre_sent_at, start: true } }
}

/** Titlul notificării. Un singur loc, ca push-ul, Linux și (mai târziu) Android să spună la fel. */
export function eventNotificationTitle(stage: EventStage, title: string): string {
  const t = title.trim() || 'Eveniment fără titlu'
  return stage === 'pre' ? `Peste ${EVENT_PRE_MINUTES} min: ${t}` : `Acum: ${t}`
}

/** Momentul la care sună fiecare treaptă — pentru cutiile care armează timere (Linux). */
export function eventReminderTimes(startAt: string): { stage: EventStage; at: number }[] {
  const start = Date.parse(startAt)
  if (!Number.isFinite(start)) return []
  return [
    { stage: 'pre', at: start - EVENT_PRE_MINUTES * MIN },
    { stage: 'now', at: start },
  ]
}

/** Prefixul id-ului unui eveniment în contractele de mementouri (push, Linux). */
export const EVENT_ID_PREFIX = 'cal:'

export const eventReminderId = (eventId: string) => `${EVENT_ID_PREFIX}${eventId}`

export function eventIdFromReminderId(id: string): string | null {
  return id.startsWith(EVENT_ID_PREFIX) ? id.slice(EVENT_ID_PREFIX.length) : null
}
