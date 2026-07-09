// Pure UI-layer ordering. The engine (computeLayers) keeps input order within a
// layer; urgency is applied here so the engine and its fixtures stay untouched.

import type { Issue, Layers } from './types'
import { layerKeys } from './engine'

/** Stable partition: urgent ids first, original order preserved otherwise. */
export function orderIdsByUrgency(ids: string[], byId: Record<string, Issue>): string[] {
  const urgent: string[] = []
  const rest: string[] = []
  for (const id of ids) {
    if (byId[id]?.urgent) urgent.push(id)
    else rest.push(id)
  }
  return [...urgent, ...rest]
}

export interface OrderedLayer {
  L: number
  ids: string[]
}

/**
 * Layer groups sorted by depth, each layer's ids sorted urgent-first. When
 * hideDone is true, done ids are dropped and emptied layers removed.
 */
export function buildOrderedLayers(
  layers: Layers,
  byId: Record<string, Issue>,
  hideDone: boolean,
): OrderedLayer[] {
  return layerKeys(layers)
    .map((L) => {
      let ids = layers[L]
      if (hideDone) ids = ids.filter((id) => !byId[id]?.done)
      return { L, ids: orderIdsByUrgency(ids, byId) }
    })
    .filter((group) => group.ids.length > 0)
}
