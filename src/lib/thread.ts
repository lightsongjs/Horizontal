// Logica pură a firului. Fără DOM, fără rețea — ca engine.ts și schedule.ts.
import type { InboxRow } from './types'

/**
 * `lastForeignAt` e deja filtrat de evenimentele mele (vine din `inbox_rows`),
 * deci regula „propriul comentariu nu aprinde bulina" e ținută de sursă, nu
 * repetată aici. `null` = nimeni străin n-a scris niciodată.
 */
export function isUnread(lastForeignAt: string | null, seenAt: string | null): boolean {
  if (!lastForeignAt) return false
  if (!seenAt) return true
  return lastForeignAt > seenAt
}

/**
 * „Necitite" / „Mai devreme". Bifatele nu apar deloc: cutia de pase e o listă
 * de treabă rămasă, nu un istoric.
 */
export function groupInbox(rows: readonly InboxRow[]): { fresh: InboxRow[]; rest: InboxRow[] } {
  const open = rows.filter((r) => !r.done)
  const byRecency = [...open].sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''))
  return {
    fresh: byRecency.filter((r) => isUnread(r.lastForeignAt, r.seenAt)),
    rest: byRecency.filter((r) => !isUnread(r.lastForeignAt, r.seenAt)),
  }
}
