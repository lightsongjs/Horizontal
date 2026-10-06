// Motorul de captură al ferestrei native de pe telefon (`QuickAddActivity`):
// codul paginii, împachetat de `scripts/build-capture-engine.mjs` și rulat în
// `androidx.javascriptengine`. Fără DOM, fără rețea: doar funcții pure.
// Contractul cu Kotlin (`CaptureEngine.kt`) e JSON în, JSON afară; `ABI` crește
// la orice schimbare de formă.

import { computeDraft, type CaptureInput } from '../lib/quickDraft'
import { attachmentFilename, shrinkPlan } from '../lib/shrinkImage'

const engine = {
  ABI: 1,
  captureDraft: (json: string): string => JSON.stringify(computeDraft(JSON.parse(json) as CaptureInput)),
  shrinkPlan: (json: string): string => JSON.stringify(shrinkPlan(JSON.parse(json))),
  attachmentFilename,
}

;(globalThis as unknown as { HzCapture: typeof engine }).HzCapture = engine
