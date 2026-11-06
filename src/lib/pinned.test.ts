import { describe, expect, it } from 'vitest'
import { PIN_STEP_MS, comparePinned, isPinned, isPinnedOpen, movePinned, pinPatch, pinnedFirst, unpinned } from './pinned'
import { NO_SCHEDULE } from './schedule'
import type { Issue } from './types'

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false,
    selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', urgent: false,
    ...NO_SCHEDULE, ...patch,
  }
}
const NOW = new Date('2026-10-17T07:00:00.000Z')
const T1 = '2026-10-16T07:00:00.000Z'
const T2 = '2026-10-17T06:00:00.000Z'

describe('pinned', () => {
  it('fixat = are `pinnedAt`; sus urcă doar cel deschis', () => {
    expect(isPinned(task('A'))).toBe(false)
    expect(isPinned(task('A', { pinnedAt: T1 }))).toBe(true)
    expect(isPinnedOpen(task('A', { pinnedAt: T1, done: true }))).toBe(false)
  })

  it('pinPatch comută: fixează acum, apoi scoate', () => {
    expect(pinPatch(task('A'), NOW)).toEqual({ pinnedAt: NOW.toISOString() })
    expect(pinPatch(task('A', { pinnedAt: T1 }), NOW)).toEqual({ pinnedAt: null })
  })

  it('comparePinned: cel mai recent primul', () => {
    const xs = [task('A', { pinnedAt: T1 }), task('B', { pinnedAt: T2 })].sort(comparePinned)
    expect(xs.map((i) => i.id)).toEqual(['B', 'A'])
  })

  it('pinnedFirst: fixatele deschise sus, restul în ordinea primită', () => {
    const xs = [task('A'), task('B', { pinnedAt: T1 }), task('C'), task('D', { pinnedAt: T2 }), task('E', { pinnedAt: T2, done: true })]
    expect(pinnedFirst(xs).map((i) => i.id)).toEqual(['D', 'B', 'A', 'C', 'E'])
    // Fără fixate, aceeași listă (aceeași referință — nimic de recalculat).
    const plain = [task('A'), task('B')]
    expect(pinnedFirst(plain)).toBe(plain)
  })

  it('unpinned: scoate fixatele deschise din grupul zilei, bifatele rămân', () => {
    const xs = [task('A'), task('B', { pinnedAt: T1 }), task('C', { pinnedAt: T2, done: true })]
    expect(unpinned(xs).map((i) => i.id)).toEqual(['A', 'C'])
    const plain = [task('A')]
    expect(unpinned(plain)).toBe(plain)
  })
})

describe('movePinned: ordinea trasă de mână, tot prin pinnedAt', () => {
  const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
  // A sus (cel mai recent), apoi B, C, D — la câte o oră.
  const H = 3_600_000
  const list = () => ['A', 'B', 'C', 'D'].map((id, i) => task(id, { pinnedAt: at(T2, -i * H) }))
  /** Aplică patch-urile și reordonează ca orice ecran: `comparePinned`. */
  const after = (rows: Issue[], writes: { id: string; pinnedAt: string }[]) => {
    const by = new Map(writes.map((w) => [w.id, w.pinnedAt]))
    return rows.map((r) => (by.has(r.id) ? { ...r, pinnedAt: by.get(r.id)! } : r)).sort(comparePinned).map((r) => r.id)
  }

  it('la mijloc: o singură scriere, pe cel mutat, între vecini', () => {
    const rows = list()
    const w = movePinned(rows, 'D', 1, NOW)
    expect(w).toEqual([{ id: 'D', pinnedAt: at(T2, -H / 2) }])
    expect(after(rows, w)).toEqual(['A', 'D', 'B', 'C'])
    expect(after(rows, movePinned(rows, 'A', 2, NOW))).toEqual(['B', 'C', 'A', 'D'])
  })

  it('sus: cel puțin „acum", ca o fixare nouă; jos: un pas sub ultimul', () => {
    const rows = list()
    expect(movePinned(rows, 'C', 0, NOW)).toEqual([{ id: 'C', pinnedAt: NOW.toISOString() }])
    expect(movePinned(rows, 'B', 3, NOW)).toEqual([{ id: 'B', pinnedAt: at(T2, -3 * H - PIN_STEP_MS) }])
    expect(after(rows, movePinned(rows, 'B', 3, NOW))).toEqual(['A', 'C', 'D', 'B'])
    // Cel de sus e deja în viitor (fixat de pe alt dispozitiv cu ceasul înainte): tot deasupra lui.
    const future = [task('X', { pinnedAt: at(NOW.toISOString(), 5000) }), task('Y', { pinnedAt: T1 })]
    expect(after(future, movePinned(future, 'Y', 0, NOW))).toEqual(['Y', 'X'])
  })

  it('pe loc, id necunoscut sau o singură fixată: nimic de scris', () => {
    const rows = list()
    expect(movePinned(rows, 'B', 1, NOW)).toEqual([])
    expect(movePinned(rows, 'Z', 0, NOW)).toEqual([])
    expect(movePinned([task('A', { pinnedAt: T1 })], 'A', 0, NOW)).toEqual([])
  })

  it('fără loc la mijloc (vecini egali sau la 1 ms): renumerotează, scrie doar ce se schimbă', () => {
    const rows = [task('A', { pinnedAt: T2 }), task('B', { pinnedAt: at(T2, -1) }), task('C', { pinnedAt: at(T2, -1) }), task('D', { pinnedAt: T1 })]
    const w = movePinned(rows, 'D', 1, NOW)
    expect(after(rows, w)).toEqual(['A', 'D', 'B', 'C'])
    expect(w.map((x) => x.id)).toEqual(['D', 'B', 'C'])
    expect(w[0].pinnedAt).toBe(at(T2, -PIN_STEP_MS))
  })

  it('mutări repetate în aceeași fantă rămân corecte până la capăt', () => {
    let rows = list()
    // Pune mereu ultimul imediat sub A: fanta A–B se înjumătățește la fiecare pas.
    for (let k = 0; k < 40; k++) {
      const last = rows[rows.length - 1].id
      const w = movePinned(rows, last, 1, NOW)
      const want = [rows[0].id, last, ...rows.slice(1, -1).map((r) => r.id)]
      expect(after(rows, w)).toEqual(want)
      const by = new Map(w.map((x) => [x.id, x.pinnedAt]))
      rows = rows.map((r) => (by.has(r.id) ? { ...r, pinnedAt: by.get(r.id)! } : r)).sort(comparePinned)
    }
  })
})
