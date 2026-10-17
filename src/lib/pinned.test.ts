import { describe, expect, it } from 'vitest'
import { comparePinned, isPinned, isPinnedOpen, pinPatch, pinnedFirst, unpinned } from './pinned'
import { NO_SCHEDULE } from './schedule'
import type { Issue } from './types'

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false,
    selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', urgent: false,
    ...NO_SCHEDULE, ...patch,
  }
}
const NOW = new Date('2026-10-17T07:00:00.000Z')
const T1 = '2026-10-16T07:00:00.000Z'
const T2 = '2026-10-17T06:00:00.000Z'

describe('pinned', () => {
  it('fixat = are `pinnedAt`; sus urcă doar cel deschis', () => {
    expect(isPinned(task('A'))).toBe(false)
    expect(isPinned(task('A', { pinnedAt: T1 }))).toBe(true)
    expect(isPinnedOpen(task('A', { pinnedAt: T1, done: true }))).toBe(false)
  })

  it('pinPatch comută: fixează acum, apoi scoate', () => {
    expect(pinPatch(task('A'), NOW)).toEqual({ pinnedAt: NOW.toISOString() })
    expect(pinPatch(task('A', { pinnedAt: T1 }), NOW)).toEqual({ pinnedAt: null })
  })

  it('comparePinned: cel mai recent primul', () => {
    const xs = [task('A', { pinnedAt: T1 }), task('B', { pinnedAt: T2 })].sort(comparePinned)
    expect(xs.map((i) => i.id)).toEqual(['B', 'A'])
  })

  it('pinnedFirst: fixatele deschise sus, restul în ordinea primită', () => {
    const xs = [task('A'), task('B', { pinnedAt: T1 }), task('C'), task('D', { pinnedAt: T2 }), task('E', { pinnedAt: T2, done: true })]
    expect(pinnedFirst(xs).map((i) => i.id)).toEqual(['D', 'B', 'A', 'C', 'E'])
    // Fără fixate, aceeași listă (aceeași referință — nimic de recalculat).
    const plain = [task('A'), task('B')]
    expect(pinnedFirst(plain)).toBe(plain)
  })

  it('unpinned: scoate fixatele deschise din grupul zilei, bifatele rămân', () => {
    const xs = [task('A'), task('B', { pinnedAt: T1 }), task('C', { pinnedAt: T2, done: true })]
    expect(unpinned(xs).map((i) => i.id)).toEqual(['A', 'C'])
    const plain = [task('A')]
    expect(unpinned(plain)).toBe(plain)
  })
})
