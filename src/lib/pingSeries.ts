// Seriile de mementouri, partea paginii: unde pornește o serie scrisă în
// titlu, ce scrie jetonul ei și cum trece o serie zilnică pe ziua următoare în
// modul local. Ce ping e ACUM (regula comună cu serverul și cu Kotlin) stă în
// `supabase/functions/_shared/pings.ts`.
//
// Modelul (decizia omului, 2026-11-06): o serie e UN tichet. `remindAt` = primul
// ping și ancora grilei, `dueAt` = capătul ferestrei (inclusiv), `pingEvery` =
// pasul în minute, `rrule` = în ce zile revine (null = doar azi). Nimic nu se
// scrie în bază la fiecare ping.

import { describeRrule, firstOccurrence, nextOccurrence, parseRrule } from './recurrence'
import { addDays, startOfLocalDay, toTimeInput } from './schedule'
import type { Issue } from './types'
import { PING_MAX_MINUTES } from '../../supabase/functions/_shared/pings.ts'

export { PING_MAX_MINUTES }

const MIN = 60_000

/** Unde pornește o serie fără start scris, pe o zi care nu e azi. */
export const SERIES_DEFAULT_START: [number, number] = [9, 0]
/** Capătul unei serii fără capăt scris. */
export const SERIES_DEFAULT_END: [number, number] = [23, 59]

export interface SeriesSpec {
  /** Pasul, în minute (1–720). */
  every: number
  /** Ora de start scrisă („de la 9"), sau null = de acum. */
  start: [number, number] | null
  /** Ora capătului („până la 10"), deja adusă după start (`from 9 to 5` = 17:00), sau null = 23:59. */
  end: [number, number] | null
  /** „la fix" / „on the hour": fără start, primul ping cade pe grila ceasului. */
  align: boolean
  /** Ziua scrisă explicit („mâine", „vineri", „azi"), sau null. */
  day: Date | null
  /** Zilele în care revine (`zilnic`), sau null = doar o zi. */
  rrule: string | null
}

const at = (d: Date, hm: [number, number]) => {
  const x = new Date(d)
  x.setHours(hm[0], hm[1], 0, 0)
  return x
}

/**
 * Primul punct al grilei de ceas strict după `t`: multiplii pasului de la
 * miezul nopții când pasul împarte ora (sub 60) sau ziua (de la 60 în sus) —
 * „la fiecare 15 minute la fix" = :00/:15/:30/:45, „la 2 ore la fix" = ore pare;
 * altfel ora fixă următoare, iar grila merge de acolo cu pasul ei.
 */
function alignedAfter(t: Date, every: number): Date {
  const day = startOfLocalDay(t)
  const m = t.getHours() * 60 + t.getMinutes()
  const divides = every < 60 ? 60 % every === 0 : 1440 % every === 0
  const unit = divides ? every : 60
  const x = new Date(day)
  x.setHours(0, (Math.floor(m / unit) + 1) * unit, 0, 0)
  return x
}

/** Ziua în care o serie recurentă are voie să pornească AZI, sau următoarea ei apariție. */
function firstSeriesDay(rrule: string, today: Date): Date {
  const rec = parseRrule(rrule)
  if (rec?.freq === 'WEEKLY' && rec.byday.length) {
    if (rec.byday.includes(today.getDay())) return today
  }
  const first = firstOccurrence(rrule, today)
  return first ? startOfLocalDay(new Date(first)) : today
}

/** Ziua de după `day` în care revine seria (mâine, fără `rrule`). */
function nextSeriesDay(rrule: string | null, day: Date): Date {
  const next = rrule ? nextOccurrence(rrule, day, day.toISOString()) : null
  return next ? startOfLocalDay(new Date(next)) : addDays(day, 1)
}

/**
 * Fereastra unei serii scrise în titlu: primul ping (`remindAt`, ancora
 * grilei) și capătul (`dueAt`, inclusiv). Regulile, în ordine:
 *
 * - fără start: de acum (rotunjit la minut) + pas — sau, „la fix", primul
 *   punct al grilei de ceas;
 * - cu start: grila pornește de la START, chiar dacă a trecut. Sună doar
 *   pingurile care vin (cine trimite sare peste cele mai vechi de min(pas,
 *   10 min), `pingFreshMs`), iar o serie zilnică pornește mâine tot la ora
 *   scrisă — ancorată pe primul ping de după „acum", ar fi pornit în fiecare
 *   zi de la ora la care a fost scrisă;
 * - fereastra deja trecută azi (ori ziua de azi nu e a seriei) → următoarea
 *   zi a seriei, sau mâine, la start (09:00 fără start);
 * - o zi numită explicit („mâine", „vineri") pornește la start sau la 09:00.
 *   „azi" scris rămâne azi, chiar dacă fereastra a trecut — ca „azi la 8".
 */
export function seriesWindow(s: SeriesSpec, now: Date): { remindAt: string; dueAt: string } {
  const today = startOfLocalDay(now)
  const endOn = (d: Date) => at(d, s.end ?? SERIES_DEFAULT_END)
  const futureFirst = (d: Date) => {
    const first = s.start ? at(d, s.start) : s.align ? alignedAfter(new Date(at(d, SERIES_DEFAULT_START).getTime() - MIN), s.every) : at(d, SERIES_DEFAULT_START)
    // Un capăt înaintea orei implicite („până la 8", fără start): de la miezul nopții.
    return first.getTime() > endOn(d).getTime() ? new Date(d) : first
  }
  const out = (first: Date, d: Date) => ({ remindAt: first.toISOString(), dueAt: endOn(d).toISOString() })

  const explicit = s.day ? startOfLocalDay(s.day) : null
  const day = explicit ?? (s.rrule ? firstSeriesDay(s.rrule, today) : today)
  if (day.getTime() !== today.getTime()) return out(futureFirst(day), day)

  const nowMin = new Date(now)
  nowMin.setSeconds(0, 0)
  const first = s.start ? at(today, s.start)
    : s.align ? alignedAfter(now, s.every)
      : new Date(nowMin.getTime() + s.every * MIN)
  const end = endOn(today)
  // Mai e cel puțin un ping de acum până la capăt?
  const left = s.start && first.getTime() <= now.getTime()
    ? first.getTime() + (Math.floor((now.getTime() - first.getTime()) / (s.every * MIN)) + 1) * s.every * MIN
    : first.getTime()
  if (left <= end.getTime()) return out(first, today)
  if (explicit) return out(first.getTime() > end.getTime() ? end : first, today)
  const next = nextSeriesDay(s.rrule, today)
  return out(futureFirst(next), next)
}

/** „La 15 min", „Din oră în oră", „La 2 ore", „La jumătate de oră". */
export function pingEveryLabel(every: number): string {
  if (every === 60) return 'Din oră în oră'
  if (every === 30) return 'La jumătate de oră'
  if (every % 60 === 0) return `La ${every / 60} ore`
  return `La ${every} min`
}

/**
 * Jetonul seriei: pasul, fereastra și zilele — „La 15 min · 09:00–10:00 ·
 * zilnic", „Din oră în oră · 09:00–17:00". Fără `dueAt`/`remindAt` (o serie
 * pe jumătate) rămâne doar pasul.
 */
export function pingChipLabel(i: Pick<Issue, 'pingEvery' | 'remindAt' | 'dueAt' | 'rrule'>): string {
  if (!i.pingEvery) return ''
  const parts = [pingEveryLabel(i.pingEvery)]
  if (i.remindAt && i.dueAt) parts.push(`${toTimeInput(i.remindAt)}–${toTimeInput(i.dueAt)}`)
  const rec = describeRrule(i.rrule)
  if (rec) parts.push(rec)
  return parts.join(' · ')
}

/** Tichetul e o serie de mementouri care chiar poate suna. */
export function isPingSeries(i: Pick<Issue, 'pingEvery' | 'remindAt' | 'dueAt' | 'allDay'>): boolean {
  return !!i.pingEvery && !!i.remindAt && !!i.dueAt && !i.allDay
}

/**
 * O serie zilnică nebifată, cu fereastra trecută, trece pe următoarea ei zi —
 * oglinda lui `roll_ping_series()` din `supabase/migration-ping-series.sql`
 * (pg_cron, la minut), pentru modul local. Mementoul își ține distanța față de
 * capăt, deci fereastra rămâne aceeași, doar în altă zi. O serie doar de azi
 * (`rrule` null) rămâne restantă: n-are unde să sară. Neschimbat = același obiect.
 */
export function rollPingSeries(i: Issue, now: Date): Issue {
  if (!i.pingEvery || !i.rrule || i.done || !i.dueAt) return i
  if (Date.parse(i.dueAt) >= now.getTime()) return i
  const next = nextOccurrence(i.rrule, now, i.dueAt)
  if (!next) return i
  const remindAt = i.remindAt ? new Date(Date.parse(next) - (Date.parse(i.dueAt) - Date.parse(i.remindAt))).toISOString() : null
  return { ...i, dueAt: next, remindAt }
}
