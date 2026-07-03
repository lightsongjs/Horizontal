import { describe, it, expect } from 'vitest'
import { isValidKey } from './_middleware'

describe('isValidKey', () => {
  it('accepts matching key', () => expect(isValidKey('abc123', 'abc123')).toBe(true))
  it('rejects wrong key', () => expect(isValidKey('wrong', 'abc123')).toBe(false))
  it('rejects empty string', () => expect(isValidKey('', 'abc123')).toBe(false))
  it('rejects null', () => expect(isValidKey(null, 'abc123')).toBe(false))
})
