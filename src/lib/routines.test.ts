import { describe, expect, it } from 'vitest'
import { isDormant, nextReveal, revealAt, routineProjectIds } from './routines'

const now = new Date('2026-10-06T08:00:00.000Z')
const rut = new Set(['rut'])
const it0 = { projectId: 'rut', done: false, dueAt: '2026-10-06T18:00:00.000Z', remindAt: null as string | null }

describe('rutine', () => {
  it('se vede de la memento, altfel de la scadență', () => {
    expect(revealAt({ dueAt: 'D', remindAt: 'R' })).toBe('R')
    expect(revealAt({ dueAt: 'D', remindAt: null })).toBe('D')
  })

  it('ascunsă doar într-un proiect de rutine, nebifată, înainte de oră', () => {
    expect(isDormant(it0, rut, now)).toBe(true)
    expect(isDormant({ ...it0, projectId: 'p1' }, rut, now)).toBe(false)
    expect(isDormant({ ...it0, done: true }, rut, now)).toBe(false)
    expect(isDormant({ ...it0, remindAt: '2026-10-06T07:59:00.000Z' }, rut, now)).toBe(false)   // a sunat, n-a fost bifată
    expect(isDormant({ ...it0, dueAt: null }, rut, now)).toBe(false)
  })

  it('următoarea ieșire e cea mai apropiată dintre cele ascunse', () => {
    const at = nextReveal([
      it0,
      { ...it0, remindAt: '2026-10-06T09:00:00.000Z' },
      { ...it0, remindAt: '2026-10-06T07:00:00.000Z' },   // deja vizibilă
      { ...it0, projectId: 'p1', remindAt: '2026-10-06T08:30:00.000Z' },
    ], rut, now)
    expect(at).toBe(Date.parse('2026-10-06T09:00:00.000Z'))
    expect(nextReveal([], rut, now)).toBeNull()
  })

  it('proiectele de rutine', () => {
    expect([...routineProjectIds([{ id: 'a' }, { id: 'b', remindersOnly: true }, { id: 'c', remindersOnly: false }])]).toEqual(['b'])
  })
})
