import { inboxProjectId } from './captureTokens'
import type { Project } from './types'

const KEY = 'horizontal:project-order'

export function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

export function saveOrder(ids: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(ids))
}

export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items
  const map = new Map(items.map((p) => [p.id, p]))
  const sorted: T[] = []
  for (const id of order) { const p = map.get(id); if (p) sorted.push(p) }
  for (const p of items) { if (!order.includes(p.id)) sorted.push(p) }
  return sorted
}

/**
 * Inbox stă primul în lista de proiecte, oricare ar fi ordinea manuală: e
 * proiectul în care cade orice captură fără proiect ales, deci trebuie găsit
 * fără căutare. Restul păstrează ordinea dată (cea trasă de om).
 */
export function inboxFirst<P extends Pick<Project, 'id' | 'name'>>(projects: P[]): P[] {
  const id = inboxProjectId(projects)
  if (!id) return projects
  const inbox = projects.find((p) => p.id === id)!
  return [inbox, ...projects.filter((p) => p.id !== id)]
}

/**
 * Ordinea de salvat după ce `dragged` a fost lăsat peste `target`, în lista
 * AFIȘATĂ (cu Inbox primul). Inbox nu se mută, iar nimic nu ajunge înaintea
 * lui: lăsat peste Inbox, proiectul trece imediat după el. Întoarce `null`
 * când nu e nimic de schimbat.
 */
export function reorderWithInboxFirst<P extends Pick<Project, 'id' | 'name'>>(
  projects: P[],
  dragged: string,
  target: string,
): string[] | null {
  const ids = inboxFirst(projects).map((p) => p.id)
  const inbox = inboxProjectId(projects)
  if (dragged === target || dragged === inbox) return null
  const from = ids.indexOf(dragged)
  let to = ids.indexOf(target)
  if (from === -1 || to === -1) return null
  if (target === inbox) to = 1
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, dragged)
  return next.join() === ids.join() ? null : next
}
