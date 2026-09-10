import { describe, expect, it } from 'vitest'
import { orderIdsByUrgency, buildOrderedLayers } from './ordering'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Layers } from './types'

function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE, ...patch }
}

describe('orderIdsByUrgency', () => {
  it('puts urgent ids first, preserving original order within each group (stable)', () => {
    const byId = {
      a: issue('a'), b: issue('b', { urgent: true }), c: issue('c'), d: issue('d', { urgent: true }),
    }
    expect(orderIdsByUrgency(['a', 'b', 'c', 'd'], byId)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('is a no-op when nothing is urgent', () => {
    const byId = { a: issue('a'), b: issue('b') }
    expect(orderIdsByUrgency(['a', 'b'], byId)).toEqual(['a', 'b'])
  })

  it('tolerates ids missing from byId (treats as non-urgent)', () => {
    const byId = { a: issue('a', { urgent: true }) }
    expect(orderIdsByUrgency(['a', 'ghost'], byId)).toEqual(['a', 'ghost'])
  })
})

describe('buildOrderedLayers', () => {
  const byId = {
    a: issue('a'), b: issue('b', { urgent: true }), c: issue('c', { done: true }),
  }
  const layers: Layers = { 0: ['a', 'b'], 1: ['c'] }

  it('returns groups sorted by layer key, urgent-first within each layer', () => {
    expect(buildOrderedLayers(layers, byId, false)).toEqual([
      { L: 0, ids: ['b', 'a'] },
      { L: 1, ids: ['c'] },
    ])
  })

  it('drops done ids and then empty layers when hideDone is true', () => {
    expect(buildOrderedLayers(layers, byId, true)).toEqual([
      { L: 0, ids: ['b', 'a'] },
    ])
  })
})

describe('tichetele blocate de obstacol', () => {
  it('coboară la finalul layerului, sub cele libere', () => {
    const byId = { A: issue('A'), B: issue('B'), C: issue('C'), D: issue('D') }
    const layers: Layers = { 0: ['A', 'B', 'C', 'D'] }
    const blocked = new Set(['A', 'C'])
    expect(buildOrderedLayers(layers, byId, false, blocked)[0].ids).toEqual(['B', 'D', 'A', 'C'])
  })

  it('urgența bate ordinea de blocare doar între tichete libere', () => {
    // Un tichet urgent DAR blocat nu are ce să facă sus: e o promisiune pe care
    // lista n-o poate ține. Urgența ordonează în interiorul fiecărei grupe.
    const byId = { A: issue('A'), U: issue('U', { urgent: true }), V: issue('V', { urgent: true }) }
    const layers: Layers = { 0: ['A', 'U', 'V'] }
    const blocked = new Set(['U'])
    expect(buildOrderedLayers(layers, byId, false, blocked)[0].ids).toEqual(['V', 'A', 'U'])
  })

  it('fără al patrulea argument se comportă exact ca înainte', () => {
    const byId = { A: issue('A'), B: issue('B') }
    const layers: Layers = { 0: ['A', 'B'] }
    expect(buildOrderedLayers(layers, byId, false)[0].ids).toEqual(['A', 'B'])
  })
})
