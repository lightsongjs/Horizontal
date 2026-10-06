// Fusul ÎNAINTE de orice Date: fixtures-urile sunt scrise pentru București
// (le rulează și pachetul motorului de pe telefon, în `src/capture/engine.test.ts`).
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fx from './capture.fixtures.json'
import { computeDraft, type CaptureInput } from './quickDraft'
import { dailyProjectId } from './captureTokens'
import hooksSrc from '../hooks.ts?raw'

export function fixtureInput(c: (typeof fx.cases)[number]['input']): CaptureInput {
  const i = c as { text: string; rejected?: string[]; manual?: CaptureInput['manual'] }
  return {
    text: i.text, desc: '', rejected: i.rejected ?? [], manual: i.manual ?? {},
    projects: fx.projects, assignees: fx.assignees, defaultProjectId: dailyProjectId(fx.projects),
    nowMs: fx.nowMs, tokens: true,
  }
}

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
