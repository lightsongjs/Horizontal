import { describe, expect, it } from 'vitest'
import { fromRoman, toRoman } from './roman'

describe('toRoman', () => {
  it('maps the first delivery-wave indices', () => {
    expect([1, 2, 3, 4, 5].map(toRoman)).toEqual(['I', 'II', 'III', 'IV', 'V'])
  })

  it('handles subtractive and larger values', () => {
    expect(toRoman(9)).toBe('IX')
    expect(toRoman(14)).toBe('XIV')
    expect(toRoman(40)).toBe('XL')
  })
})

describe('fromRoman', () => {
  it('inverts toRoman', () => {
    for (let n = 1; n <= 60; n++) expect(fromRoman(toRoman(n))).toBe(n)
  })
  it('rejects text that is not a canonical numeral', () => {
    expect(fromRoman('')).toBeNull()
    expect(fromRoman('MVP')).toBeNull()
    expect(fromRoman('IIII')).toBeNull()
    expect(fromRoman('VX')).toBeNull()
  })
  it('ignores case and spaces', () => {
    expect(fromRoman(' ix ')).toBe(9)
  })
})
