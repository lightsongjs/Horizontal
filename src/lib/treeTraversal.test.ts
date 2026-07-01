import { describe, it, expect } from 'vitest'
import { getRelatedIds } from './treeTraversal'
import type { Issue } from './types'

function makeIssue(id: string, deps: string[] = []): Issue {
  return {
    id,
    projectId: 'p1',
    title: id,
    desc: '',
    theme: '',
    deps,
    wave: 1,
    done: false,
    selectors: [],
    scenarios: [],
    notes: '',
    assigneeId: null,
  }
}

describe('getRelatedIds', () => {
  it('returnează set gol dacă tichetul nu are deps și nu îl blochează nimeni', () => {
    const byId: Record<string, Issue> = { a: makeIssue('a') }
    expect(getRelatedIds('a', byId)).toEqual(new Set())
  })

  it('include ancestors direcți', () => {
    const byId: Record<string, Issue> = {
      a: makeIssue('a'),
      b: makeIssue('b', ['a']),
    }
    // b depinde de a → ancestors(b) = {a}
    expect(getRelatedIds('b', byId)).toEqual(new Set(['a']))
  })

  it('include descendants direcți', () => {
    const byId: Record<string, Issue> = {
      a: makeIssue('a'),
      b: makeIssue('b', ['a']),
    }
    // a deblochează b → descendants(a) = {b}
    expect(getRelatedIds('a', byId)).toEqual(new Set(['b']))
  })

  it('traversează întregul lanț recursiv', () => {
    const byId: Record<string, Issue> = {
      a: makeIssue('a'),
      b: makeIssue('b', ['a']),
      c: makeIssue('c', ['b']),
      d: makeIssue('d', ['c']),
    }
    // click pe b → ancestors: {a}, descendants: {c, d}
    expect(getRelatedIds('b', byId)).toEqual(new Set(['a', 'c', 'd']))
  })

  it('nu include tichetul selectat în set', () => {
    const byId: Record<string, Issue> = {
      a: makeIssue('a'),
      b: makeIssue('b', ['a']),
    }
    const result = getRelatedIds('b', byId)
    expect(result.has('b')).toBe(false)
  })

  it('nu intră în buclă infinită la cicluri', () => {
    const byId: Record<string, Issue> = {
      a: makeIssue('a', ['b']),
      b: makeIssue('b', ['a']),
    }
    expect(() => getRelatedIds('a', byId)).not.toThrow()
  })
})
