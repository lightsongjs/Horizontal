import { describe, expect, it } from 'vitest'
import { applyIssuePatch } from './issuePatch'
import type { Issue } from './types'

const base: Issue = {
  id: 'HZ-01', projectId: 'p', title: 'bea apă', desc: '', theme: '', wave: 1, deps: [],
  done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: '2026-09-28T07:00:00.000Z', allDay: false, remindAt: '2026-09-28T06:50:00.000Z',
  rrule: 'FREQ=DAILY',
}

describe('applyIssuePatch', () => {
  it('aplică un patch simplu fără să modifice intrarea', () => {
    const out = applyIssuePatch(base, { title: 'bea ceai' }, new Date('2026-10-01T09:00:00Z'))
    expect(out.title).toBe('bea ceai')
    expect(base.title).toBe('bea apă')
  })

  it('bifarea unei recurente sare din ziua curentă și păstrează decalajul mementoului', () => {
    const out = applyIssuePatch(base, { done: true }, new Date('2026-10-01T09:00:00Z'))
    expect(out.done).toBe(false)
    expect(new Date(out.dueAt!).getTime()).toBeGreaterThan(new Date('2026-10-01T09:00:00Z').getTime())
    expect(new Date(out.dueAt!).getTime() - new Date(out.remindAt!).getTime()).toBe(10 * 60_000)
  })

  it('a doua bifare pe un tichet deja bifat nu mai sare', () => {
    const out = applyIssuePatch({ ...base, done: true }, { done: true }, new Date('2026-10-01T09:00:00Z'))
    expect(out.dueAt).toBe(base.dueAt)
    expect(out.done).toBe(true)
  })

  it('fără rrule, bifarea doar bifează', () => {
    const out = applyIssuePatch({ ...base, rrule: null }, { done: true }, new Date())
    expect(out.done).toBe(true)
    expect(out.dueAt).toBe(base.dueAt)
  })
})
