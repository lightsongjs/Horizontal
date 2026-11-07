import { describe, it, expect } from 'vitest'
import { BACKLOG, duplicateSprint, placeSprint, sprintDateOf, sprintName } from './sprints'

const w = (number: number, name: string, position: number, label = '') => ({ number, name, label, position })

describe('sprintName: data → „dd/mm/yy”', () => {
  it('19 noiembrie 2026 → 19/11/26', () => {
    expect(sprintName('2026-11-19')).toBe('19/11/26')
    expect(sprintName('2027-01-05')).toBe('05/01/27')
  })
  it('o dată invalidă → null', () => {
    expect(sprintName('2026-02-30')).toBeNull()
    expect(sprintName('19.11.2026')).toBeNull()
    expect(sprintName('')).toBeNull()
  })
})

describe('sprintDateOf: data din numele sau eticheta sprintului', () => {
  it('citește „dd/mm/yy” din nume, apoi din etichetă', () => {
    expect(sprintDateOf({ name: '19/11/26', label: '19/11/26' })).toBe('2026-11-19')
    expect(sprintDateOf({ name: 'IV', label: '09/11/26' })).toBe('2026-11-09')
  })
  it('Backlog, cifre romane și „RD 09.11.2026” nu sunt date de sprint', () => {
    expect(sprintDateOf({ name: BACKLOG, label: '' })).toBeNull()
    expect(sprintDateOf({ name: 'II', label: 'Lansare' })).toBeNull()
    expect(sprintDateOf({ name: 'RD 09.11.2026', label: '' })).toBeNull()
    expect(sprintDateOf({ name: '31/02/26', label: '' })).toBeNull()
  })
})

describe('placeSprint: sprinturile cu dată stau în ordinea datei', () => {
  const base = [w(0, 'Scratchpad', 0), w(1, BACKLOG, 1)]

  it('primul sprint cu dată merge la coadă, după Backlog', () => {
    expect(placeSprint(base, '2026-11-19')).toEqual({ position: 2, shifts: [] })
  })
  it('unul mai târziu decât toate merge la coadă', () => {
    const ws = [...base, w(2, '12/11/26', 2), w(3, '19/11/26', 3)]
    expect(placeSprint(ws, '2026-11-26')).toEqual({ position: 4, shifts: [] })
  })
  it('unul la mijloc ia locul primului mai târziu, iar cele de după se dau cu unul', () => {
    const ws = [...base, w(2, '12/11/26', 2), w(3, '26/11/26', 3), w(4, 'IV', 4, 'Lansare')]
    expect(placeSprint(ws, '2026-11-19')).toEqual({
      position: 3,
      shifts: [{ number: 4, position: 5 }, { number: 3, position: 4 }],
    })
  })
  it('anul contează: 05/01/27 vine după 19/11/26', () => {
    const ws = [...base, w(2, '05/01/27', 2)]
    expect(placeSprint(ws, '2026-11-19')).toEqual({ position: 2, shifts: [{ number: 2, position: 3 }] })
  })
  it('cu Backlog-ul la coadă (ms), cel mai târziu intră lângă ultimul sprint cu dată, înaintea Backlog-ului', () => {
    const ws = [w(0, 'Scratchpad', 0), w(6, '11/11/26', 1), w(7, BACKLOG, 2)]
    expect(placeSprint(ws, '2026-11-19')).toEqual({ position: 2, shifts: [{ number: 7, position: 3 }] })
  })
})

describe('duplicateSprint', () => {
  it('găsește sprintul care are deja data', () => {
    const ws = [w(1, BACKLOG, 1), w(2, '19/11/26', 2)]
    expect(duplicateSprint(ws, '2026-11-19')?.number).toBe(2)
    expect(duplicateSprint(ws, '2026-11-20')).toBeNull()
  })
})
