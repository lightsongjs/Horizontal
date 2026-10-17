// Fusul ÎNAINTE de orice Date: regula e pe zile locale, iar fixtures-urile sunt
// scrise pentru București (le citește și JUnit, cu același fus).
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fixtures from './agenda.fixtures.json'
import { buildSmartLists, NO_SCHEDULE, SMART_LIST_DAYS } from './schedule'
import { agendaItems, AGENDA_LIMIT } from './agenda'
import { comparePinned, unpinned } from './pinned'
import type { Issue } from './types'

type FixtureItem = { id: string; dueAt?: string; allDay: boolean; urgent: boolean; remindAt?: string; routine?: boolean; accent?: string; pinnedAt?: string }
type Fixture = { name: string; now: string; items: FixtureItem[]; want: unknown[]; todayCount?: number }

const issue = (p: Partial<Issue> & { id: string }): Issue =>
  ({ ...NO_SCHEDULE, projectId: 'p1', title: p.id, done: false, urgent: false, ...p }) as Issue

describe('agenda — fixtures comune cu Kotlin', () => {
  for (const f of fixtures as Fixture[]) {
    it(f.name, () => {
      // `routine: true` = proiect „doar mementouri" (`src/lib/routines.ts`).
      // `accent` = culoarea proiectului: fiecare rând cu accent stă în proiectul lui.
      const items = f.items.map(({ routine, accent, ...i }: FixtureItem) => issue({ ...i, projectId: routine ? 'rut' : accent ? `p-${i.id}` : 'p1' }))
      const lists = buildSmartLists(items, new Date(f.now), new Set(['rut']))
      const got: unknown[] = []
      // Widget-ul arată azi + zilele 1..6 (`SMART_LIST_DAYS`); lista „7 zile" din
      // aplicație începe de mâine și ține până la +7, deci azi vine din `today`,
      // iar ziua +7 nu e a widget-ului.
      const days = [{ offset: 0, issues: lists.today }, ...lists.week.filter((d) => d.offset < SMART_LIST_DAYS)]
      // `pinnedAt`: widget-ul e O listă, deci un singur grup „Fixate", primul — numai
      // dintre rândurile lui (`pinned` din „Azi" + `weekPinned` din zilele lui).
      const weekDays = new Set(days.flatMap((d) => d.issues.map((i) => i.id)))
      const pinned = [...lists.pinned, ...lists.weekPinned.filter((i) => weekDays.has(i.id))].sort(comparePinned)
      if (pinned.length) got.push({ section: 'pinned', ids: pinned.map((i) => i.id) })
      if (unpinned(lists.overdue).length) got.push({ section: 'overdue', ids: unpinned(lists.overdue).map((i) => i.id) })
      days.forEach(({ offset, issues }) => { if (unpinned(issues).length) got.push({ section: 'day', offset, ids: unpinned(issues).map((i) => i.id) }) })
      expect(got).toEqual(f.want)
      // Numărul „Azi" (`listCount` din `App.tsx`) = antetul widget-ului și notificarea din bară
      // (`todayCount`). Fixarea nu-l schimbă: e exact numărul de fără fixare.
      if (f.todayCount !== undefined) expect(lists.overdue.length + lists.today.length).toBe(f.todayCount)
      // Culoarea ajunge în widget neatinsă (Kotlin o citește în `FixturesTest.agenda`).
      const projects = [{ id: 'p1', name: 'P' }, { id: 'rut', name: 'R', remindersOnly: true },
        ...f.items.filter((i: FixtureItem) => i.accent).map((i: FixtureItem) => ({ id: `p-${i.id}`, name: i.id, accent: i.accent }))]
      const accents = Object.fromEntries(f.items.map((i: FixtureItem) => [i.id, i.accent ?? null]))
      const sent = agendaItems(items, projects, new Date(f.now))
      for (const a of sent) expect([a.id, a.accent]).toEqual([a.id, accents[a.id]])
      // Ce trimite pagina cutiei conține fixatele agendei, cu momentul fixării neatins.
      for (const p of pinned) expect(sent.find((a) => a.id === p.id)?.pinnedAt).toBe(p.pinnedAt)
    })
  }
})

describe('agendaItems', () => {
  const now = new Date('2026-10-06T08:00:00.000Z')
  const projects = [{ id: 'p1', name: 'Daily', accent: '#2F6BFF' }]

  it('ia doar nebifatele cu scadență din fereastră, o dată fiecare, cu proiectul și semnele', () => {
    const a = issue({ id: 'HZ-1', dueAt: '2026-10-06T11:30:00.000Z', allDay: false, remindAt: '2026-10-06T11:20:00.000Z', rrule: 'FREQ=DAILY' })
    const got = agendaItems([
      a, a,                                                                     // dublură (dueIssues + issues)
      issue({ id: 'HZ-2', dueAt: '2026-10-06T11:30:00.000Z', done: true }),     // bifată
      issue({ id: 'HZ-3' }),                                                    // fără scadență
      issue({ id: 'HZ-4', dueAt: '2026-10-12T21:00:00.000Z' }),                 // ziua a 7-a
      issue({ id: 'HZ-5', dueAt: '2026-09-01T21:00:00.000Z', projectId: 'px' }),// restanță veche, proiect necunoscut
    ], projects, now)
    expect(got).toEqual([
      { id: 'HZ-5', title: 'HZ-5', project: null, dueAt: '2026-09-01T21:00:00.000Z', allDay: true, hasReminder: false, recurring: false, urgent: false, hiddenUntil: null, accent: null, pinnedAt: null },
      { id: 'HZ-1', title: 'HZ-1', project: 'Daily', dueAt: '2026-10-06T11:30:00.000Z', allDay: false, hasReminder: true, recurring: true, urgent: false, hiddenUntil: null, accent: '#2F6BFF', pinnedAt: null },
    ])
  })

  it('o rutină poartă momentul de la care se vede (mementoul, altfel scadența) și intră chiar dacă e încă ascunsă', () => {
    const got = agendaItems([
      issue({ id: 'R-1', projectId: 'rut', dueAt: '2026-10-06T18:00:00.000Z', allDay: false, remindAt: '2026-10-06T17:50:00.000Z' }),
      issue({ id: 'R-2', projectId: 'rut', dueAt: '2026-10-06T21:00:00.000Z' }),
    ], [...projects, { id: 'rut', name: 'Rutine', remindersOnly: true }], now)
    expect(got.map((i) => [i.id, i.hiddenUntil])).toEqual([['R-1', '2026-10-06T17:50:00.000Z'], ['R-2', '2026-10-06T21:00:00.000Z']])
  })

  it('o fixată intră numai dacă ar intra oricum: nu fără scadență, nu dincolo de fereastră, nu bifată', () => {
    const got = agendaItems([
      issue({ id: 'HZ-1', dueAt: '2026-10-05T21:00:00.000Z' }),
      issue({ id: 'P-1', pinnedAt: '2026-10-05T10:00:00.000Z' }),                                   // fără scadență
      issue({ id: 'P-2', dueAt: '2026-10-20T21:00:00.000Z', pinnedAt: '2026-10-06T07:00:00.000Z' }), // peste două săptămâni
      issue({ id: 'P-3', dueAt: '2026-10-05T21:00:00.000Z', pinnedAt: '2026-10-06T07:30:00.000Z', done: true }), // bifată
      issue({ id: 'P-4', dueAt: '2026-10-03T21:00:00.000Z', pinnedAt: '2026-10-06T07:40:00.000Z' }), // restantă
    ], projects, now)
    expect(got.map((i) => [i.id, i.pinnedAt])).toEqual([
      ['P-4', '2026-10-06T07:40:00.000Z'],
      ['HZ-1', null],
    ])
  })

  it(`se oprește la ${AGENDA_LIMIT}`, () => {
    const many = Array.from({ length: AGENDA_LIMIT + 5 }, (_, i) => issue({ id: `HZ-${i}`, dueAt: '2026-10-05T21:00:00.000Z' }))
    expect(agendaItems(many, projects, now)).toHaveLength(AGENDA_LIMIT)
  })
})
