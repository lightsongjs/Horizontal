// Pure UI-layer ordering. The engine (computeLayers) keeps input order within a
// layer; urgency is applied here so the engine and its fixtures stay untouched.

import type { Issue, Layers } from './types'
import { layerKeys } from './engine'
import { hasTime, startOfLocalDay } from './schedule'

/**
 * Scadența, în interiorul unei grupe (decizia omului, 2026-11-06): restanțele
 * primele, apoi de la cea mai apropiată la cea mai îndepărtată — ziua întâi,
 * iar în aceeași zi cele cu oră cronologic, înaintea celor fără oră (ca
 * `compareDue`). Fără scadență = la coadă, în ordinea de dinainte (sortare stabilă).
 */
function compareDueOnly(a: Issue | undefined, b: Issue | undefined): number {
  const ad = a?.dueAt ? new Date(a.dueAt) : null
  const bd = b?.dueAt ? new Date(b.dueAt) : null
  if (!ad || !bd) return ad ? -1 : bd ? 1 : 0
  const day = startOfLocalDay(ad).getTime() - startOfLocalDay(bd).getTime()
  if (day !== 0) return day
  if (hasTime(a!) !== hasTime(b!)) return hasTime(a!) ? -1 : 1
  return ad.getTime() - bd.getTime()
}

/** Stable partition: urgent ids first; within each group by due date (`compareDueOnly`), original order otherwise. */
export function orderIdsByUrgency(ids: string[], byId: Record<string, Issue>): string[] {
  const urgent: string[] = []
  const rest: string[] = []
  for (const id of ids) {
    if (byId[id]?.urgent) urgent.push(id)
    else rest.push(id)
  }
  const byDue = (x: string, y: string) => compareDueOnly(byId[x], byId[y])
  return [...urgent.sort(byDue), ...rest.sort(byDue)]
}

export interface OrderedLayer {
  L: number
  ids: string[]
}

/**
 * Layer groups sorted by depth, each layer's ids sorted urgent-first. When
 * hideDone is true, done ids are dropped and emptied layers removed.
 *
 * Când e dat `blockedIds`, partiția e stabilă: liberele înainte de cele
 * blocate de un obstacol, urgența aplicată în interiorul fiecărei grupe.
 *
 * De ce blocarea bate urgența: un tichet urgent dar blocat nu are ce să facă
 * sus în listă — e o promisiune pe care lista n-o poate ține. Urgent înseamnă
 * „fă-l primul", și nu se poate.
 */
export function buildOrderedLayers(
  layers: Layers,
  byId: Record<string, Issue>,
  hideDone: boolean,
  blockedIds?: Set<string>,
): OrderedLayer[] {
  return layerKeys(layers)
    .map((L) => {
      let ids = layers[L]
      if (hideDone) ids = ids.filter((id) => !byId[id]?.done)
      if (blockedIds?.size) {
        const free = orderIdsByUrgency(ids.filter((id) => !blockedIds.has(id)), byId)
        const blocked = orderIdsByUrgency(ids.filter((id) => blockedIds.has(id)), byId)
        return { L, ids: [...free, ...blocked] }
      }
      return { L, ids: orderIdsByUrgency(ids, byId) }
    })
    .filter((group) => group.ids.length > 0)
}
