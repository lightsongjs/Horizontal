import { describe, it, expect } from 'vitest'
import { dueOut, isHexColor, localToUtc, normalizeTheme, parseDue } from './_api-lib'

describe('localToUtc (ora României)', () => {
  it('vara e UTC+3, iarna UTC+2', () => {
    expect(localToUtc(2026, 7, 15, 0, 0).toISOString()).toBe('2026-07-14T21:00:00.000Z')
    expect(localToUtc(2026, 12, 15, 0, 0).toISOString()).toBe('2026-12-14T22:00:00.000Z')
  })
  it('în ziua schimbării orei nimerește offsetul de după', () => {
    // 25 oct 2026: la 04:00 ora de vară devine 03:00. 12:00 e deja iarnă.
    expect(localToUtc(2026, 10, 25, 12, 0).toISOString()).toBe('2026-10-25T10:00:00.000Z')
  })
})

describe('parseDue', () => {
  it('o zi = toată ziua, la miezul nopții local, fără memento', () => {
    expect(parseDue('2026-10-24')).toEqual({ due_at: '2026-10-23T21:00:00.000Z', all_day: true, remind_at: null })
  })
  it('cu oră = la ora aceea, cu mementoul la scadență', () => {
    const at = '2026-10-24T12:30:00.000Z'
    const before = Date.parse('2026-10-20T00:00:00Z')
    expect(parseDue('2026-10-24 15:30', before)).toEqual({ due_at: at, all_day: false, remind_at: at })
    expect(parseDue('2026-10-24T15:30', before)).toEqual({ due_at: at, all_day: false, remind_at: at })
  })
  it('o oră deja trecută nu primește memento — ar suna pe loc pe toate dispozitivele', () => {
    const after = Date.parse('2026-10-25T00:00:00Z')
    expect(parseDue('2026-10-24 15:30', after)).toEqual({ due_at: '2026-10-24T12:30:00.000Z', all_day: false, remind_at: null })
  })
  it('null sau gol = fără scadență', () => {
    expect(parseDue(null)).toEqual({ due_at: null, all_day: true, remind_at: null })
    expect(parseDue('')).toEqual({ due_at: null, all_day: true, remind_at: null })
  })
  it('refuză ce nu e o dată reală', () => {
    for (const bad of ['2026-02-31', '24.10.2026', '2026-10-24 25:00', '2026-10-24 10:60', 5, true, 'mâine']) {
      expect(parseDue(bad)).toEqual({ error: 'invalid_due' })
    }
  })
})

describe('isHexColor / normalizeTheme / dueOut', () => {
  it('culoarea e #RRGGBB', () => {
    expect(isHexColor('#F06B1F')).toBe(true)
    expect(isHexColor('#f06b1f')).toBe(true)
    expect(isHexColor('F06B1F')).toBe(false)
    expect(isHexColor('#FFF')).toBe(false)
    expect(isHexColor(null)).toBe(false)
  })
  it('tema goală înseamnă fără temă', () => {
    expect(normalizeTheme('')).toEqual({ theme: null })
    expect(normalizeTheme(null)).toEqual({ theme: null })
    expect(normalizeTheme('auth')).toEqual({ theme: 'auth' })
    expect(normalizeTheme(3)).toEqual({ error: 'invalid_theme' })
  })
  it('dueOut are valori implicite stabile', () => {
    expect(dueOut({ due_at: null, all_day: null, urgent: null })).toEqual({ dueAt: null, allDay: true, urgent: false })
  })
})
