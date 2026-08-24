import { describe, it, expect } from 'vitest'
import { dueTitle } from './DueChip'
import { NO_SCHEDULE } from '../lib/schedule'

const now = new Date(2026, 7, 24, 10, 0) // 24 august 2026, 10:00 local
const base = { ...NO_SCHEDULE, done: false }
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('dueTitle', () => {
  it('un tichet fără scadență n-are ce spune', () => {
    expect(dueTitle(base, now)).toBe('')
  })

  it('scadență cu oră: ziua completă, ora, și mementoul implicit', () => {
    const due = at(2026, 8, 26, 14, 30)
    expect(dueTitle({ ...base, dueAt: due, allDay: false, remindAt: due }, now))
      .toBe('26/08/2026 14:30 · memento la scadență')
  })

  it('scadență de zi întreagă, fără memento', () => {
    expect(dueTitle({ ...base, dueAt: at(2026, 8, 26), allDay: true }, now))
      .toBe('26/08/2026 · toată ziua')
  })

  it('memento cu 30 de minute înainte se numește pe nume', () => {
    const due = at(2026, 8, 26, 9, 0)
    const remind = at(2026, 8, 26, 8, 30)
    expect(dueTitle({ ...base, dueAt: due, allDay: false, remindAt: remind }, now))
      .toBe('26/08/2026 09:00 · memento 30 min înainte')
  })

  it('restanța se anunță prima — e ce vrei să vezi întâi', () => {
    expect(dueTitle({ ...base, dueAt: at(2026, 8, 20, 9, 0), allDay: false }, now))
      .toBe('Restanță · 20/08/2026 09:00')
  })

  it('bifat înseamnă nerestant, oricât de veche e scadența', () => {
    expect(dueTitle({ ...base, dueAt: at(2026, 8, 20, 9, 0), allDay: false, done: true }, now))
      .toBe('20/08/2026 09:00')
  })
})
