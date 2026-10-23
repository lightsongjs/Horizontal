import { describe, expect, it } from 'vitest'
import type { Issue, Theme, Wave } from './types'
import {
  compareRows, depWarning, edgeWave, gridColumns, gridGroups, naturalCompare, openCounts, stepWave, waveTitle,
} from './waveGrid'

const issue = (p: Partial<Issue> & { id: string }): Issue =>
  ({ projectId: 'p', title: p.id, desc: '', theme: '', wave: 1, deps: [], done: false, ...p }) as Issue
const wave = (number: number, position: number, name = `Val ${number}`, label = ''): Wave =>
  ({ projectId: 'p', number, name, label, position })
const theme = (key: string, name: string): Theme => ({ projectId: 'p', key, name, color: '#000' })

describe('naturalCompare', () => {
  it('pune „Pasul 2” înaintea lui „Pasul 10”', () => {
    expect(['Pasul 10: X', 'Pasul 2: Y', 'Identitate'].sort(naturalCompare)).toEqual(['Identitate', 'Pasul 2: Y', 'Pasul 10: X'])
  })
  it('nu ține cont de majuscule; ș e literă, după s (ordinea românească)', () => {
    expect(naturalCompare('identitate', 'Identitate')).toBe(0)
    expect(['Ședința', 'Setări', 'Tema'].sort(naturalCompare)).toEqual(['Setări', 'Ședința', 'Tema'])
  })
})

describe('gridColumns', () => {
  it('Notițele primele, apoi valurile după position, nu după număr', () => {
    const cols = gridColumns([wave(2, 1), wave(1, 2), wave(0, 0), wave(3, 3)])
    expect(cols.map((w) => w.number)).toEqual([0, 2, 1, 3])
  })
})

describe('gridGroups', () => {
  const themes = [theme('b', 'Pasul 10'), theme('a', 'Pasul 2'), theme('e', 'Goală')]
  const issues = [
    issue({ id: 'S-10', theme: 'a' }),
    issue({ id: 'S-2', theme: 'a' }),
    issue({ id: 'S-3', theme: 'b', done: true }),
    issue({ id: 'S-4' }),
    issue({ id: 'S-5', theme: 'stearsa' }),
    issue({ id: 'S-~abc', theme: 'a' }),
  ]

  it('teme în ordine naturală, rânduri după numărul din ID, provizoriile la coadă, „Fără temă” ultima', () => {
    const g = gridGroups(themes, issues, { filter: 'all', hideDone: false })
    expect(g.map((x) => [x.name, x.ids])).toEqual([
      ['Pasul 2', ['S-2', 'S-10', 'S-~abc']],
      ['Pasul 10', ['S-3']],
      ['Fără temă', ['S-4', 'S-5']],
    ])
  })

  it('cu bifatele ascunse, o temă rămasă goală nu se arată', () => {
    const g = gridGroups(themes, issues, { filter: 'all', hideDone: true })
    expect(g.map((x) => x.name)).toEqual(['Pasul 2', 'Fără temă'])
  })

  it('o temă aleasă se arată și goală, fără „Fără temă”', () => {
    expect(gridGroups(themes, issues, { filter: 'e', hideDone: false })).toEqual([
      { key: 'e', name: 'Goală', color: '#000', ids: [] },
    ])
  })
})

describe('stepWave / edgeWave', () => {
  const cols = gridColumns([wave(0, 0), wave(1, 1), wave(2, 2)])
  it('merge în ordinea coloanelor și se oprește la capete', () => {
    expect(stepWave(cols, 0, 1)).toBe(1)
    expect(stepWave(cols, 1, -1)).toBe(0)
    expect(stepWave(cols, 2, 1)).toBeNull()
    expect(stepWave(cols, 0, -1)).toBeNull()
    expect(stepWave(cols, 9, 1)).toBeNull()
  })
  it('0 = Notițe, $ = ultimul val', () => {
    expect(edgeWave(cols, 'first')).toBe(0)
    expect(edgeWave(cols, 'last')).toBe(2)
    expect(edgeWave([], 'last')).toBeNull()
  })
})

describe('depWarning', () => {
  // Valul 2 e reordonat ÎNAINTEA valului 1: ordinea e position, nu number.
  const cols = gridColumns([wave(0, 0), wave(2, 1), wave(1, 2)])
  const run = (it: Issue, others: Issue[]) =>
    depWarning(it, Object.fromEntries([it, ...others].map((x) => [x.id, x])), cols)

  it('dependența într-un val de după (după position)', () => {
    expect(run(issue({ id: 'A', wave: 2, deps: ['B'] }), [issue({ id: 'B', wave: 1 })])).toEqual({ id: 'B', wave: 1 })
  })
  it('dependența în același val sau înainte: nimic', () => {
    expect(run(issue({ id: 'A', wave: 1, deps: ['B'] }), [issue({ id: 'B', wave: 2 })])).toBeNull()
    expect(run(issue({ id: 'A', wave: 1, deps: ['B'] }), [issue({ id: 'B', wave: 1 })])).toBeNull()
  })
  it('dependența încă în Notițe avertizează', () => {
    expect(run(issue({ id: 'A', wave: 2, deps: ['B'] }), [issue({ id: 'B', wave: 0 })])).toEqual({ id: 'B', wave: 0 })
  })
  it('tichetul din Notițe, dependența bifată sau din alt proiect: nimic', () => {
    expect(run(issue({ id: 'A', wave: 0, deps: ['B'] }), [issue({ id: 'B', wave: 1 })])).toBeNull()
    expect(run(issue({ id: 'A', wave: 2, deps: ['B'] }), [issue({ id: 'B', wave: 1, done: true })])).toBeNull()
    expect(run(issue({ id: 'A', wave: 2, deps: ['B'] }), [issue({ id: 'B', wave: 1, projectId: 'q' })])).toBeNull()
    expect(run(issue({ id: 'A', wave: 2, deps: ['Z'] }), [])).toBeNull()
  })
})

describe('openCounts / compareRows / waveTitle', () => {
  it('numără doar deschisele, pe val', () => {
    const m = openCounts([issue({ id: 'A', wave: 1 }), issue({ id: 'B', wave: 1, done: true }), issue({ id: 'C', wave: 0 })])
    expect([...m]).toEqual([[1, 1], [0, 1]])
  })
  it('HZ-9 înaintea lui HZ-10', () => {
    expect([issue({ id: 'HZ-10' }), issue({ id: 'HZ-9' })].sort(compareRows).map((i) => i.id)).toEqual(['HZ-9', 'HZ-10'])
  })
  it('valul 0 e „Notițe” (sau eticheta lui), restul numele', () => {
    expect(waveTitle(wave(0, 0, 'Scratchpad'))).toBe('Notițe')
    expect(waveTitle(wave(0, 0, 'Scratchpad', 'Idei'))).toBe('Idei')
    expect(waveTitle(wave(1, 1, 'Val 1', 'MVP'))).toBe('Val 1')
  })
})
