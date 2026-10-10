// Fusul fixat înainte de primul Date: zilele locale sunt ale Bucureștiului.
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import {
  enabledCalendars, eventSpan, eventWhen, eventsOn, mergeDay, occurrenceDayLabel, occurrenceTime, upcomingEventReminders,
  type CalendarAccount, type CalendarEvent,
} from './calendarEvents'
import { planEventNotification } from './pushPayload'
import type { Issue } from './types'
import { NO_SCHEDULE } from './schedule'

const ev = (o: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  calendarId: 'c1', title: o.id, allDay: false, startAt: null, endAt: null, startDate: null, endDate: null,
  location: null, meetUrl: null, htmlLink: null, response: null, ...o,
})
const timed = (id: string, start: string, end: string, o: Partial<CalendarEvent> = {}) => ev({ id, startAt: start, endAt: end, ...o })
const allDay = (id: string, start: string, end: string, o: Partial<CalendarEvent> = {}) => ev({ id, allDay: true, startDate: start, endDate: end, ...o })

const accounts: CalendarAccount[] = [{
  id: 'a1', email: 'x@y.ro', status: 'ok', lastSyncedAt: null, lastError: null,
  calendars: [
    { id: 'c1', accountId: 'a1', name: 'Serviciu', color: '#4285f4', enabled: true, isPrimary: true },
    { id: 'c2', accountId: 'a1', name: 'Sărbători', color: '#0b8043', enabled: false, isPrimary: false },
  ],
}]
const cals = enabledCalendars(accounts)
// Luni 12 oct 2026, 09:30 ora României (EEST, UTC+3).
const NOW = new Date('2026-10-12T06:30:00Z')
const MON = new Date(2026, 9, 12)

const issue = (id: string, dueAt: string | null, allDayIssue: boolean): Issue => ({
  id, projectId: 'p', title: id, done: false, urgent: false, wave: 1, deps: [],
  ...NO_SCHEDULE, dueAt, allDay: allDayIssue,
} as unknown as Issue)

describe('eventSpan', () => {
  it('toată ziua: sfârșitul e exclusiv', () => {
    expect(eventSpan(allDay('a', '2026-10-12', '2026-10-13'))?.days).toBe(1)
    expect(eventSpan(allDay('a', '2026-10-12', '2026-10-17'))?.days).toBe(5)
  })
  it('cu oră: un sfârșit fix la miezul nopții nu se revarsă', () => {
    expect(eventSpan(timed('t', '2026-10-12T19:00:00Z', '2026-10-12T21:00:00Z'))?.days).toBe(1) // 22–00 local
    expect(eventSpan(timed('t', '2026-10-12T19:00:00Z', '2026-10-12T23:00:00Z'))?.days).toBe(2) // 22–02
  })
  it('capete stricate: null', () => {
    expect(eventSpan(ev({ id: 'x', allDay: true }))).toBeNull()
    expect(eventSpan(timed('x', 'nu', '2026-10-12T10:00:00Z'))).toBeNull()
  })
})

describe('eventsOn', () => {
  const events = [
    timed('standup', '2026-10-12T07:00:00Z', '2026-10-12T07:15:00Z'),           // 10:00–10:15
    timed('trecut', '2026-10-12T05:00:00Z', '2026-10-12T06:00:00Z'),            // 08:00–09:00, gata
    timed('noapte', '2026-10-12T19:00:00Z', '2026-10-12T23:00:00Z'),            // 22:00–02:00
    allDay('concediu', '2026-10-11', '2026-10-16'),                              // dum–joi
    allDay('craciun', '2026-10-12', '2026-10-13', { calendarId: 'c2' }),         // calendar oprit
    timed('refuzat', '2026-10-12T08:00:00Z', '2026-10-12T09:00:00Z', { response: 'declined' }),
  ]
  it('ziua de azi: banda, rândurile pe oră, estomparea, calendarul oprit lipsește', () => {
    const d = eventsOn(events, cals, MON, NOW)
    expect(d.band.map((o) => [o.event.id, occurrenceDayLabel(o)])).toEqual([['concediu', 'ziua 2/5']])
    expect(d.timed.map((o) => o.event.id)).toEqual(['trecut', 'standup', 'refuzat', 'noapte'])
    expect(d.timed.map((o) => o.ended)).toEqual([true, false, false, false])
    expect(d.timed.find((o) => o.event.id === 'refuzat')?.declined).toBe(true)
    expect(occurrenceTime(d.timed[1])).toBe('10:00–10:15')
    expect(d.timed[0].color).toBe('#4285f4')
  })
  it('a doua zi a unui eveniment peste miezul nopții stă în bandă', () => {
    const d = eventsOn(events, cals, new Date(2026, 9, 13), NOW)
    expect(d.band.map((o) => [o.event.id, occurrenceDayLabel(o)])).toEqual([['concediu', 'ziua 3/5'], ['noapte', 'ziua 2/2']])
    expect(d.timed).toEqual([])
    expect(occurrenceTime(d.band[1])).toBeNull()
  })
  it('ziua de ieri: toată ziua e „terminată”', () => {
    const d = eventsOn(events, cals, new Date(2026, 9, 11), NOW)
    expect(d.band.map((o) => [o.event.id, o.ended])).toEqual([['concediu', true]])
  })
})

describe('mergeDay', () => {
  it('fără oră sus, apoi pe oră; la egalitate evenimentul întâi', () => {
    const d = eventsOn([
      timed('e10', '2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z'),
      timed('e14', '2026-10-12T11:00:00Z', '2026-10-12T12:00:00Z'),
    ], cals, MON, NOW)
    const rows = mergeDay([
      issue('fara-ora', '2026-10-11T21:00:00Z', true),
      issue('s09', '2026-10-12T06:00:00Z', false),
      issue('s10', '2026-10-12T07:00:00Z', false),
      issue('s16', '2026-10-12T13:00:00Z', false),
    ], d.timed)
    expect(rows.map((r) => (r.kind === 'issue' ? r.issue.id : r.occ.event.id)))
      .toEqual(['fara-ora', 's09', 'e10', 's10', 'e14', 's16'])
  })
  it('fără evenimente, sarcinile rămân neatinse', () => {
    const list = [issue('a', null, true), issue('b', '2026-10-12T06:00:00Z', false)]
    expect(mergeDay(list, []).map((r) => r.kind === 'issue' && r.issue.id)).toEqual(['a', 'b'])
  })
})

describe('upcomingEventReminders (cutia de Linux)', () => {
  const list = [
    timed('ședință', '2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z', { location: 'Sala 2' }), // 10:00
    timed('refuzat', '2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z', { response: 'declined' }),
    allDay('zi', '2026-10-12', '2026-10-13'),
    timed('oprit', '2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z', { calendarId: 'c2' }),
    timed('poimâine', '2026-10-14T07:00:00Z', '2026-10-14T08:00:00Z'),
  ]
  it('două trepte, cu textul comun; refuzate, toată ziua, oprite și cele de peste orizont lipsesc', () => {
    const r = upcomingEventReminders(list, cals, NOW)
    expect(r).toEqual([
      { key: 'cal:ședință@2026-10-12T06:50:00.000Z', id: 'cal:ședință', at: '2026-10-12T06:50:00.000Z', title: 'Peste 10 min: ședință', body: '10:00–11:00 · Sala 2', dueAt: null, allDay: false, kind: 'event' },
      { key: 'cal:ședință@2026-10-12T07:00:00.000Z', id: 'cal:ședință', at: '2026-10-12T07:00:00.000Z', title: 'Acum: ședință', body: '10:00–11:00 · Sala 2', dueAt: null, allDay: false, kind: 'event' },
    ])
  })
  it('„Peste 10 min” iese la start, „Acum” la 10 minute după', () => {
    expect(upcomingEventReminders(list, cals, new Date('2026-10-12T07:00:00Z')).map((x) => x.title)).toEqual(['Acum: ședință'])
    expect(upcomingEventReminders(list, cals, new Date('2026-10-12T07:10:00Z'))).toEqual([])
  })
})

describe('planEventNotification (service worker)', () => {
  it('textul, fără butoane, tag comun treptelor, deschide evenimentul', () => {
    const p = planEventNotification({
      kind: 'event', id: 'cal:abc', stage: 'pre', title: 'Peste 10 min: X', eventTitle: 'Standup',
      startAt: '2026-10-12T07:00:00Z', endAt: '2026-10-12T07:15:00Z', location: 'Sala 2',
    })
    expect(p).toEqual({ title: 'Peste 10 min: Standup', body: '10:00–10:15 · Sala 2', url: '/?event=abc', tag: 'cal:abc', actions: [], request: null })
  })
  it('un payload sărac nu dă o notificare goală', () => {
    const p = planEventNotification({ kind: 'event', id: 'cal:abc', title: 'Acum: Y' })
    expect([p.title, p.body]).toEqual(['Acum: Y', 'Google Calendar'])
  })
})

describe('eventWhen', () => {
  it('o zi, toată ziua, multi-zi', () => {
    expect(eventWhen(timed('a', '2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z'))).toBe('luni, 12 octombrie · 10:00–11:00')
    expect(eventWhen(allDay('b', '2026-10-12', '2026-10-13'))).toBe('luni, 12 octombrie · toată ziua')
    expect(eventWhen(allDay('c', '2026-10-12', '2026-10-15'))).toBe('luni, 12 octombrie – miercuri, 14 octombrie')
    expect(eventWhen(timed('d', '2026-10-12T19:00:00Z', '2026-10-12T23:00:00Z'))).toBe('luni, 12 octombrie, 22:00 – marți, 13 octombrie, 02:00')
  })
})
