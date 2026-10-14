import { describe, expect, it } from 'vitest'
import {
  moveWave, nextWaveName, openCounts, pillText, showWaveBand, stepWave,
  totalCounts, truncateLabel, waveLabel, waveTitle,
} from './waveBar'

const w = (number: number, name: string, label = '', position = number) => ({ number, name, label, position })

describe('showWaveBand', () => {
  it('needs at least two delivery waves', () => {
    expect(showWaveBand([])).toBe(false)
    expect(showWaveBand([w(0, 'Notițe')])).toBe(false)
    expect(showWaveBand([w(0, 'Notițe'), w(1, 'I')])).toBe(false)
    expect(showWaveBand([w(0, 'Notițe'), w(1, 'I'), w(2, 'II')])).toBe(true)
    expect(showWaveBand([w(1, 'I'), w(2, 'II')])).toBe(true)
  })
})

describe('labels', () => {
  it('uses the label, falling back to the numeral', () => {
    expect(waveLabel(w(1, 'I', 'MVP'))).toBe('MVP')
    expect(waveLabel(w(3, 'III', '  '))).toBe('Val III')
    expect(waveLabel(w(3, '', ''))).toBe('Val')
    // Modul local numește valurile „Val 1": fără „Val Val 1".
    expect(waveLabel(w(1, 'Val 1', ''))).toBe('Val 1')
  })

  it('truncates long labels on inactive pills only', () => {
    expect(truncateLabel('Extindere clase 7,8,12')).toBe('Extindere clase 7…')
    expect(Array.from(truncateLabel('Extindere clase 7,8,12')).length).toBeLessThanOrEqual(18)
    expect(truncateLabel('Discutie cu Mihai')).toBe('Discutie cu Mihai')
    expect(truncateLabel('matecusens.ro')).toBe('matecusens.ro')
    expect(truncateLabel('exact18charsxxxxxx')).toBe('exact18charsxxxxxx')
    expect(pillText(w(2, 'II', 'Extindere clase 7,8,12'), true)).toBe('Extindere clase 7,8,12')
    expect(pillText(w(2, 'II', 'Extindere clase 7,8,12'), false)).toBe('Extindere clase 7…')
  })

  it('does not split a surrogate pair', () => {
    expect(truncateLabel('🚀'.repeat(20))).toBe('🚀'.repeat(17) + '…')
  })

  it('titles carry the numeral, the full label and the counts', () => {
    expect(waveTitle(w(2, 'II', 'Extindere clase 7,8,12'), 88, 88)).toBe('II · Extindere clase 7,8,12 · 88 deschise')
    expect(waveTitle(w(2, 'II'), 3, 5)).toBe('Val II · 3 deschise din 5')
  })
})

describe('counts', () => {
  const issues = [
    { wave: 1, done: false }, { wave: 1, done: true }, { wave: 2, done: false }, { wave: 0, done: false },
  ]
  it('counts only open tickets per wave', () => {
    const m = openCounts(issues)
    expect(m.get(1)).toBe(1)
    expect(m.get(2)).toBe(1)
    expect(m.get(0)).toBe(1)
    expect(m.get(3)).toBeUndefined()
    expect(totalCounts(issues).get(1)).toBe(2)
  })
})

describe('stepWave', () => {
  const waves = [w(0, 'Notițe', '', 0), w(2, 'II', '', 1), w(5, 'V', '', 2)]
  it('walks the band order, scratchpad first, without wrapping', () => {
    expect(stepWave(waves, 0, 1)).toBe(2)
    expect(stepWave(waves, 2, 1)).toBe(5)
    expect(stepWave(waves, 5, 1)).toBeNull()
    expect(stepWave(waves, 2, -1)).toBe(0)
    expect(stepWave(waves, 0, -1)).toBeNull()
  })
  it('lands on the first wave from an unknown one', () => {
    expect(stepWave(waves, 9, 1)).toBe(0)
    expect(stepWave([], 1, 1)).toBeNull()
  })
})

describe('nextWaveName', () => {
  it('continues after the highest numeral, not the count', () => {
    // APIs: valul I a fost șters, numele merg II…IX.
    const apis = [w(0, 'Notițe'), ...['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((n, i) => w(i + 2, n))]
    expect(nextWaveName(apis)).toBe('X')
    expect(nextWaveName([w(0, 'Notițe')])).toBe('I')
    expect(nextWaveName([w(0, 'Notițe'), w(1, 'I'), w(2, 'II')])).toBe('III')
  })
  it('never goes below the count when names are free text', () => {
    expect(nextWaveName([w(1, 'MVP'), w(2, 'Beta')])).toBe('III')
  })
})

describe('moveWave', () => {
  const delivery = [w(1, 'I', '', 1), w(2, 'II', '', 2), w(3, 'III', '', 3), w(4, 'IV', '', 4)]
  it('reuses the existing positions in the new order and returns only changes', () => {
    expect(moveWave(delivery, 3, 0)).toEqual([
      { number: 3, position: 1 }, { number: 1, position: 2 }, { number: 2, position: 3 },
    ])
    expect(moveWave(delivery, 1, 3)).toEqual([
      { number: 2, position: 1 }, { number: 3, position: 2 }, { number: 4, position: 3 }, { number: 1, position: 4 },
    ])
  })
  it('is a no-op for the same index or an unknown wave', () => {
    expect(moveWave(delivery, 2, 1)).toEqual([])
    expect(moveWave(delivery, 9, 0)).toEqual([])
  })
  it('clamps the target index', () => {
    expect(moveWave(delivery, 1, 99).slice(-1)[0]).toEqual({ number: 1, position: 4 })
  })
  it('makes duplicate positions strict', () => {
    const dup = [w(1, 'I', '', 1), w(2, 'II', '', 1), w(3, 'III', '', 1)]
    expect(moveWave(dup, 3, 0)).toEqual([
      { number: 1, position: 2 }, { number: 2, position: 3 },
    ])
  })
})
