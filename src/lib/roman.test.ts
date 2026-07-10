import { describe, expect, it } from 'vitest'
import { toRoman } from './roman'

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
