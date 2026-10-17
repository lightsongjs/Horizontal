import { describe, expect, it } from 'vitest'
import { first, last, matching, neighborAfterRemove, nextMatch, rangeBetween, step, stepGroup, type CursorRow } from './cursor'

// Ca „Azi": Fixate (1), Restanțe (2), Azi (3).
const ROWS: CursorRow[] = [
  { id: 'P1', group: 'pin' },
  { id: 'R1', group: 'over' },
  { id: 'R2', group: 'over' },
  { id: 'A1', group: 'today' },
  { id: 'A2', group: 'today' },
  { id: 'A3', group: 'today' },
]

describe('step', () => {
  const cases: [string, string | null, 1 | -1, number, string | null][] = [
    ['fără cursor, j alege primul rând', null, 1, 1, 'P1'],
    ['fără cursor, k alege ultimul', null, -1, 1, 'A3'],
    ['j coboară un rând', 'P1', 1, 1, 'R1'],
    ['j trece granița de grup', 'R2', 1, 1, 'A1'],
    ['k urcă un rând', 'A1', -1, 1, 'R2'],
    ['5j sare cinci', 'P1', 1, 5, 'A3'],
    ['numărătoarea se oprește la capăt', 'R1', 1, 99, 'A3'],
    ['k pe primul rămâne', 'P1', -1, 1, 'P1'],
    ['cursor ieșit din listă: pornește de la capăt', 'XX', 1, 1, 'P1'],
  ]
  for (const [name, cur, d, n, want] of cases) it(name, () => expect(step(ROWS, cur, d, n)).toBe(want))
  it('listă goală → null', () => expect(step([], 'P1', 1)).toBeNull())
})

describe('stepGroup', () => {
  const cases: [string, string | null, 1 | -1, number, string | null][] = [
    ['J din mijlocul restanțelor → primul din Azi', 'R2', 1, 1, 'A1'],
    ['J pe ultimul grup rămâne pe capul lui', 'A2', 1, 1, 'A1'],
    ['K de pe capul grupului → capul grupului anterior', 'A1', -1, 1, 'R1'],
    ['K din mijlocul grupului → capul grupului propriu', 'A3', -1, 1, 'A1'],
    ['2K din mijloc → capul grupului anterior', 'A3', -1, 2, 'R1'],
    ['2J sare două grupuri', 'P1', 1, 2, 'A1'],
    ['fără cursor, J → primul grup', null, 1, 1, 'P1'],
  ]
  for (const [name, cur, d, n, want] of cases) it(name, () => expect(stepGroup(ROWS, cur, d, n)).toBe(want))
})

describe('first / last', () => {
  it('capetele', () => {
    expect(first(ROWS)).toBe('P1')
    expect(last(ROWS)).toBe('A3')
    expect(first([])).toBeNull()
    expect(last([])).toBeNull()
  })
})

describe('neighborAfterRemove', () => {
  const without = (...ids: string[]) => ROWS.filter((r) => !ids.includes(r.id))
  const cases: [string, CursorRow[], string | null, string | null][] = [
    ['rândul de sub cel ieșit', without('R2'), 'R2', 'A1'],
    ['ultimul ieșit → cel de deasupra', without('A3'), 'A3', 'A2'],
    ['câteva ieșite → primul de dedesubt care a rămas', without('R1', 'R2', 'A1'), 'R1', 'A2'],
    ['cursorul încă pe ecran rămâne', without('A3'), 'R1', 'R1'],
    ['fără cursor → primul', without('A3'), null, 'P1'],
    ['tot a ieșit → null', [], 'A1', null],
  ]
  for (const [name, after, cur, want] of cases) it(name, () => expect(neighborAfterRemove(ROWS, after, cur)).toBe(want))
})

describe('rangeBetween', () => {
  it('în ambele sensuri, inclusiv capetele', () => {
    expect(rangeBetween(ROWS, 'R1', 'A1')).toEqual(['R1', 'R2', 'A1'])
    expect(rangeBetween(ROWS, 'A1', 'R1')).toEqual(['R1', 'R2', 'A1'])
    expect(rangeBetween(ROWS, 'A2', 'A2')).toEqual(['A2'])
  })
  it('o ancoră ieșită din listă → doar cursorul', () => {
    expect(rangeBetween(ROWS, 'XX', 'A2')).toEqual(['A2'])
    expect(rangeBetween(ROWS, null, null)).toEqual([])
  })
})

describe('matching / nextMatch', () => {
  const T = ROWS.map((r, i) => ({ ...r, title: ['Ședință', 'Sună la bancă', 'Plătește', 'Ședința de luni', 'Bancă', 'Altceva'][i] }))
  it('fără diacritice, fără majuscule', () => {
    expect(matching(T, 'sedint')).toEqual(['P1', 'A1'])
    expect(matching(T, 'BANCA')).toEqual(['R1', 'A2'])
    expect(matching(T, '  ')).toEqual([])
  })
  const hits = ['R1', 'A2']
  const cases: [string, string | null, 1 | -1, number, string | null][] = [
    ['n de pe primul rând → prima potrivire de dedesubt', 'P1', 1, 1, 'R1'],
    ['n de pe o potrivire → următoarea', 'R1', 1, 1, 'A2'],
    ['n de pe ultima → se reia de sus', 'A2', 1, 1, 'R1'],
    ['N de jos → cea de deasupra', 'A3', -1, 1, 'A2'],
    ['N de pe prima → se reia de jos', 'R1', -1, 1, 'A2'],
    ['fără cursor, n → prima', null, 1, 1, 'R1'],
    ['2n sare peste una', 'P1', 1, 2, 'A2'],
  ]
  for (const [name, cur, d, n, want] of cases) it(name, () => expect(nextMatch(ROWS, hits, cur, d, n)).toBe(want))
  it('fără potriviri → null', () => expect(nextMatch(ROWS, [], 'P1', 1)).toBeNull())
})
