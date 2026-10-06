// Motorul de captură al ferestrei native de pe telefon (`QuickAddActivity`):
// codul paginii, împachetat de `scripts/build-capture-engine.mjs` și rulat în
// `androidx.javascriptengine`. Fără DOM, fără rețea: doar funcții pure.
// Contractul cu Kotlin (`CaptureEngine.kt`) e JSON în, JSON afară; `ABI` crește
// la orice schimbare de formă.

import { computeDraft, type CaptureInput } from '../lib/quickDraft'
import { attachmentFilename, shrinkPlan } from '../lib/shrinkImage'
import { applySuggestion, suggest, tokenAt } from '../lib/tokenSuggest'

interface SuggestInput {
  text: string
  caret: number
  projects: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
}

/** Lista de la `#` / `@` sub cursor; fiecare alegere vine cu textul și cursorul de după ea. */
function suggestAt(i: SuggestInput) {
  const token = tokenAt(i.text, i.caret)
  const items = token ? suggest(token, i.projects, i.assignees) : []
  return { token, items: items.map((s) => ({ ...s, apply: applySuggestion(i.text, token!, s) })) }
}

const engine = {
  ABI: 1,
  captureDraft: (json: string): string => JSON.stringify(computeDraft(JSON.parse(json) as CaptureInput)),
  shrinkPlan: (json: string): string => JSON.stringify(shrinkPlan(JSON.parse(json))),
  attachmentFilename,
  suggest: (json: string): string => JSON.stringify(suggestAt(JSON.parse(json) as SuggestInput)),
}

;(globalThis as unknown as { HzCapture: typeof engine }).HzCapture = engine
