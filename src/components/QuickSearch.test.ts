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

  describe('prefix collision (all tickets in a project share one id prefix)', () => {
    it('a query equal to the single-letter prefix does not id-match — results are title-driven only', () => {
      // Every ticket in a Horizontal-style project starts with "H-", so a
      // purely alphabetic query of "h" is a substring of every single id.
      // If id matching fired here it would flood the id tier with the whole
      // list on the very first keystroke of a normal title search. None of
      // these titles contain the letter "h" ("Delta"/"Zeta"/"Omega" — note
      // "Alpha" would NOT work here, it has an "h"), so if id matching is
      // correctly suppressed for a digit-free query, nothing should match.
      const issues = [
        makeIssue('H-01', 'Delta task'),
        makeIssue('H-02', 'Zeta task'),
        makeIssue('H-03', 'Omega task'),
      ]
      const result = rankIssues('h', issues)
      expect(result).toEqual([])
    })

    it('a query equal to a multi-letter prefix does not id-match', () => {
      const issues = [
        makeIssue('KATA-01', 'Delta task'),
        makeIssue('KATA-02', 'Zeta task'),
        makeIssue('KATA-03', 'Omega task'),
      ]
      const result = rankIssues('kata', issues)
      expect(result).toEqual([])
    })

    it('a genuine title match is not displaced when every ticket shares the query as a prefix substring', () => {
      // Eleven tickets share the "H-" prefix. None of their titles fuzzy-match
      // "h" except one deliberate target. If prefix letters incorrectly
      // id-matched, the id tier would fill with (up to) all eleven tickets in
      // source order and the genuine title match could be pushed out or
      // buried; with the fix, "h" should not id-match anything, and only the
      // title match should be returned.
      const distractors = Array.from({ length: 10 }, (_, n) => makeIssue(`H-${20 + n}`, 'Delta task'))
      const target = makeIssue('H-99', 'Something with an h in it')
      const issues = [...distractors, target]
      const result = rankIssues('h', issues)
      expect(result.map((i) => i.id)).toContain('H-99')
    })
  })
})
