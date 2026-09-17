// Logica pură a firului. Fără DOM, fără rețea — ca engine.ts și schedule.ts.
import type { InboxRow } from './types'

/**
 * Compară momente, nu șiruri: formatări diferite ale aceluiași moment
 * (Z vs +00:00, milisecunde vs microsecunde) pot veni din surse diferite
 * și trebuie să compareze corect. `null` = nimeni străin n-a scris niciodată.
 *
 * O dată coruptă (NaN) din oricare sursă e de pe latura sigură: nu-și pierde
 * o pasă prin „nu vad bulina". seenAt corupt cere aceeași alegere — dacă
 * nu-l poți citi, e ca și cum n-ai fi vizitat niciodată.
 */
export function isUnread(lastForeignAt: string | null, seenAt: string | null): boolean {
  if (!lastForeignAt) return false
  if (!seenAt) return true
  const lastForeignTime = Date.parse(lastForeignAt)
  const seenTime = Date.parse(seenAt)
  // O dată pe care nu o poți citi (NaN) e tratată ca „necitit"
  if (isNaN(lastForeignTime) || isNaN(seenTime)) return true
  return lastForeignTime > seenTime
}

/**
 * „Necitite" / „Mai devreme". Bifatele nu apar deloc: cutia de pase e o listă
 * de treabă rămasă, nu un istoric. Sortează pe momente, nu șiruri: un
 * `lastEventAt: null` trebuie pus la coadă, nu să dea NaN.
 */
export function groupInbox(rows: readonly InboxRow[]): { fresh: InboxRow[]; rest: InboxRow[] } {
  const open = rows.filter((r) => !r.done)
  const byRecency = [...open].sort((a, b) => {
    const aTime = a.lastEventAt ? Date.parse(a.lastEventAt) : 0
    const bTime = b.lastEventAt ? Date.parse(b.lastEventAt) : 0
    return bTime - aTime
  })
  return {
    fresh: byRecency.filter((r) => isUnread(r.lastForeignAt, r.seenAt)),
    rest: byRecency.filter((r) => !isUnread(r.lastForeignAt, r.seenAt)),
  }
}
