import { describe, expect, it } from 'vitest'
import { cancelTempIssues, deriveDue, echoIssue, overlay, remapOp, type QueuedOp } from './ops'
import type { Issue, Project } from '../../lib/types'

const now = new Date('2026-10-02T09:00:00Z')
const proj: Project = { id: 'p', name: 'P', description: '', prefix: 'HZ', currentWave: 2, accent: '#000', type: 'personal' }
const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [],
  scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null, ...over,
})
const q = (seq: number, op: QueuedOp['op']): QueuedOp => ({ seq, op, at: now.toISOString() })

describe('echoIssue', () => {
  it('construiește tichetul local cu valul curent al proiectului', () => {
    const e = echoIssue({ projectId: 'p', title: 'sună la bancă' }, 'HZ-~x', proj, 'u1', now)
    expect(e).toMatchObject({ id: 'HZ-~x', title: 'sună la bancă', wave: 2, done: false, createdBy: 'u1', deps: [] })
  })
})

describe('overlay', () => {
  it('adaugă creările, aplică patch-urile, scoate ștergerile', () => {
    const base = [mk('HZ-01'), mk('HZ-02', { deps: ['HZ-01'] })]
    const out = overlay(base, [
      { kind: 'createIssue', tempId: 'HZ-~a', input: { projectId: 'p', title: 'n' }, echo: mk('HZ-~a') },
      { kind: 'updateIssue', id: 'HZ-02', patch: { title: 'nou' } },
      { kind: 'deleteIssues', ids: ['HZ-01'] },
    ], now)
    expect(out.map((i) => i.id)).toEqual(['HZ-02', 'HZ-~a'])
    expect(out[0]).toMatchObject({ title: 'nou', deps: [] })
  })
  it('o bifă pe o recurentă rămâne sărită peste o bază veche (refresh înainte de sincronizare)', () => {
    const base = [mk('HZ-01', { rrule: 'FREQ=DAILY', dueAt: '2026-09-28T07:00:00.000Z', allDay: false })]
    const out = overlay(base, [{ kind: 'updateIssue', id: 'HZ-01', patch: { done: true } }], now)
    expect(out[0].done).toBe(false)
    expect(new Date(out[0].dueAt!).getTime()).toBeGreaterThan(now.getTime())
  })
  it('nu modifică baza', () => {
    const base = [mk('HZ-01')]
    overlay(base, [{ kind: 'updateIssue', id: 'HZ-01', patch: { title: 'x' } }], now)
    expect(base[0].title).toBe('HZ-01')
  })
})

describe('remapOp', () => {
  it('rescrie ID-ul provizoriu peste tot unde apare', () => {
    expect(remapOp({ kind: 'updateIssue', id: 'HZ-~a', patch: { deps: ['HZ-~a', 'HZ-01'] } }, 'HZ-~a', 'HZ-13'))
      .toEqual({ kind: 'updateIssue', id: 'HZ-13', patch: { deps: ['HZ-13', 'HZ-01'] } })
    const c = remapOp({ kind: 'createIssue', tempId: 'HZ-~b', input: { projectId: 'p', title: 't', deps: ['HZ-~a'] }, echo: mk('HZ-~b', { deps: ['HZ-~a'] }) }, 'HZ-~a', 'HZ-13')
    expect(c.kind === 'createIssue' && c.input.deps).toEqual(['HZ-13'])
    expect(c.kind === 'createIssue' && c.echo.deps).toEqual(['HZ-13'])
    expect(remapOp({ kind: 'deleteIssues', ids: ['HZ-~a'] }, 'HZ-~a', 'HZ-13')).toEqual({ kind: 'deleteIssues', ids: ['HZ-13'] })
    expect(remapOp({ kind: 'markSeen', issueId: 'HZ-~a' }, 'HZ-~a', 'HZ-13')).toEqual({ kind: 'markSeen', issueId: 'HZ-13' })
  })
})

describe('cancelTempIssues', () => {
  it('ștergerea unui tichet netrimis anulează crearea și tot ce-l privește, fără să plece nimic', () => {
    const queued = [
      q(1, { kind: 'createIssue', tempId: 'HZ-~a', input: { projectId: 'p', title: 'a' }, echo: mk('HZ-~a') }),
      q(2, { kind: 'updateIssue', id: 'HZ-~a', patch: { title: 'b' } }),
      q(3, { kind: 'updateIssue', id: 'HZ-02', patch: { deps: ['HZ-~a', 'HZ-01'] } }),
      q(4, { kind: 'markSeen', issueId: 'HZ-~a' }),
    ]
    const r = cancelTempIssues(queued, ['HZ-~a'])
    expect(r.remove).toEqual([1, 2, 4])
    expect(r.rewrite).toEqual([q(3, { kind: 'updateIssue', id: 'HZ-02', patch: { deps: ['HZ-01'] } })])
  })
})

describe('deriveDue', () => {
  it('aceeași regulă ca serverul: nefinalizatele fără limită în jos, bifatele doar recente', () => {
    const issues = [
      mk('A', { dueAt: '2026-08-01T07:00:00+00:00' }),
      mk('B', { dueAt: '2026-08-01T07:00:00.000Z', done: true }),
      mk('C', { dueAt: '2026-10-02T07:00:00.000Z', done: true }),
      mk('D', { dueAt: '2026-12-01T07:00:00.000Z' }),
      mk('E'),
    ]
    const out = deriveDue(issues, { to: '2026-10-09T21:00:00.000Z', doneFrom: '2026-10-01T21:00:00.000Z' })
    expect(out.map((i) => i.id)).toEqual(['A', 'C'])
  })
})
