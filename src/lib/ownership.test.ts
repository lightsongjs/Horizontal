import { describe, expect, it } from 'vitest'
import { isMine, onlyMine, type Me } from './ownership'
import { NO_SCHEDULE, buildSmartLists } from './schedule'
import type { Issue } from './types'
import fixtures from './ownership.fixtures.json'

const ME: Me = { assigneeId: 'a-me', userId: 'u-me' }

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false,
    selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', urgent: false,
    ...NO_SCHEDULE, ...patch,
  }
}

describe('isMine', () => {
  // Aceleași cazuri le citește și JUnit (`core/OwnershipTest`, prin `FixturesTest`). Un caz nou se adaugă în JSON.
  for (const f of fixtures as { name: string; me: Me; issue: { assigneeId?: string | null; createdBy?: string | null }; want: boolean }[]) {
    it(f.name, () => expect(isMine(f.issue as Issue, f.me)).toBe(f.want))
  }
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
