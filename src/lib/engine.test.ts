import { describe, expect, it } from 'vitest'
import {
  DependencyCycleError,
  computeLayers,
  deriveState,
  indexById,
  projectCompletion,
  unblocks,
} from './engine'
import { SEED_ISSUES } from './seed'
import type { Issue } from './types'

// Fixtures from data-model.json → _EXPECTED_LAYERS.
const EXPECTED = {
  wave1: { 0: ['TUR-01'], 1: ['TUR-02', 'TUR-03'], 2: ['TUR-04', 'TUR-05'], 3: ['TUR-06'], 4: ['TUR-08'] },
  wave2: { 0: ['TUR-API'], 1: ['TUR-07'] },
}

describe('computeLayers', () => {
  it('matches the expected layers for wave 1', () => {
    expect(computeLayers(SEED_ISSUES, 1)).toEqual(EXPECTED.wave1)
  })

  it('matches the expected layers for wave 2 (cross-wave dep TUR-06 ignored)', () => {
    // TUR-07 depends on TUR-06 (wave 1) and TUR-API (wave 2). Only TUR-API
    // counts for layer math, so TUR-07 sits at layer 1, not layer 4.
    expect(computeLayers(SEED_ISSUES, 2)).toEqual(EXPECTED.wave2)
  })

  it('returns an empty object for a wave with no issues', () => {
    expect(computeLayers(SEED_ISSUES, 99)).toEqual({})
  })

  it('preserves input order within a layer', () => {
    expect(computeLayers(SEED_ISSUES, 1)[1]).toEqual(['TUR-02', 'TUR-03'])
  })

  it('throws DependencyCycleError on a cycle', () => {
    const cyclic: Issue[] = [
      { id: 'A', projectId: 'p', title: 'A', desc: '', type: 'task', theme: 't', wave: 1, deps: ['B'], done: false },
      { id: 'B', projectId: 'p', title: 'B', desc: '', type: 'task', theme: 't', wave: 1, deps: ['A'], done: false },
    ]
    expect(() => computeLayers(cyclic, 1)).toThrow(DependencyCycleError)
  })
})

describe('deriveState', () => {
  const byId = indexById(SEED_ISSUES)

  it('done issue → done', () => {
    expect(deriveState(byId['TUR-01'], byId)).toBe('done')
  })

  it('all deps done → active', () => {
    // TUR-02 depends only on TUR-01 (done).
    expect(deriveState(byId['TUR-02'], byId)).toBe('active')
  })

  it('a dep not done → blocked', () => {
    // TUR-04 depends on TUR-02 + TUR-03, neither done.
    expect(deriveState(byId['TUR-04'], byId)).toBe('blocked')
  })

  it('no deps and not done → active', () => {
    const orphan: Issue = { id: 'X', projectId: 'p', title: '', desc: '', type: 'task', theme: 't', wave: 1, deps: [], done: false }
    expect(deriveState(orphan, byId)).toBe('active')
  })
})

describe('unblocks (reverse edges)', () => {
  it('finds issues depending on TUR-02 across waves', () => {
    const ids = unblocks('TUR-02', SEED_ISSUES).map((i) => i.id)
    expect(ids).toEqual(['TUR-04', 'TUR-05', 'TUR-API'])
  })

  it('returns empty when nothing depends on it', () => {
    expect(unblocks('TUR-08', SEED_ISSUES)).toEqual([])
  })
})

describe('projectCompletion', () => {
  it('is done/total', () => {
    // 1 of 9 issues done.
    expect(projectCompletion(SEED_ISSUES)).toBeCloseTo(1 / 9)
  })

  it('is 0 for no issues', () => {
    expect(projectCompletion([])).toBe(0)
  })
})
