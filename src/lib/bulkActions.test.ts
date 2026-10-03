import { describe, expect, it } from 'vitest'
import {
  bulkNotice, canClearDate, countRecurring, datePatch, deleteNotice, nextMonday, planBulk, snapshot, urgentTarget,
} from './bulkActions'
import { applyIssuePatch } from './issuePatch'
import type { Issue } from './types'

// Ora locală, nu UTC: regulile sunt pe ziua locală, iar fixture-urile trebuie
// să treacă în orice fus în care rulează suita.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const iso = (y: number, mo: number, d: number, h = 0, mi = 0) => at(y, mo, d, h, mi).toISOString()

// Sâmbătă, 3 octombrie 2026, 15:00.
const NOW = at(2026, 10, 3, 15)

const base: Issue = {
  id: 'HZ-01', projectId: 'p', title: 't', desc: '', theme: '', wave: 1, deps: [],
  done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null,
}
const timed: Issue = { ...base, id: 'HZ-02', dueAt: iso(2026, 10, 1, 9, 30), allDay: false, remindAt: iso(2026, 10, 1, 9, 0) }
const allDay: Issue = { ...base, id: 'HZ-03', dueAt: iso(2026, 10, 2), allDay: true }
const recurring: Issue = { ...timed, id: 'HZ-04', rrule: 'FREQ=DAILY' }

describe('nextMonday', () => {
  it('sâmbătă → luni peste două zile', () => expect(nextMonday(NOW)).toEqual(at(2026, 10, 5)))
  it('luni → luni peste o săptămână', () => expect(nextMonday(at(2026, 10, 5, 8))).toEqual(at(2026, 10, 12)))
  it('duminică → mâine', () => expect(nextMonday(at(2026, 10, 4, 8))).toEqual(at(2026, 10, 5)))
})

describe('datePatch', () => {
  it('Mâine păstrează ora și mută mementoul cu aceeași distanță', () => {
    expect(datePatch(timed, { kind: 'tomorrow' }, NOW)).toEqual({
      dueAt: iso(2026, 10, 4, 9, 30), remindAt: iso(2026, 10, 4, 9, 0),
    })
  })
  it('Mâine e ziua calendaristică următoare, chiar dacă e duminică', () => {
    expect(datePatch(allDay, { kind: 'tomorrow' }, NOW)).toEqual({ dueAt: iso(2026, 10, 4) })
  })
  it('Azi pe o restanță păstrează ora ei', () => {
    expect(datePatch(timed, { kind: 'today' }, NOW).dueAt).toBe(iso(2026, 10, 3, 9, 30))
  })
  it('+1 zi e relativ la scadența proprie', () => {
    expect(datePatch(timed, { kind: 'plus1' }, NOW).dueAt).toBe(iso(2026, 10, 2, 9, 30))
    expect(datePatch(allDay, { kind: 'plus1' }, NOW).dueAt).toBe(iso(2026, 10, 3))
  })
  it('+1 zi fără scadență → mâine, zi întreagă', () => {
    expect(datePatch(base, { kind: 'plus1' }, NOW)).toEqual({ dueAt: iso(2026, 10, 4) })
  })
  it('Luni viitoare', () => {
    expect(datePatch(timed, { kind: 'nextMonday' }, NOW).dueAt).toBe(iso(2026, 10, 5, 9, 30))
  })
  it('Fără dată golește și mementoul', () => {
    expect(datePatch(timed, { kind: 'none' }, NOW)).toEqual({ dueAt: null, allDay: true, remindAt: null })
    expect(datePatch(base, { kind: 'none' }, NOW)).toEqual({})
  })
  it('Alege fără oră păstrează ora fiecăreia', () => {
    expect(datePatch(timed, { kind: 'pick', date: at(2026, 10, 9), time: null }, NOW).dueAt).toBe(iso(2026, 10, 9, 9, 30))
    expect(datePatch(allDay, { kind: 'pick', date: at(2026, 10, 9), time: null }, NOW)).toEqual({ dueAt: iso(2026, 10, 9) })
  })
  it('Alege cu oră face sarcina cu oră', () => {
    expect(datePatch(allDay, { kind: 'pick', date: at(2026, 10, 9), time: '14:15' }, NOW)).toEqual({
      dueAt: iso(2026, 10, 9, 14, 15), allDay: false,
    })
  })
  it('nu atinge recurența — se mută doar apariția curentă', () => {
    expect('rrule' in datePatch(recurring, { kind: 'tomorrow' }, NOW)).toBe(false)
  })
  it('o mutare pe aceeași zi nu scrie nimic', () => {
    const todayTask = { ...timed, dueAt: iso(2026, 10, 3, 9, 30), remindAt: null }
    expect(datePatch(todayTask, { kind: 'today' }, NOW)).toEqual({})
  })
})

describe('snapshot', () => {
  it('ține doar câmpurile atinse', () => {
    expect(snapshot(timed, { dueAt: 'x', remindAt: 'y' })).toEqual({ dueAt: timed.dueAt, remindAt: timed.remindAt })
  })
  it('bifarea unei recurente ține și scadența, ca anularea să întoarcă saltul', () => {
    expect(snapshot(recurring, { done: true })).toEqual({ done: false, dueAt: recurring.dueAt, remindAt: recurring.remindAt })
  })
  it('anularea unei bife recurente nu mai sare (false → false)', () => {
    const jumped = applyIssuePatch(recurring, { done: true }, NOW)
    expect(jumped.dueAt).not.toBe(recurring.dueAt)
    const undone = applyIssuePatch(jumped, snapshot(recurring, { done: true }), NOW)
    expect(undone).toMatchObject({ done: false, dueAt: recurring.dueAt, remindAt: recurring.remindAt })
  })
})

describe('planBulk', () => {
  const ro = (p: string) => p !== 'ro'
  it('sare proiectele doar-citire și ce n-ar schimba nimic', () => {
    const plan = planBulk(
      [timed, { ...allDay, projectId: 'ro' }, { ...base, id: 'HZ-09', done: true }],
      { kind: 'done' }, ro, NOW,
    )
    expect(plan.readOnly).toBe(1)
    expect(plan.writes.map((w) => w.id)).toEqual(['HZ-02'])
    expect(plan.writes[0]).toEqual({ id: 'HZ-02', patch: { done: true }, prev: { done: false } })
  })
  it('urgent: se pune dacă măcar una nu e', () => {
    expect(urgentTarget([timed, { ...allDay, urgent: true }])).toBe(true)
    expect(urgentTarget([{ ...timed, urgent: true }])).toBe(false)
  })
  it('pasarea scrie doar unde se schimbă omul', () => {
    const plan = planBulk([timed, { ...allDay, assigneeId: 'a1' }], { kind: 'assign', assigneeId: 'a1' }, () => true, NOW)
    expect(plan.writes.map((w) => w.id)).toEqual(['HZ-02'])
  })
})

describe('recurente în selecție', () => {
  it('numără și oprește „Fără dată"', () => {
    expect(countRecurring([timed, recurring])).toBe(1)
    expect(canClearDate([timed, recurring])).toBe(false)
    expect(canClearDate([timed])).toBe(true)
  })
})

describe('toast', () => {
  it('o singură sarcină', () => {
    expect(bulkNotice({ kind: 'date', preset: { kind: 'tomorrow' } }, 1, 0)).toBe('Mutat pe mâine')
  })
  it('mai multe, cu sărite', () => {
    expect(bulkNotice({ kind: 'date', preset: { kind: 'today' } }, 3, 2)).toBe('3 mutate pe azi · 2 sărite (doar citire)')
  })
  it('gata, cu salturi', () => {
    expect(bulkNotice({ kind: 'done' }, 5, 0, 2)).toBe('5 gata · 2 au sărit la următoarea dată')
  })
  it('ștergere', () => {
    expect(deleteNotice(3, 1)).toBe('3 șterse · 1 sărită (doar citire)')
    expect(deleteNotice(1, 0)).toBe('Șters')
  })
})
