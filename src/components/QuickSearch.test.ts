import { describe, it, expect } from 'vitest'
import { rankIssues } from './QuickSearch'
import type { Issue } from '../lib/types'

function makeIssue(id: string, title: string): Issue {
  return {
    id,
    projectId: 'demo',
    title,
    desc: '',
    theme: '',
    wave: 1,
    deps: [],
    done: false,
    selectors: [],
    scenarios: [],
    notes: '',
    assigneeId: null,
    urgent: false,
  }
}

describe('rankIssues', () => {
  it('still matches on title via the fuzzy subsequence matcher, including diacritic folding', () => {
    const issues = [makeIssue('H-01', 'Mădălin face research'), makeIssue('H-02', 'Something else')]
    const result = rankIssues('mada', issues)
    expect(result.map((i) => i.id)).toEqual(['H-01'])
  })

  it('matches the exact full id', () => {
    const issues = [makeIssue('H-04', 'Unrelated title'), makeIssue('H-05', 'Other')]
    const result = rankIssues('H-04', issues)
    expect(result.map((i) => i.id)).toEqual(['H-04'])
  })

  it('matches a lowercase id query against an uppercase id', () => {
    const issues = [makeIssue('H-04', 'Unrelated title')]
    const result = rankIssues('h-04', issues)
    expect(result.map((i) => i.id)).toEqual(['H-04'])
  })

  it('matches the numeric part alone', () => {
    const issues = [makeIssue('H-04', 'Unrelated title'), makeIssue('H-05', 'Other')]
    const result = rankIssues('04', issues)
    expect(result.map((i) => i.id)).toEqual(['H-04'])
  })

  it('ranks id matches above title-only matches', () => {
    const issues = [
      makeIssue('H-01', 'This title contains 04 as a substring'),
      makeIssue('H-04', 'Completely unrelated title'),
    ]
    const result = rankIssues('04', issues)
    expect(result.map((i) => i.id)).toEqual(['H-04', 'H-01'])
  })

  it('does not let an id match get truncated away by ten earlier title matches (ranking happens before the slice)', () => {
    // Ten issues whose title fuzzy-matches "07" (subsequence: a '0' then a
    // later '7'), listed BEFORE the one issue whose id matches "07". A naive
    // `issues.filter(matchesTitleOrId).slice(0, 10)` would keep only the ten
    // title matches and drop the id match entirely — exactly the bug this
    // feature exists to prevent.
    const titleMatches = Array.from({ length: 10 }, (_, n) =>
      makeIssue(`X-${9010 + n}`, 'release 0 to 7'),
    )
    const idMatch = makeIssue('H-07', 'completely unrelated title')
    const issues = [...titleMatches, idMatch]

    const result = rankIssues('07', issues)

    expect(result).toHaveLength(10)
    expect(result[0].id).toBe('H-07')
  })

  it('empty query returns the first 10 issues unchanged', () => {
    const issues = Array.from({ length: 15 }, (_, n) => makeIssue(`H-${n}`, `Title ${n}`))
    const result = rankIssues('', issues)
    expect(result).toEqual(issues.slice(0, 10))
  })

  it('a query matching nothing returns an empty array', () => {
    const issues = [makeIssue('H-01', 'Alpha'), makeIssue('H-02', 'Beta')]
    const result = rankIssues('zzz-nope', issues)
    expect(result).toEqual([])
  })
})
