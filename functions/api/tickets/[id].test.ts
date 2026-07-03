import { describe, it, expect } from 'vitest'
import { buildIssueUpdate } from './[id]'

describe('buildIssueUpdate', () => {
  it('maps desc to details', () => {
    expect(buildIssueUpdate({ desc: 'hello' })).toEqual({ details: 'hello' })
  })
  it('maps title as-is', () => {
    expect(buildIssueUpdate({ title: 'New title' })).toEqual({ title: 'New title' })
  })
  it('ignores unknown keys', () => {
    expect(buildIssueUpdate({ unknown: 'x', title: 'T' })).toEqual({ title: 'T' })
  })
  it('returns empty object for empty body', () => {
    expect(buildIssueUpdate({})).toEqual({})
  })
  it('maps multiple fields at once', () => {
    expect(buildIssueUpdate({ title: 'T', wave: 2, done: true })).toEqual({ title: 'T', wave: 2, done: true })
  })
  it('maps selectors and scenarios', () => {
    expect(buildIssueUpdate({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] }))
      .toEqual({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] })
  })
  it('does not include deps (relation handled separately)', () => {
    expect(buildIssueUpdate({ title: 'T', deps: ['KATA-01'] })).toEqual({ title: 'T' })
  })
})
