import { describe, expect, it } from 'vitest'
import { parseFlag, serializeFlag } from './vimSettings'

describe('vimSettings', () => {
  it('pornit implicit; doar „off" oprește', () => {
    expect(parseFlag(null)).toBe(true)
    expect(parseFlag('on')).toBe(true)
    expect(parseFlag('ceva')).toBe(true)
    expect(parseFlag('off')).toBe(false)
  })
  it('dus-întors', () => {
    expect(parseFlag(serializeFlag(false))).toBe(false)
    expect(parseFlag(serializeFlag(true))).toBe(true)
  })
})
