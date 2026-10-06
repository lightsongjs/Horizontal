// Fusul ÎNAINTE de orice Date: fixtures-urile sunt scrise pentru București
// (le rulează și pachetul motorului de pe telefon, în `src/capture/engine.test.ts`).
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fx from './capture.fixtures.json'
import { computeDraft } from './quickDraft'
import { fixtureInput } from './captureFixtures'
import hooksSrc from '../hooks.ts?raw'


describe('computeDraft — fixtures comune cu fereastra de pe telefon', () => {
  for (const c of fx.cases) {
    it(c.name, () => {
      expect(computeDraft(fixtureInput(c.input))).toMatchObject(c.want)
    })
  }
})

describe('o singură sursă', () => {
  it('captura din pagină trece prin computeDraft', () => {
    expect(hooksSrc).toContain('computeDraft(')
  })
})
