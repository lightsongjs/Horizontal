import { describe, expect, it } from 'vitest'
import { isMine, onlyMine, type Me } from './ownership'
import { NO_SCHEDULE, buildSmartLists } from './schedule'
import type { Issue } from './types'

const ME: Me = { assigneeId: 'a-me', userId: 'u-me' }

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false,
    selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', urgent: false,
    ...NO_SCHEDULE, ...patch,
  }
}

describe('isMine', () => {
  const cases: [string, Partial<Issue>, boolean][] = [
    ['pasată mie', { assigneeId: 'a-me', createdBy: 'u-other' }, true],
    ['pasată mie, creată de mine', { assigneeId: 'a-me', createdBy: 'u-me' }, true],
    ['pasată altcuiva, deși creată de mine', { assigneeId: 'a-other', createdBy: 'u-me' }, false],
    ['nepasată, creată de mine', { assigneeId: null, createdBy: 'u-me' }, true],
    ['nepasată, creată de altcineva', { assigneeId: null, createdBy: 'u-other' }, false],
    ['nepasată, fără autor (unealtă / cheia de serviciu)', { assigneeId: null, createdBy: null }, true],
  ]
  for (const [name, patch, want] of cases) {
    it(name, () => expect(isMine(task('x', patch), ME)).toBe(want))
  }

  it('un rând din cache fără câmpul createdBy contează ca fără autor', () => {
    const old = { assigneeId: null } as unknown as Issue
    expect(isMine(old, ME)).toBe(true)
  })

  it('fără identitate completă (local, fără sesiune, cont nelegat) totul e al meu', () => {
    const other = task('x', { assigneeId: 'a-other', createdBy: 'u-other' })
    expect(isMine(other, { assigneeId: null, userId: 'u-me' })).toBe(true)
    expect(isMine(other, { assigneeId: 'a-me', userId: null })).toBe(true)
    expect(isMine(other, { assigneeId: null, userId: null })).toBe(true)
  })
})

describe('onlyMine + buildSmartLists', () => {
  // Luni, 24 august 2026, 08:40 local.
  const NOW = new Date(2026, 7, 24, 8, 40)
  const day = (off: number, h: number) => ({ dueAt: new Date(2026, 7, 24 + off, h).toISOString(), allDay: false })
  const issues = [
    task('mine-today', { ...day(0, 14), createdBy: 'u-me' }),
    task('handed-to-me', { ...day(0, 15), assigneeId: 'a-me', createdBy: 'u-other' }),
    task('tool-made', { ...day(0, 16) }),
    task('theirs-today', { ...day(0, 10), createdBy: 'u-other' }),
    task('handed-away', { ...day(0, 11), assigneeId: 'a-other', createdBy: 'u-me' }),
    task('theirs-late', { ...day(-1, 9), createdBy: 'u-other' }),
    task('mine-late', { ...day(-1, 9), createdBy: 'u-me' }),
    task('theirs-tmr', { ...day(1, 9), assigneeId: 'a-other' }),
    task('mine-tmr', { ...day(1, 9), assigneeId: 'a-me' }),
    task('theirs-done', { ...day(0, 8), done: true, createdBy: 'u-other' }),
  ]

  it('„Azi", restanțele, „7 zile" și „terminate azi" arată doar ce e al meu', () => {
    const L = buildSmartLists(onlyMine(issues, ME), NOW)
    expect(L.today.map((i) => i.id)).toEqual(['mine-today', 'handed-to-me', 'tool-made'])
    expect(L.overdue.map((i) => i.id)).toEqual(['mine-late'])
    expect(L.week.flatMap((d) => d.issues.map((i) => i.id))).toEqual(['mine-tmr'])
    expect(L.doneToday).toEqual([])
  })

  it('fără identitate, lista e neatinsă (aceeași referință)', () => {
    expect(onlyMine(issues, { assigneeId: null, userId: 'u-me' })).toBe(issues)
  })
})
