import { describe, expect, it } from 'vitest'
import { REFRESH_MIN_INTERVAL_MS, shouldRefreshOnVisible } from './refreshGate'

describe('shouldRefreshOnVisible', () => {
  it('cere datele prima oară — nu s-a refăcut niciodată', () => {
    expect(shouldRefreshOnVisible(null, 1_000)).toBe(true)
  })

  it('sare peste o revenire imediată în tab', () => {
    expect(shouldRefreshOnVisible(1_000, 1_000 + REFRESH_MIN_INTERVAL_MS - 1)).toBe(false)
  })

  it('reface exact la prag', () => {
    expect(shouldRefreshOnVisible(1_000, 1_000 + REFRESH_MIN_INTERVAL_MS)).toBe(true)
  })

  it('reface după o absență lungă', () => {
    expect(shouldRefreshOnVisible(1_000, 1_000 + 10 * REFRESH_MIN_INTERVAL_MS)).toBe(true)
  })

  it('reface dacă ceasul a sărit înapoi — vechimea e necunoscută, nu zero', () => {
    expect(shouldRefreshOnVisible(10_000, 5_000)).toBe(true)
  })
})
