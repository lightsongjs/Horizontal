import { describe, expect, it } from 'vitest'
import {
  DependencyCycleError,
  computeLayers,
  deriveState,
  indexById,
  projectCompletion,
  unblocks,
} from './engine'
import type { Issue } from './types'

// Minimal issue factory for tests.
function mk(id: string, deps: string[], wave = 1, done = false): Issue {
  return { id, projectId: 'p', title: id, desc: '', wave, deps, done }
}

// A small graph spanning two waves, exercising cross-wave deps.
//   w1: A -> B,C -> D,E -> F
//   w2: G ; H depends on G and on F (F is wave 1, ignored for w2 layer math)
const ISSUES: Issue[] = [
  mk('A', [], 1, true),
  mk('B', ['A'], 1),
  mk('C', ['A'], 1),
  mk('D', ['B', 'C'], 1),
  mk('E', ['B'], 1),
  mk('F', ['D'], 1),
  mk('G', ['A'], 2),
  mk('H', ['F', 'G'], 2),
]

describe('computeLayers', () => {
  it('computes wave-1 topological depth', () => {
    expect(computeLayers(ISSUES, 1)).toEqual({ 0: ['A'], 1: ['B', 'C'], 2: ['D', 'E'], 3: ['F'] })
  })

  it('ignores cross-wave deps for layer math (H sits right after G)', () => {
    expect(computeLayers(ISSUES, 2)).toEqual({ 0: ['G'], 1: ['H'] })
  })

  it('returns {} for a wave with no issues', () => {
    expect(computeLayers(ISSUES, 99)).toEqual({})
  })

  it('preserves input order within a layer', () => {
    expect(computeLayers(ISSUES, 1)[1]).toEqual(['B', 'C'])
  })

  it('throws DependencyCycleError on a cycle', () => {
    const cyclic = [mk('X', ['Y']), mk('Y', ['X'])]
    expect(() => computeLayers(cyclic, 1)).toThrow(DependencyCycleError)
  })
})

describe('deriveState', () => {
  const byId = indexById(ISSUES)
  it('done issue -> done', () => expect(deriveState(byId['A'], byId)).toBe('done'))
  it('all deps done -> active', () => expect(deriveState(byId['B'], byId)).toBe('active'))
  it('a dep not done -> blocked', () => expect(deriveState(byId['D'], byId)).toBe('blocked'))
  it('no deps, not done -> active', () => expect(deriveState(mk('Z', []), byId)).toBe('active'))
})

describe('unblocks (reverse edges)', () => {
  it('finds issues depending on A across waves', () => {
    expect(unblocks('A', ISSUES).map((i) => i.id)).toEqual(['B', 'C', 'G'])
  })
  it('returns empty when nothing depends on it', () => {
    expect(unblocks('H', ISSUES)).toEqual([])
  })
})

describe('projectCompletion', () => {
  it('is done/total', () => expect(projectCompletion(ISSUES)).toBeCloseTo(1 / 8))
  it('is 0 for no issues', () => expect(projectCompletion([])).toBe(0))
})
