// Intrarea `computeDraft` pentru un caz din `capture.fixtures.json` — comună
// testului paginii și testului pachetului de pe telefon.
import fx from './capture.fixtures.json'
import type { CaptureInput } from './quickDraft'
import { inboxProjectId } from './captureTokens'

export function fixtureInput(c: (typeof fx.cases)[number]['input']): CaptureInput {
  const i = c as { text: string; rejected?: string[]; manual?: CaptureInput['manual'] }
  return {
    text: i.text, desc: '', rejected: i.rejected ?? [], manual: i.manual ?? {},
    projects: fx.projects, assignees: fx.assignees, defaultProjectId: inboxProjectId(fx.projects),
    nowMs: fx.nowMs, tokens: true,
  }
}
