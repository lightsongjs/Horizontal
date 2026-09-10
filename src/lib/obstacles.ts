// Motorul obstacolelor. Pur: fără I/O, fără React — testat pe fixtures ca
// engine.ts, schedule.ts și parseDue.ts.
//
// De ce e separat de engine.ts: obstacolele nu au val, deci nu intră în
// computeLayers. Layerul unui tichet nu se mișcă niciodată la depășirea unui
// obstacol — altfel numărul layerului, singurul lucru stabil din aplicație, ar
// depinde de viteza cu care răspund alte echipe.

import type { Issue, Obstacle, ObstacleLink } from './types'

/** Stările în care un obstacol e închis prin el însuși. */
const CLOSED = new Set(['depasit', 'ocolit'])

/**
 * Obstacolele **efectiv** deschise. Un obstacol e efectiv deschis dacă starea
 * lui e deschisă SAU oricare obstacol de care depinde e efectiv deschis:
 * „#19 câte tool-uri" e depășit în teorie, dar dacă „#1 cine e utilizatorul" e
 * încă deschis, răspunsul lui nu ține.
 *
 * Un ciclu nu aruncă — se tratează ca deschis și se lasă `detectObstacleCycle`
 * să-l raporteze la scriere. O funcție pură chemată la fiecare randare nu are
 * voie să dea eroare pe date deja salvate.
 */
export function openObstacles(obstacles: Obstacle[]): Set<string> {
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o

  const memo: Record<string, boolean> = {}
  const VISITING = 'visiting'
  const mark: Record<string, string> = {}

  const isOpen = (id: string): boolean => {
    const cached = memo[id]
    if (cached !== undefined) return cached
    if (mark[id] === VISITING) return true // ciclu
    const o = byId[id]
    if (!o) return false
    mark[id] = VISITING
    const open = !CLOSED.has(o.state) || o.deps.some((d) => byId[d] && isOpen(d))
    delete mark[id]
    memo[id] = open
    return open
  }

  const out = new Set<string>()
  for (const o of obstacles) if (isOpen(o.id)) out.add(o.id)
  return out
}

/**
 * issueId → id-urile obstacolelor deschise ȘI blocante care îl ating, în
 * ordinea `position`. Singura poartă prin care UI-ul află că un tichet e
 * blocat de un obstacol; nicio componentă nu recalculează asta.
 *
 * Tichetele bifate nu se raportează blocate: „gata" bate orice condiție.
 */
export function blockedBy(
  issues: Issue[],
  obstacles: Obstacle[],
  links: ObstacleLink[],
): Record<string, string[]> {
  const open = openObstacles(obstacles)
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o
  const live = new Map(issues.filter((i) => !i.done).map((i) => [i.id, i]))

  const out: Record<string, string[]> = {}
  for (const { obstacleId, issueId } of links) {
    const o = byId[obstacleId]
    if (!o || !o.blocking || !open.has(obstacleId)) continue
    if (!live.has(issueId)) continue
    ;(out[issueId] ??= []).push(obstacleId)
  }
  for (const ids of Object.values(out)) {
    ids.sort((a, b) => (byId[a].position - byId[b].position) || a.localeCompare(b))
  }
  return out
}

/** Zile întregi de la `askedAt`. Doar în `asteptare`; null altfel. */
export function waitingDays(o: Obstacle, now: Date): number | null {
  if (o.state !== 'asteptare' || !o.askedAt) return null
  const ms = now.getTime() - new Date(o.askedAt).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** Ciclu în dependențele dintre obstacole, ca traseu ordonat, sau null. */
export function detectObstacleCycle(obstacles: Obstacle[]): string[] | null {
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o
  const GRAY = 1
  const BLACK = 2
  const color: Record<string, number> = {}
  const stack: string[] = []
  let found: string[] | null = null

  const dfs = (id: string): boolean => {
    color[id] = GRAY
    stack.push(id)
    for (const d of byId[id]?.deps ?? []) {
      if (!byId[d]) continue
      if (color[d] === GRAY) {
        found = stack.slice(stack.indexOf(d)).concat(d)
        return true
      }
      if (color[d] === undefined && dfs(d)) return true
    }
    color[id] = BLACK
    stack.pop()
    return false
  }

  for (const o of obstacles) {
    if (color[o.id] === undefined && dfs(o.id)) break
  }
  return found
}
