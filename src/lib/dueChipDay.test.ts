// Fusul ÎNAINTE de orice Date: fixtures-urile sunt scrise pentru București
// (le citește și JUnit, `core/Shade.kt`, cu același fus).
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fixtures from './dueChipDay.fixtures.json'
import { dueChipDay } from './schedule'

describe('dueChipDay — fixtures comune cu Kotlin (notificarea din bară)', () => {
  for (const f of fixtures) {
    it(f.name, () => expect(dueChipDay(f.dueAt, new Date(f.now))).toBe(f.want))
  }
})
