import { describe, expect, it } from 'vitest'
import { logoutPlan } from './logoutPlan'

describe('logoutPlan', () => {
  it('refuză offline, chiar cu coadă goală', () => {
    expect(logoutPlan({ offline: true, pending: 0 })).toBe('refuse')
    expect(logoutPlan({ offline: true, pending: 3 })).toBe('refuse')
  })
  it('cere confirmare online cu scrieri netrimise', () => {
    expect(logoutPlan({ offline: false, pending: 2 })).toBe('confirm')
  })
  it('merge direct online cu coada goală', () => {
    expect(logoutPlan({ offline: false, pending: 0 })).toBe('proceed')
  })
})
