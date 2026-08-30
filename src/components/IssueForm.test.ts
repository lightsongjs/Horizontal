import { describe, it, expect } from 'vitest'
import { buildMetaRecap } from './IssueForm'

const base = { themeName: null, waveName: 'Val 2', assigneeName: null, urgent: false, dueLabel: null }

describe('buildMetaRecap', () => {
  it('un tichet nou n-are decât valul', () => {
    expect(buildMetaRecap(base)).toBe('Val 2')
  })

  it('adaugă temă, assignee, urgent și scadență în ordine, doar ce e setat', () => {
    expect(buildMetaRecap({
      themeName: 'Feature', waveName: 'Val 2', assigneeName: 'Ionuț', urgent: true, dueLabel: '26/08 14:30',
    })).toBe('Feature · Val 2 · Ionuț · ⚡ Urgent · 26/08 14:30')
  })

  it('sare peste ce lipsește, fără puncte goale', () => {
    expect(buildMetaRecap({ ...base, assigneeName: 'Ionuț', dueLabel: '26/08' }))
      .toBe('Val 2 · Ionuț · 26/08')
  })
})
