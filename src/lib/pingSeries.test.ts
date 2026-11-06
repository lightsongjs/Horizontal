;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import { isPingSeries, pingChipLabel, pingEveryLabel, rollPingSeries, seriesWindow, type SeriesSpec } from './pingSeries'
import { NO_SCHEDULE } from './schedule'
import type { Issue } from './types'

// Vineri, 6 noiembrie 2026, 09:07:30 local (EET).
const NOW = new Date(2026, 10, 6, 9, 7, 30)
const spec = (o: Partial<SeriesSpec>): SeriesSpec => ({ every: 15, start: null, end: null, align: false, day: null, rrule: null, ...o })
const hm = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const win = (o: Partial<SeriesSpec>) => {
  const w = seriesWindow(spec(o), NOW)
  return `${hm(w.remindAt)} → ${hm(w.dueAt)}`
}

describe('seriesWindow', () => {
  it('fără start: acum (la minut) + pas, până la 23:59', () => {
    expect(win({})).toBe('6 09:22 → 6 23:59')
  })
  it('„la fix": primul punct al grilei de ceas', () => {
    expect(win({ align: true })).toBe('6 09:15 → 6 23:59')
    expect(win({ every: 60, align: true })).toBe('6 10:00 → 6 23:59')
    expect(win({ every: 120, align: true })).toBe('6 10:00 → 6 23:59')
  })
  it('„la fix" cu un pas care nu împarte ora: ora fixă următoare', () => {
    expect(win({ every: 45, align: true })).toBe('6 10:00 → 6 23:59')
  })
  it('startul trecut azi: grila rămâne ancorată pe start (sună doar ce vine)', () => {
    expect(win({ start: [9, 0], end: [10, 0] })).toBe('6 09:00 → 6 10:00')
  })
  it('fereastra trecută: mâine la start', () => {
    expect(win({ start: [7, 0], end: [8, 0] })).toBe('7 07:00 → 7 08:00')
  })
  it('fereastra trecută, fără start: mâine la 09:00', () => {
    expect(win({ end: [9, 5] })).toBe('7 09:00 → 7 09:05')
  })
  it('fereastra trecută pe o serie lunea: lunea care vine', () => {
    expect(win({ start: [7, 0], end: [8, 0], rrule: 'FREQ=WEEKLY;BYDAY=FR,MO' })).toBe('9 07:00 → 9 08:00')
  })
  it('o zi a seriei care nu e azi: ziua ei, la start sau la 09:00', () => {
    expect(win({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })).toBe('9 09:00 → 9 23:59')
  })
  it('o serie zilnică azi, cu fereastra încă deschisă, pornește azi', () => {
    expect(win({ start: [9, 0], end: [17, 0], rrule: 'FREQ=DAILY' })).toBe('6 09:00 → 6 17:00')
  })
  it('ziua numită: la start, sau la 09:00', () => {
    expect(win({ day: new Date(2026, 10, 7) })).toBe('7 09:00 → 7 23:59')
    expect(win({ day: new Date(2026, 10, 7), start: [14, 30], end: [15, 0] })).toBe('7 14:30 → 7 15:00')
  })
  it('„azi" scris rămâne azi, chiar trecută', () => {
    expect(win({ day: new Date(2026, 10, 6), start: [7, 0], end: [8, 0] })).toBe('6 07:00 → 6 08:00')
  })
})

describe('pingChipLabel', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString()
  it('pasul, fereastra, zilele', () => {
    expect(pingChipLabel({ pingEvery: 15, remindAt: at(9), dueAt: at(10), rrule: 'FREQ=DAILY' })).toBe('La 15 min · 09:00–10:00 · zilnic')
    expect(pingChipLabel({ pingEvery: 60, remindAt: at(9), dueAt: at(17), rrule: null })).toBe('Din oră în oră · 09:00–17:00')
  })
  it('fără serie: nimic', () => {
    expect(pingChipLabel({ pingEvery: null, remindAt: at(9), dueAt: at(10), rrule: null })).toBe('')
  })
  it('pașii în cuvinte', () => {
    expect([1, 30, 60, 90, 120].map(pingEveryLabel)).toEqual(['La 1 min', 'La jumătate de oră', 'Din oră în oră', 'La 90 min', 'La 2 ore'])
  })
})

describe('rollPingSeries — oglinda lui roll_ping_series()', () => {
  const base = { ...NO_SCHEDULE, id: 'A-1', projectId: 'p', title: 't', done: false, allDay: false } as unknown as Issue
  const series = { ...base, pingEvery: 15, rrule: 'FREQ=DAILY', remindAt: new Date(2026, 10, 5, 9, 0).toISOString(), dueAt: new Date(2026, 10, 5, 10, 0).toISOString() }
  it('zilnică, nebifată, cu fereastra trecută: aceeași fereastră, următoarea zi', () => {
    const r = rollPingSeries(series, NOW)
    expect([hm(r.remindAt!), hm(r.dueAt!)]).toEqual(['7 09:00', '7 10:00'])
  })
  it('doar de azi: rămâne restantă', () => {
    const today = { ...series, rrule: null }
    expect(rollPingSeries(today, NOW)).toBe(today)
  })
  it('fereastra încă deschisă, bifată sau fără serie: neatinsă', () => {
    const open = { ...series, dueAt: new Date(2026, 10, 6, 10, 0).toISOString() }
    expect(rollPingSeries(open, NOW)).toBe(open)
    const done = { ...series, done: true }
    expect(rollPingSeries(done, NOW)).toBe(done)
    const plain = { ...series, pingEvery: null }
    expect(rollPingSeries(plain, NOW)).toBe(plain)
  })
  it('isPingSeries cere pas, memento, capăt și oră', () => {
    expect(isPingSeries(series)).toBe(true)
    expect(isPingSeries({ ...series, allDay: true })).toBe(false)
    expect(isPingSeries({ ...series, remindAt: null })).toBe(false)
  })
})
