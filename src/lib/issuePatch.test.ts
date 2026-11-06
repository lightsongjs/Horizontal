import { describe, expect, it } from 'vitest'
import { applyIssuePatch, moveDue, planPatch } from './issuePatch'
import { ADVANCE_FIXTURES } from './recurrence.fixtures'
import { reminderMutation } from './reminderAction'
import type { Issue } from './types'

const base: Issue = {
  id: 'HZ-01', projectId: 'p', title: 'bea apă', desc: '', theme: '', wave: 1, deps: [],
  done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: '2026-09-28T07:00:00.000Z', allDay: false, remindAt: '2026-09-28T06:50:00.000Z',
  rrule: 'FREQ=DAILY', pingEvery: null, pinnedAt: null,
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

// Fixtures comune cu trigger-ul SQL (`npm run test:recurrence-sql`).
describe('applyIssuePatch — saltul cu baza amânării', () => {
  for (const f of ADVANCE_FIXTURES) {
    it(f.name, () => {
      const issue: Issue = { ...base, rrule: f.rrule, dueAt: f.due, remindAt: f.remind, snoozedFrom: f.snoozedFrom }
      const out = applyIssuePatch(issue, { done: true }, new Date(f.now))
      expect({ due: out.dueAt, remind: out.remindAt }).toEqual(f.want)
      expect(out.done).toBe(false)
      expect(out.snoozedFrom ?? null).toBeNull()
    })
  }
})

describe('ROUTIN-12, cap-coadă: amânări repetate prin `reminderMutation`, apoi bifă', () => {
  it('mâine sună la ora planificată, iar apariția nouă nu mai e amânată', () => {
    const due = new Date(2026, 10, 3, 8).toISOString()
    let issue: Issue = { ...base, rrule: 'FREQ=DAILY', dueAt: due, remindAt: due, snoozedFrom: null }
    for (const at of [new Date(2026, 10, 3, 8, 0, 39), new Date(2026, 10, 3, 9, 0, 39), new Date(2026, 10, 3, 11, 45, 39)]) {
      const m = reminderMutation('snooze', issue, at, 15)
      if (m.kind !== 'patch') throw new Error(m.kind)
      issue = applyIssuePatch(issue, planPatch(issue, m.patch), at)
    }
    expect(issue.remindAt).toBe(new Date(2026, 10, 3, 12, 0, 39).toISOString())
    expect(issue.snoozedFrom).toBe(due)
    const out = applyIssuePatch(issue, { done: true }, new Date(2026, 10, 3, 12, 10))
    expect(out.dueAt).toBe(new Date(2026, 10, 4, 8).toISOString())
    expect(out.remindAt).toBe(new Date(2026, 10, 4, 8).toISOString())
    expect(out.snoozedFrom).toBeNull()
  })
})

describe('moveDue', () => {
  it('pe o sarcină amânată duce decalajul planificat, nu ora amânării', () => {
    const out = moveDue({ dueAt: '2026-11-03T06:00:00.000Z', remindAt: '2026-11-03T10:00:39.000Z', snoozedFrom: '2026-11-03T05:30:00.000Z' }, '2026-11-04T06:00:00.000Z')
    expect(out).toEqual({ dueAt: '2026-11-04T06:00:00.000Z', remindAt: '2026-11-04T05:30:00.000Z' })
  })
})

describe('planPatch — o scriere de plan golește baza amânării', () => {
  const cur = { dueAt: '2026-11-03T06:00:00.000Z', remindAt: '2026-11-03T10:00:39.000Z' }
  it('mementoul schimbat din formular → snoozedFrom: null', () => {
    expect(planPatch(cur, { remindAt: '2026-11-03T05:30:00.000Z' })).toEqual({ remindAt: '2026-11-03T05:30:00.000Z', snoozedFrom: null })
  })
  it('scadența mutată → snoozedFrom: null', () => {
    expect(planPatch(cur, { dueAt: '2026-11-04T06:00:00.000Z' })).toEqual({ dueAt: '2026-11-04T06:00:00.000Z', snoozedFrom: null })
  })
  it('formularul retrimite aceeași oră (alt format ISO) → baza rămâne', () => {
    const p = { title: 'x', dueAt: '2026-11-03T06:00:00+00:00', remindAt: '2026-11-03T10:00:39.000Z' }
    expect(planPatch(cur, p)).toBe(p)
  })
  it('o amânare își aduce singură baza → neatinsă', () => {
    const p = { remindAt: '2026-11-03T10:15:39.000Z', snoozedFrom: '2026-11-03T06:00:00.000Z' }
    expect(planPatch(cur, p)).toBe(p)
  })
  it('fără memento și fără scadență în patch → neatins', () => {
    const p = { title: 'x', done: true }
    expect(planPatch(cur, p)).toBe(p)
  })
  it('tichet necunoscut → golește', () => {
    expect(planPatch(undefined, { remindAt: null })).toEqual({ remindAt: null, snoozedFrom: null })
  })
})
