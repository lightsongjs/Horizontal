import { describe, expect, it } from 'vitest'
import { debounce, REFRESH_MIN_INTERVAL_MS, STALE_REFRESH_MS, syncRefreshStep, shouldRefreshOnVisible } from './refreshGate'

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

describe('syncRefreshStep', () => {
  const s = (offline: boolean, pending = 0) => ({ offline, pending })
  it('reconectarea cere date', () => expect(syncRefreshStep(false, s(true), s(false))).toEqual({ owed: false, refresh: true }))
  it('reconectarea cu coada plină cere date și o datorează și la golire', () =>
    expect(syncRefreshStep(true, s(true, 2), s(false, 2))).toEqual({ owed: true, refresh: true }))
  it('coada rămasă de offline, golită: încă o dată', () => expect(syncRefreshStep(true, s(false, 1), s(false, 0))).toEqual({ owed: false, refresh: true }))
  it('coada care scade, dar nu e goală, nu', () => expect(syncRefreshStep(true, s(false, 2), s(false, 1))).toEqual({ owed: true, refresh: false }))
  it('o captură online (1 → 0) fără offline înainte, nu', () => expect(syncRefreshStep(false, s(false, 1), s(false, 0))).toEqual({ owed: false, refresh: false }))
  it('căderea rețelei cu ceva în coadă: datorat, fără cerere', () => expect(syncRefreshStep(false, s(false, 1), s(true, 1))).toEqual({ owed: true, refresh: false }))
  it('o captură făcută offline intră în datorie', () => expect(syncRefreshStep(false, s(true, 0), s(true, 1))).toEqual({ owed: true, refresh: false }))
  it('online → online fără coadă, nu', () => expect(syncRefreshStep(false, s(false), s(false))).toEqual({ owed: false, refresh: false }))
})

describe('debounce', () => {
  it('o rafală dă un singur apel, la ms după ultimul; cancel îl oprește', () => {
    let now = 0
    const timers: { at: number; f: () => void; id: number }[] = []
    let id = 0
    const timer = {
      set: (f: () => void, ms: number) => { timers.push({ at: now + ms, f, id: ++id }); return id },
      clear: (h: unknown) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1) },
    }
    const run = (to: number) => { now = to; for (const t of timers.filter((t) => t.at <= now)) { timer.clear(t.id); t.f() } }
    let calls = 0
    const d = debounce(() => { calls += 1 }, STALE_REFRESH_MS, timer)
    d(); run(500); d(); run(1400); expect(calls).toBe(0)
    run(1500); expect(calls).toBe(1)
    d(); d.cancel(); run(5000); expect(calls).toBe(1)
  })
})
