// Fusul ÎNAINTE de orice Date: fixtures-urile de schimbare a orei sunt scrise
// pentru București (le citește și JUnit, cu același fus). Grila e oricum în
// milisecunde absolute — fusul contează doar ca să se vadă că nu contează.
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fixtures from './pings.fixtures.json'
import { pingFreshMs, pings, pingsBetween } from '../../supabase/functions/_shared/pings.ts'

const ms = (s: string) => Date.parse(s)
const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString())

describe('pings — fixtures comune cu Kotlin (`core/Pings.kt`)', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const p = pings(ms(f.remindAt), f.every, ms(f.dueAt), ms(f.now))
      expect({ current: iso(p.current), next: iso(p.next) }).toEqual(f.want)
    })
  }
})

describe('pingFreshMs', () => {
  it('min(pas, 10 minute)', () => {
    expect(pingFreshMs(1)).toBe(60_000)
    expect(pingFreshMs(15)).toBe(600_000)
    expect(pingFreshMs(60)).toBe(600_000)
  })
})

describe('pingsBetween', () => {
  const r = ms('2026-11-06T07:00:00.000Z')
  const d = ms('2026-11-06T08:00:00.000Z')
  it('de la pingul curent până la capăt, inclusiv', () => {
    const got = pingsBetween(r, 15, d, ms('2026-11-06T07:20:00.000Z'), d + 3_600_000, 10).map(iso)
    expect(got).toEqual(['2026-11-06T07:30:00.000Z', '2026-11-06T07:45:00.000Z', '2026-11-06T08:00:00.000Z'])
  })
  it('plafonul taie din coadă', () => {
    expect(pingsBetween(r, 1, d, r, d, 5)).toHaveLength(5)
  })
  it('pornit chiar pe un ping, îl include', () => {
    expect(iso(pingsBetween(r, 15, d, r, d, 1)[0])).toBe('2026-11-06T07:00:00.000Z')
  })
})
