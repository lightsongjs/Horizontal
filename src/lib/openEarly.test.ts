import { describe, expect, it } from 'vitest'
import { planOpen } from './openEarly'

describe('planOpen', () => {
  it('telefon, sarcina din listă: se deschide la atingere', () => {
    expect(planOpen({ compact: true, docked: false, inList: true })).toBe('now')
  })
  it('telefon, sarcina nu e în liste (deep link): așteaptă doar s-o aibă în memorie', () => {
    expect(planOpen({ compact: true, docked: false, inList: false })).toBe('when-present')
  })
  it('panoul lateral: orice cadru, fiindcă formularul docat se remontează pe date noi', () => {
    expect(planOpen({ compact: false, docked: true, inList: true })).toBe('when-present')
    expect(planOpen({ compact: false, docked: true, inList: false })).toBe('when-present')
  })
  it('modalul își copiază câmpurile la montare: așteaptă lista autoritară', () => {
    expect(planOpen({ compact: false, docked: false, inList: true })).toBe('when-loaded')
  })
})
