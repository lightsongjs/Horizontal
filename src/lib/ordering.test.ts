import { describe, expect, it } from 'vitest'
import { orderIdsByUrgency, buildOrderedLayers } from './ordering'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Layers } from './types'

function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', urgent: false, ...NO_SCHEDULE, ...patch }
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

  it('în fiecare grupă: restanțele, apoi scadența crescător; fără scadență la coadă, în ordinea de dinainte', () => {
    const at = (iso: string, allDay = false) => ({ dueAt: new Date(iso).toISOString(), allDay })
    const byId = {
      azi21: issue('azi21', at('2026-11-06T21:00')),
      nodate1: issue('nodate1'),
      noi9: issue('noi9', at('2026-11-09T13:00')),
      restanta: issue('restanta', at('2026-11-06T08:00')),
      aziFaraOra: issue('aziFaraOra', at('2026-11-06T00:00', true)),
      nodate2: issue('nodate2'),
      azi12: issue('azi12', at('2026-11-06T12:30')),
      urgMaine: issue('urgMaine', { urgent: true, ...at('2026-11-07T12:00') }),
      urgAzi: issue('urgAzi', { urgent: true, ...at('2026-11-06T10:00') }),
    }
    expect(orderIdsByUrgency(Object.keys(byId), byId)).toEqual(
      ['urgAzi', 'urgMaine', 'restanta', 'azi12', 'azi21', 'aziFaraOra', 'noi9', 'nodate1', 'nodate2'],
    )
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
