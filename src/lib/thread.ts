// Logica pură a firului. Fără DOM, fără rețea — ca engine.ts și schedule.ts.
import type { InboxRow, Issue } from './types'

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
 * de treabă rămasă, nu un istoric. Sortează pe momente, nu șiruri.
 *
 * `null` și date corupte (NaN) se pun la coadă listei: nu-și au loc în
 * ordinea cronologică. Comparatorul nu folosește NaN direct (ar polua ordinea
 * datelor valide din jur) — ci le detectează și le trimite la coadă explicit.
 */
export function groupInbox(rows: readonly InboxRow[]): { fresh: InboxRow[]; rest: InboxRow[] } {
  const open = rows.filter((r) => !r.done)
  const byRecency = [...open].sort((a, b) => {
    let aTime = a.lastEventAt ? Date.parse(a.lastEventAt) : null
    let bTime = b.lastEventAt ? Date.parse(b.lastEventAt) : null

    const aInvalid = aTime === null || isNaN(aTime)
    const bInvalid = bTime === null || isNaN(bTime)

    // Amândouă invalide → egal (păstrează ordinea)
    if (aInvalid && bInvalid) return 0
    // a valid, b invalid → a întâi
    if (!aInvalid && bInvalid) return -1
    // a invalid, b valid → b întâi
    if (aInvalid && !bInvalid) return 1
    // Amândouă valide → sortează descrescător (mai recent întâi)
    return bTime! - aTime!
  })
  return {
    fresh: byRecency.filter((r) => isUnread(r.lastForeignAt, r.seenAt)),
    rest: byRecency.filter((r) => !isUnread(r.lastForeignAt, r.seenAt)),
  }
}

/**
 * Reconciliază instantaneul cutiei de pase cu tichetele DEJA încărcate.
 *
 * `inbox_rows` e o a doua poză a acelorași fapte (`assignee_id`, `done`,
 * titlu), adusă o dată la pornire și la refresh. Fără reconciliere, orice
 * scriere care nu trece prin `post_to_thread` o lăsa în urmă: îți puneai
 * numele pe un tichet din formular și „Ale mele" rămânea gol, îl scoteai și
 * rândul rămânea acolo. Același tipar ca `dueIssues` din store — `allIssues`
 * e mai proaspăt pentru proiectele deschise, deci versiunea de acolo câștigă,
 * iar rezultatul e derivat: nu există al doilea loc de scris.
 *
 * Un tichet dintr-un proiect NEîncărcat nu se atinge — absența lui din
 * `issues` înseamnă „nu știu", nu „nu mai e al meu". Ștergerea îl scoate din
 * `inboxRaw` explicit (store), la fel ca la `dueRaw`.
 *
 * `myAssigneeId` null (cont nelegat de un nume, sau `assignees` încă
 * neîncărcat) nu reconciliază nimic: fără o identitate, „al meu" n-are sens
 * și am goli lista pe baza unei necunoscute.
 */
export function reconcileInbox(
  rows: readonly InboxRow[],
  issues: readonly Issue[],
  myAssigneeId: string | null,
): InboxRow[] {
  if (!myAssigneeId) return [...rows]
  const fresh = new Map(issues.map((i) => [i.id, i]))
  const known = new Set(rows.map((r) => r.issueId))
  const merged: InboxRow[] = []
  for (const r of rows) {
    const live = fresh.get(r.issueId)
    if (!live) { merged.push(r); continue }
    if (live.assigneeId !== myAssigneeId) continue
    merged.push({ ...r, title: live.title, done: live.done, assigneeId: live.assigneeId })
  }
  for (const i of issues) {
    if (i.assigneeId !== myAssigneeId || known.has(i.id)) continue
    // Un tichet care tocmai a devenit al meu n-are fir în poza asta: momentele
    // rămân null (se completează la următorul refresh). E cinstit — „—" în loc
    // de o oră inventată — și îl duce la coada listei, nu în „Necitite".
    merged.push({
      issueId: i.id, projectId: i.projectId, title: i.title, done: i.done,
      assigneeId: i.assigneeId, lastEventAt: null, lastForeignAt: null,
      lastForeignAuthor: null, seenAt: null,
    })
  }
  return merged
}
