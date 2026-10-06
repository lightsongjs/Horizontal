// Fusul ÎNAINTE de orice Date: regula e pe zile locale, iar fixtures-urile sunt
// scrise pentru București (le citește și JUnit, cu același fus).
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fixtures from './agenda.fixtures.json'
import { buildSmartLists, NO_SCHEDULE } from './schedule'
import { agendaItems, AGENDA_LIMIT } from './agenda'
import type { Issue } from './types'

const issue = (p: Partial<Issue> & { id: string }): Issue =>
  ({ ...NO_SCHEDULE, projectId: 'p1', title: p.id, done: false, urgent: false, ...p }) as Issue

describe('agenda — fixtures comune cu Kotlin', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const lists = buildSmartLists(f.items.map((i) => issue(i)), new Date(f.now))
      const got: unknown[] = []
      if (lists.overdue.length) got.push({ section: 'overdue', ids: lists.overdue.map((i) => i.id) })
      lists.week.forEach((d, offset) => { if (d.issues.length) got.push({ section: 'day', offset, ids: d.issues.map((i) => i.id) }) })
      expect(got).toEqual(f.want)
    })
  }
})

describe('agendaItems', () => {
  const now = new Date('2026-10-06T08:00:00.000Z')
  const projects = [{ id: 'p1', name: 'Daily' }]

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
      { id: 'HZ-5', title: 'HZ-5', project: null, dueAt: '2026-09-01T21:00:00.000Z', allDay: true, hasReminder: false, recurring: false, urgent: false },
      { id: 'HZ-1', title: 'HZ-1', project: 'Daily', dueAt: '2026-10-06T11:30:00.000Z', allDay: false, hasReminder: true, recurring: true, urgent: false },
    ])
  })

  it(`se oprește la ${AGENDA_LIMIT}`, () => {
    const many = Array.from({ length: AGENDA_LIMIT + 5 }, (_, i) => issue({ id: `HZ-${i}`, dueAt: '2026-10-05T21:00:00.000Z' }))
    expect(agendaItems(many, projects, now)).toHaveLength(AGENDA_LIMIT)
  })
})
