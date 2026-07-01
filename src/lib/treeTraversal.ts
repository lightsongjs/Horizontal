import type { Issue } from './types'

export function getRelatedIds(
  rootId: string,
  byId: Record<string, Issue>
): Set<string> {
  const result = new Set<string>()

  // Ancestors: urcă recursiv prin deps
  function addAncestors(id: string, visited = new Set<string>()) {
    if (visited.has(id)) return
    visited.add(id)
    const issue = byId[id]
    if (!issue) return
    for (const depId of issue.deps ?? []) {
      if (depId !== rootId) result.add(depId)
      addAncestors(depId, visited)
    }
  }

  // Descendants: coboară recursiv prin issues care îl au pe `id` în deps
  function addDescendants(id: string, visited = new Set<string>()) {
    if (visited.has(id)) return
    visited.add(id)
    for (const issue of Object.values(byId)) {
      if ((issue.deps ?? []).includes(id)) {
        if (issue.id !== rootId) result.add(issue.id)
        addDescendants(issue.id, visited)
      }
    }
  }

  addAncestors(rootId)
  addDescendants(rootId)
  return result
}
