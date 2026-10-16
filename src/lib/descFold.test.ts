import { describe, expect, it } from 'vitest'
import { MIN_HIDDEN_LINES, PANE_CAP_PX, descCap, foldState, moreLinesLabel, tapRevealsOnly } from './descFold'

describe('tapRevealsOnly (D-196)', () => {
  it('pe telefon, pliată: atingerea pe text doar arată tot', () => {
    expect(tapRevealsOnly('viewport', true, false)).toBe(true)
  })
  it('pe telefon, întreagă: atingerea scrie', () => {
    expect(tapRevealsOnly('viewport', false, false)).toBe(false)
  })
  it('bifa și linkurile își fac treaba și pliate', () => {
    expect(tapRevealsOnly('viewport', true, true)).toBe(false)
  })
  it('panoul lateral și modalul rămân cum erau', () => {
    expect(tapRevealsOnly('pane', true, false)).toBe(false)
    expect(tapRevealsOnly(null, true, false)).toBe(false)
  })
})

describe('descCap', () => {
  it('în panou: 45% din panou, dar nu peste 340px', () => {
    expect(descCap(600, 'pane')).toBe(270)
    expect(descCap(900, 'pane')).toBe(PANE_CAP_PX)
  })
  it('pe telefon: 45% din ecranul vizibil, fără plafonul de 340', () => {
    expect(descCap(844, 'viewport')).toBe(380)
  })
  it('o înălțime negativă sau zero nu dă un plafon negativ', () => {
    expect(descCap(-10, 'pane')).toBe(0)
  })
})

describe('foldState', () => {
  const line = 24
  it('textul încape: nu se pliază', () => {
    expect(foldState(200, 340, line)).toEqual({ folds: false, hidden: 0 })
    expect(foldState(340, 340, line)).toEqual({ folds: false, hidden: 0 })
  })
  it(`se pliază doar dacă ar ascunde cel puțin ${MIN_HIDDEN_LINES} rânduri`, () => {
    expect(foldState(340 + 3 * line, 340, line)).toEqual({ folds: false, hidden: 3 })
    expect(foldState(340 + 4 * line, 340, line)).toEqual({ folds: true, hidden: 4 })
  })
  it('un rând tăiat pe jumătate se numără ca ascuns', () => {
    expect(foldState(340 + 4.5 * line, 340, line)).toEqual({ folds: true, hidden: 5 })
  })
  it('o măsurătoare care încă lipsește nu pliază', () => {
    expect(foldState(800, 0, line).folds).toBe(false)
    expect(foldState(800, 340, 0).folds).toBe(false)
    expect(foldState(NaN, 340, line).folds).toBe(false)
  })
})

describe('moreLinesLabel', () => {
  it.each([
    [1, 'încă un rând'],
    [4, 'încă 4 rânduri'],
    [19, 'încă 19 rânduri'],
    [20, 'încă 20 de rânduri'],
    [21, 'încă 21 de rânduri'],
    [101, 'încă 101 rânduri'],
    [119, 'încă 119 rânduri'],
    [120, 'încă 120 de rânduri'],
    [200, 'încă 200 de rânduri'],
  ])('%i → %s', (n, s) => {
    expect(moreLinesLabel(n)).toBe(s)
  })
})
