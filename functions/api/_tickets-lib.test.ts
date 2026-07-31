import { describe, it, expect } from 'vitest'
import { nextIdFrom } from './_tickets-lib'

describe('nextIdFrom', () => {
  it('returns 01 for an empty project', () => {
    expect(nextIdFrom([], 'TK')).toBe('TK-01')
  })
  it('returns max + 1', () => {
    expect(nextIdFrom(['TK-01', 'TK-02', 'TK-03'], 'TK')).toBe('TK-04')
  })
  it('is not fooled by unordered input', () => {
    expect(nextIdFrom(['TK-07', 'TK-02'], 'TK')).toBe('TK-08')
  })
  it('pads to width 2', () => {
    expect(nextIdFrom(['TK-08'], 'TK')).toBe('TK-09')
  })
  it('does not pad past width 2', () => {
    expect(nextIdFrom(['TK-99'], 'TK')).toBe('TK-100')
  })
  it('ignores ids whose suffix is not a number', () => {
    expect(nextIdFrom(['TK-01', 'TK-draft'], 'TK')).toBe('TK-02')
  })
  it('handles a multi-character prefix', () => {
    expect(nextIdFrom(['KATA-11'], 'KATA')).toBe('KATA-12')
  })
})
