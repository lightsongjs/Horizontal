import { describe, expect, it } from 'vitest'
import { MIN_HIDDEN_LINES, PANE_CAP_PX, descCap, foldState, moreLinesLabel, stretchedOut, tapRevealsOnly } from './descFold'

describe('stretchedOut (ROUTIN-09: foaia înghețată la primul spațiu)', () => {
  it('scoate umplutura cu care CSS-ul întinde editorul', () => {
    // Editor 671px întins de foaie, scroller 663px, două rânduri goale = 55px.
    expect(stretchedOut(671, 663, 55)).toBe(63)
  })
  it('neîntins (panoul), măsura rămâne a editorului', () => {
    expect(stretchedOut(63, 55, 55)).toBe(63)
    expect(stretchedOut(63, 54.6, 55)).toBe(63)
  })
  it('plierea nu mai depinde de propriul efect: întinsă sau plafonată, aceeași decizie', () => {
    const cap = 393
    const line = 24
    // Descrierea goală: întinsă la 671px sau tăiată la plafon, textul are tot 63px.
    const stretched = stretchedOut(671, 663, 55) + 12
    const capped = stretchedOut(381, 373, 55) + 12
    expect(stretched).toBe(capped)
    expect(foldState(stretched, cap, line).folds).toBe(false)
    // Măsura veche (editorul întreg) dădea două răspunsuri, deci bucla.
    expect(foldState(671 + 12, cap, line).folds).not.toBe(foldState(381 + 12, cap, line).folds)
  })
})

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
