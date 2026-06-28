// Pure layer/wave engine. No I/O, no React — unit-tested against the fixtures
// in data-model.json (see engine.test.ts). Algorithm: REQUIREMENTS.md §1 + §4.

import type { Issue, IssueState, Layers } from './types'

/** Thrown when dependencies within a wave form a cycle. */
export class DependencyCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(' → ')}`)
    this.name = 'DependencyCycleError'
  }
}

export function indexById(issues: Issue[]): Record<string, Issue> {
  const map: Record<string, Issue> = {}
  for (const it of issues) map[it.id] = it
  return map
}

/**
 * Topological depth of each issue, computed using ONLY issues in the given
 * wave. Dependencies pointing outside the wave are ignored for the math.
 *
 *   depth(id) = deps-in-wave.length ? 1 + max(depth(d)) : 0
 *
 * Returns { layerDepth: issueIds[] }. Within a layer, ids keep their input
 * order. Throws DependencyCycleError if the in-wave deps form a cycle.
 */
export function computeLayers(issues: Issue[], wave: number): Layers {
  const inWave = issues.filter((it) => it.wave === wave)
  const set = new Set(inWave.map((it) => it.id))
  const byId = indexById(inWave)

  const memo: Record<string, number> = {}
  const VISITING = -1

  const depth = (id: string, trail: string[]): number => {
    const cached = memo[id]
    if (cached === VISITING) {
      const start = trail.indexOf(id)
      throw new DependencyCycleError(trail.slice(start >= 0 ? start : 0).concat(id))
    }
    if (cached != null) return cached

    memo[id] = VISITING
    const deps = (byId[id]?.deps ?? []).filter((d) => set.has(d))
    const d = deps.length
      ? 1 + Math.max(...deps.map((dep) => depth(dep, [...trail, id])))
      : 0
    memo[id] = d
    return d
  }

  const layers: Layers = {}
  for (const it of inWave) {
    const d = depth(it.id, [])
    ;(layers[d] ??= []).push(it.id)
  }
  return layers
}

/**
 * Derived state of an issue. `done` is user-set; the rest is computed from
 * whether EVERY dependency (across ALL waves) is done.
 */
export function deriveState(issue: Issue, byId: Record<string, Issue>): IssueState {
  if (issue.done) return 'done'
  const allDepsDone = (issue.deps ?? []).every((d) => byId[d]?.done)
  return allDepsDone ? 'active' : 'blocked'
}

/** Reverse edges: issues that depend on `issueId` (i.e. it unblocks them). */
export function unblocks(issueId: string, issues: Issue[]): Issue[] {
  return issues.filter((it) => (it.deps ?? []).includes(issueId))
}

/** Completion ratio for a set of issues (done / total), in [0, 1]. */
export function projectCompletion(issues: Issue[]): number {
  if (!issues.length) return 0
  const done = issues.filter((it) => it.done).length
  return done / issues.length
}

/** Sorted, ascending list of layer depths present in a Layers map. */
export function layerKeys(layers: Layers): number[] {
  return Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b)
}
