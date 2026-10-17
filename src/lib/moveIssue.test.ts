import { describe, expect, it } from 'vitest'
import { moveBlock, moveBlockMessage, movedIssue, movedNotice, moveTargets, noWriteMessage } from './moveIssue'
import FIXTURES from './issueId.fixtures.json'
import type { Issue } from './types'

const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id, projectId: 'hz', title: id, desc: '', theme: 'ui', wave: 2, deps: [], done: false, selectors: [], scenarios: [],
  assigneeId: 'a1', createdBy: 'u1', createdAt: '2026-10-01T00:00:00.000Z', urgent: true,
  dueAt: '2026-10-20T07:00:00.000Z', allDay: false, remindAt: null, rrule: 'FREQ=WEEKLY', pinnedAt: null, ...extra,
})

describe('moveBlock', () => {
  it('un tichet liber se poate muta', () => {
    expect(moveBlock(issue('HZ-12'), [issue('HZ-12'), issue('HZ-13')], [])).toBeNull()
  })
  it('refuză ID-ul provizoriu', () => {
    expect(moveBlock(issue('HZ-~ab12cd'), [], [])).toEqual({ kind: 'temp' })
  })
  it('refuză dependențele în ambele sensuri, sortate ca în SQL', () => {
    const me = issue('HZ-12', { deps: ['HZ-10'] })
    const all = [me, issue('HZ-3', { deps: ['HZ-12'] }), issue('HZ-10'), issue('HZ-9', { deps: ['HZ-12', 'HZ-1'] })]
    expect(moveBlock(me, all, [])).toEqual({ kind: 'deps', ids: ['HZ-3', 'HZ-9', 'HZ-10'] })
  })
  it('refuză doar cu ceva care depinde de el', () => {
    const me = issue('HZ-12')
    expect(moveBlock(me, [me, issue('HZ-13', { deps: ['HZ-12'] })], [])).toEqual({ kind: 'deps', ids: ['HZ-13'] })
  })
  it('refuză un tichet legat de un obstacol', () => {
    expect(moveBlock(issue('HZ-12'), [], [{ obstacleId: 'HZ-O01', issueId: 'HZ-12' }])).toEqual({ kind: 'obstacle' })
    expect(moveBlock(issue('HZ-12'), [], [{ obstacleId: 'HZ-O01', issueId: 'HZ-13' }])).toBeNull()
  })
})

describe('mesajele (identice cu SQL-ul)', () => {
  it('dependențe', () => {
    expect(moveBlockMessage('HZ-12', { kind: 'deps', ids: ['HZ-3', 'HZ-9'] }))
      .toBe('Nu se poate muta HZ-12: are dependențe (HZ-3, HZ-9). Scoate-le întâi.')
  })
  it('obstacol și drept', () => {
    expect(moveBlockMessage('HZ-12', { kind: 'obstacle' })).toBe('Nu se poate muta HZ-12: e legat de un obstacol. Scoate-l întâi.')
    expect(noWriteMessage('X')).toBe('Nu ai drept de editare în proiectul „X".')
  })
  it('confirmarea', () => {
    expect(movedNotice('Apologetica', 'APO-07')).toBe('Mutat în „Apologetica" ca APO-07.')
  })
})

describe('moveTargets', () => {
  const projects = [
    { id: 'apo', name: 'Apologetica' },
    { id: 'hz', name: 'Horizontal' },
    { id: 'ro', name: 'Doar citire' },
    { id: 'd', name: 'Inbox' },
  ]
  it('fără sursă, fără proiectele fără drept, Inbox primul', () => {
    expect(moveTargets(projects, 'hz', (id) => id !== 'ro').map((p) => p.id)).toEqual(['d', 'apo'])
  })
  it('din Inbox, Inbox nu se oferă', () => {
    expect(moveTargets(projects, 'd', () => true).map((p) => p.id)).toEqual(['apo', 'hz', 'ro'])
  })
})

describe('movedIssue', () => {
  const target = { id: 'apo', prefix: 'APO', currentWave: 3 }
  it('ID nou, valul activ al țintei, fără temă, restul neschimbat', () => {
    const before = issue('HZ-12')
    const after = movedIssue(before, target, ['APO-01', 'APO-07'], true)
    expect(after).toEqual({ ...before, id: 'APO-08', projectId: 'apo', wave: 3, theme: '' })
  })
  it('persoana se scoate când nu poate vedea ținta', () => {
    expect(movedIssue(issue('HZ-12'), target, [], false).assigneeId).toBeNull()
  })
  // Aceleași fixtures ca `nextIssueId` și ca `npm run test:move-sql`.
  it.each(FIXTURES)('numerotare: $name', ({ prefix, existing, want }) => {
    expect(movedIssue(issue('SRC-01'), { id: 'dst', prefix, currentWave: 1 }, existing, true).id).toBe(want)
  })
})
