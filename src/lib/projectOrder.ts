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
