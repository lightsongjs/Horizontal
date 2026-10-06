// Pachetul motorului de pe telefon, construit exact ca pentru APK și rulat
// izolat (`node:vm`, fără DOM): trebuie să dea ce dă `computeDraft` în pagină.
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import fx from '../lib/capture.fixtures.json'
import { computeDraft } from '../lib/quickDraft'
import { attachmentFilename } from '../lib/shrinkImage'
import { fixtureInput } from '../lib/captureFixtures'
import { buildCaptureEngine } from '../../scripts/build-capture-engine.mjs'

describe('pachetul motorului = computeDraft', async () => {
  const code = await buildCaptureEngine({ write: false })
  const sandbox: { HzCapture?: { ABI: number; captureDraft(j: string): string; attachmentFilename(n: string, t: string | null): string } } = {}
  vm.runInNewContext(code, sandbox)
  const engine = sandbox.HzCapture!

  it('expune ABI 1', () => { expect(engine.ABI).toBe(1) })

  for (const c of fx.cases) {
    it(c.name, () => {
      const input = fixtureInput(c.input)
      expect(JSON.parse(engine.captureDraft(JSON.stringify(input)))).toEqual(JSON.parse(JSON.stringify(computeDraft(input))))
    })
  }

  it('numele fișierului urmează regula paginii', () => {
    expect(engine.attachmentFilename('Poză tablă.PNG', 'image/webp')).toBe(attachmentFilename('Poză tablă.PNG', 'image/webp'))
  })
})
