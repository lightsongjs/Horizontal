import { describe, expect, it } from 'vitest'
import { IDLE_LIMIT_MS, isActive, parseIdle, parseLocked } from './presence'

describe('isActive', () => {
  it('deblocat și atins recent: activ', () => expect(isActive(5_000, false)).toBe(true))
  it('deblocat, dar neatins de 2 minute: inactiv', () => expect(isActive(IDLE_LIMIT_MS, false)).toBe(false))
  it('blocat: inactiv, oricât de recentă ar fi atingerea', () => expect(isActive(1_000, true)).toBe(false))
  it('citire eșuată: inactiv — telefonul sună la minut', () => {
    expect(isActive(null, false)).toBe(false)
    expect(isActive(1_000, null)).toBe(false)
  })
})

describe('ieșirea gdbus (reală, GNOME 2026-10-05)', () => {
  it('timpul de inactivitate e numărul de DUPĂ „uint64"', () => expect(parseIdle('(uint64 3904,)\n')).toBe(3904))
  it('ilizibil → null', () => { expect(parseIdle(null)).toBeNull(); expect(parseIdle('Error: x')).toBeNull() })
  it('ecranul blocat', () => {
    expect(parseLocked('(false,)\n')).toBe(false)
    expect(parseLocked('(true,)\n')).toBe(true)
    expect(parseLocked(null)).toBeNull()
  })
})
