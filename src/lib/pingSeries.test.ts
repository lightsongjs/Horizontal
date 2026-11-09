;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import { isPingSeries, pingChipLabel, pingEveryLabel, pingNextLabel, pingPanelLabel, pingRowTime, rollPingSeries, seriesState, seriesWindow, type SeriesSpec } from './pingSeries'
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

describe('seriesState — unde e seria (regula din `_shared/pings.ts`)', () => {
  const at = (h: number, m = 0, d = 6) => new Date(2026, 10, d, h, m).toISOString()
  const s = { pingEvery: 60, remindAt: at(10, 48), dueAt: at(16), done: false }
  const hmOf = (ms: number | null) => (ms === null ? null : hm(new Date(ms).toISOString()))
  it('înainte de primul: următorul = primul; ultimul = ultimul ping REAL (15:48), nu capătul', () => {
    const st = seriesState(s, new Date(2026, 10, 6, 9, 20))!
    expect([st.phase, hmOf(st.next), hmOf(st.last), st.count]).toEqual(['before', '6 10:48', '6 15:48', 6])
  })
  it('în timpul seriei: următorul după acum', () => {
    const st = seriesState(s, new Date(2026, 10, 6, 11, 5))!
    expect([st.phase, hmOf(st.next)]).toEqual(['during', '6 11:48'])
  })
  it('după ultimul ping: încheiată, fără următorul', () => {
    const st = seriesState(s, new Date(2026, 10, 6, 15, 50))!
    expect([st.phase, st.next, hmOf(st.last)]).toEqual(['ended', null, '6 15:48'])
  })
  it('bifată / pe jumătate / fără serie', () => {
    expect(seriesState({ ...s, done: true }, NOW)!.phase).toBe('done')
    expect(seriesState({ ...s, remindAt: null }, NOW)!.phase).toBe('partial')
    expect(seriesState({ ...s, pingEvery: null }, NOW)).toBeNull()
  })
})

describe('pingChipLabel — jetonul seriei din fereastra tichetului', () => {
  const at = (h: number, m = 0, d = 6) => new Date(2026, 10, d, h, m).toISOString()
  const s = { pingEvery: 60, remindAt: at(10, 48), dueAt: at(16), rrule: null as string | null, done: false }
  const t = (h: number, m = 0, d = 6) => new Date(2026, 10, d, h, m)
  it('înainte de primul și în timpul seriei: „Următorul"', () => {
    expect(pingChipLabel(s, t(9, 20))).toBe('Următorul 10:48 · din oră în oră')
    expect(pingChipLabel(s, t(11, 5))).toBe('Următorul 11:48 · din oră în oră')
  })
  it('după ultimul: încheiată, cu ultimul ping real', () => {
    expect(pingChipLabel(s, t(15, 50))).toBe('Serie încheiată (ultimul 15:48)')
  })
  it('zilnică, mâine: ziua în locul lui „Următorul", zilele la coadă', () => {
    expect(pingChipLabel({ ...s, rrule: 'FREQ=DAILY', remindAt: at(10, 48, 7), dueAt: at(16, 0, 7) }, t(20))).toBe('Mâine 10:48 · din oră în oră · zilnic')
  })
  it('în viitor, peste câteva zile: ziua întreagă („Miercuri 09:00"), nu o oră care pare azi', () => {
    expect(pingChipLabel({ ...s, remindAt: at(9, 0, 11), dueAt: at(16, 0, 11) }, t(9, 20))).toBe('Miercuri 09:00 · din oră în oră, la fix')
  })
  it('la fix: grila pe ora fixă', () => {
    expect(pingChipLabel({ ...s, remindAt: at(10), dueAt: at(16) }, t(10, 20))).toBe('Următorul 11:00 · din oră în oră, la fix')
    expect(pingChipLabel({ ...s, pingEvery: 15, remindAt: at(9, 45), dueAt: at(10) }, t(9, 50))).toBe('Următorul 10:00 · la 15 min, la fix')
    expect(pingChipLabel({ ...s, pingEvery: 45, remindAt: at(10), dueAt: at(16) }, t(9))).toBe('Următorul 10:00 · la 45 min')
  })
  it('bifată / pe jumătate: doar regula', () => {
    expect(pingChipLabel({ ...s, done: true }, t(11))).toBe('Din oră în oră')
    expect(pingChipLabel({ ...s, remindAt: null, dueAt: null }, t(11))).toBe('Din oră în oră')
  })
  it('fără serie: nimic', () => {
    expect(pingChipLabel({ ...s, pingEvery: null }, t(11))).toBe('')
  })
  it('pașii în cuvinte', () => {
    expect([1, 30, 60, 90, 120].map(pingEveryLabel)).toEqual(['La 1 min', 'La jumătate de oră', 'Din oră în oră', 'La 90 min', 'La 2 ore'])
  })
})

describe('pingNextLabel — doar următorul ping (foaia de pe telefon)', () => {
  const at = (h: number, m = 0, d = 6) => new Date(2026, 10, d, h, m).toISOString()
  const s = { pingEvery: 60, remindAt: at(10, 48), dueAt: at(16), done: false }
  it('azi, altă zi, nimic după ultimul', () => {
    expect(pingNextLabel(s, new Date(2026, 10, 6, 11, 5))).toBe('Următorul 11:48')
    expect(pingNextLabel({ ...s, remindAt: at(10, 48, 7), dueAt: at(16, 0, 7) }, new Date(2026, 10, 6, 20))).toBe('Mâine 10:48')
    expect(pingNextLabel(s, new Date(2026, 10, 6, 15, 50))).toBeNull()
  })
})

describe('pingPanelLabel — rândul din panoul datei', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString()
  it('pasul, primul → ultimul real, câte, capătul', () => {
    expect(pingPanelLabel({ pingEvery: 60, remindAt: at(10, 48), dueAt: at(16) })).toBe('din oră în oră, 10:48 → 15:48 (6 mementouri), până la 16:00')
    expect(pingPanelLabel({ pingEvery: 60, remindAt: at(10), dueAt: at(10) })).toBe('din oră în oră, la fix, 10:00 (un memento), până la 10:00')
  })
})

describe('pingRowTime — ora din rândul listei', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString()
  const s = { pingEvery: 60, remindAt: at(10, 48), dueAt: at(16), done: false }
  it('următorul ping, nu capătul', () => {
    expect(pingRowTime(s, new Date(2026, 10, 6, 9, 20))).toBe('10:48')
    expect(pingRowTime(s, new Date(2026, 10, 6, 11, 5))).toBe('11:48')
  })
  it('încheiată / bifată / fără serie: null (rândul arată capătul, roșu ca restanță)', () => {
    expect(pingRowTime(s, new Date(2026, 10, 6, 15, 50))).toBeNull()
    expect(pingRowTime({ ...s, done: true }, new Date(2026, 10, 6, 11))).toBeNull()
    expect(pingRowTime({ ...s, pingEvery: null }, new Date(2026, 10, 6, 11))).toBeNull()
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
