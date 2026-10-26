import { describe, expect, it } from 'vitest'
import { daysLeft, daysWord, deletedWhen, expiryLabel, planRestore, restoreNotice, sortTrash, trashMeta, TRASH_DAYS, type TrashItem } from './trash'
import type { Issue } from './types'

const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id, projectId: 'hz', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [], scenarios: [],
  assigneeId: null, createdBy: null, createdAt: '2026-10-01T00:00:00.000Z', urgent: false, dueAt: null, allDay: true,
  remindAt: null, rrule: null, pinnedAt: null, ...extra,
})
const item = (issueId: string, deletedAt: string, extra: Partial<TrashItem> = {}): TrashItem => ({
  id: `t-${issueId}`, issueId, projectId: 'hz', title: issueId, deletedAt, deletedBy: null, deletedByName: null, ...extra,
})
const now = new Date(2026, 9, 26, 15, 0)

describe('textele coșului', () => {
  it('cele mai noi întâi', () => {
    const out = sortTrash([item('HZ-01', '2026-10-20T10:00:00Z'), item('HZ-02', '2026-10-25T10:00:00Z'), item('HZ-03', '2026-10-22T10:00:00Z')])
    expect(out.map((i) => i.issueId)).toEqual(['HZ-02', 'HZ-03', 'HZ-01'])
  })

  it('pluralul zilelor', () => {
    expect([1, 2, 19, 20, 29, 30, 101, 120].map(daysWord)).toEqual(['1 zi', '2 zile', '19 zile', '20 de zile', '29 de zile', '30 de zile', '101 zile', '120 de zile'])
  })

  it('câte zile mai stă', () => {
    expect(daysLeft(now.toISOString(), now)).toBe(TRASH_DAYS)
    expect(daysLeft(new Date(now.getTime() - 29.5 * 86_400_000).toISOString(), now)).toBe(1)
    expect(daysLeft(new Date(now.getTime() - 31 * 86_400_000).toISOString(), now)).toBe(0)
    expect(expiryLabel(new Date(now.getTime() - 31 * 86_400_000).toISOString(), now)).toBe('pleacă azi')
    expect(expiryLabel(new Date(now.getTime() - 86_400_000).toISOString(), now)).toBe('încă 29 de zile')
  })

  it('când: azi / ieri cu oră, altfel ziua', () => {
    expect(deletedWhen(new Date(2026, 9, 26, 9, 5).toISOString(), now)).toBe('azi 09:05')
    expect(deletedWhen(new Date(2026, 9, 25, 23, 59).toISOString(), now)).toBe('ieri 23:59')
    expect(deletedWhen(new Date(2026, 9, 11, 8, 0).toISOString(), now)).toBe('11 oct')
    expect(deletedWhen(new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe('30 dec 2025')
  })

  it('coada rândului sare peste ce nu se știe', () => {
    const at = new Date(2026, 9, 26, 9, 5).toISOString()
    expect(trashMeta(item('HZ-01', at, { deletedByName: 'Ion' }), 'Inbox', now)).toBe('Inbox · azi 09:05 · Ion')
    expect(trashMeta(item('HZ-01', at), undefined, now)).toBe('azi 09:05')
  })

  it('toastul spune când numărul s-a schimbat', () => {
    expect(restoreNotice({ id: 'HZ-12', originalId: 'HZ-12' })).toBe('HZ-12 a revenit.')
    expect(restoreNotice({ id: 'HZ-15', originalId: 'HZ-12' })).toBe('HZ-12 a revenit ca HZ-15 — numărul vechi fusese refolosit.')
  })
})

describe('planRestore (modul local, oglinda lui restore_issue)', () => {
  const ctx = (issues: Issue[], extra = {}) => ({
    project: { prefix: 'HZ', currentWave: 3 }, issues, waves: [0, 1, 3], themes: ['ui'], obstacleIds: ['HZ-O01'], ...extra,
  })

  it('păstrează numărul liber și tot ce mai există', () => {
    const p = planRestore(
      { issue: issue('HZ-12', { deps: ['HZ-01', 'HZ-09'], theme: 'ui', wave: 1 }), dependents: ['HZ-02', 'HZ-08'], obstacleIds: ['HZ-O01', 'HZ-O07'] },
      ctx([issue('HZ-01'), issue('HZ-02')]),
    )
    expect(p.issue).toMatchObject({ id: 'HZ-12', deps: ['HZ-01'], theme: 'ui', wave: 1 })
    expect(p.dependents).toEqual(['HZ-02'])
    expect(p.obstacleIds).toEqual(['HZ-O01'])
  })

  it('numărul refolosit → cel mai mare + 1', () => {
    const p = planRestore({ issue: issue('HZ-02'), dependents: [], obstacleIds: [] }, ctx([issue('HZ-01'), issue('HZ-02', { title: 'altul' })]))
    expect(p.issue.id).toBe('HZ-03')
  })

  it('un ID luat în alt proiect sare mai departe', () => {
    const p = planRestore({ issue: issue('HZ-02'), dependents: [], obstacleIds: [] }, ctx([issue('HZ-02', { projectId: 'old' }), issue('HZ-01'), issue('HZ-03', { projectId: 'old' })]))
    // În proiect: HZ-01 → HZ-02 (luat) → HZ-03 (luat) → HZ-04.
    expect(p.issue.id).toBe('HZ-04')
  })

  it('valul și tema dispărute', () => {
    const p = planRestore({ issue: issue('HZ-12', { wave: 2, theme: 'vechi' }), dependents: [], obstacleIds: [] }, ctx([]))
    expect(p.issue).toMatchObject({ wave: 3, theme: '' })
    const n = planRestore({ issue: issue('HZ-13', { wave: 0 }), dependents: [], obstacleIds: [] }, ctx([]))
    expect(n.issue.wave).toBe(0)
  })

  it('nicio muchie care ar închide un ciclu', () => {
    // HZ-01 depindea de HZ-02, HZ-03 depindea de HZ-01; între timp HZ-02 → HZ-03.
    const p = planRestore(
      { issue: issue('HZ-01', { deps: ['HZ-02'] }), dependents: ['HZ-03'], obstacleIds: [] },
      ctx([issue('HZ-02', { deps: ['HZ-03'] }), issue('HZ-03')]),
    )
    expect(p.issue.deps).toEqual(['HZ-02'])
    expect(p.dependents).toEqual([])
  })
})
