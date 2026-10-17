// Sarcinile fixate („Fixează sus", ca Pin din TickTick). Reguli pure, fără
// React și fără I/O — testate în `pinned.test.ts`. Spec:
// docs/superpowers/specs/2026-10-17-sarcini-fixate-design.md
//
// NU e același lucru cu `pins.ts`: acolo sunt pătratele fixate din sertar
// (proiecte, liste, filtre — ale contului, în `pinned_items`). Aici e un câmp
// al tichetului, `issues.pinned_at`, deci un patch de tichet ca oricare altul
// (merge offline prin coadă, ca bifa sau urgentul).

import type { Issue } from './types'

/** Fixat = are `pinnedAt`. Un tichet bifat rămâne fixat, dar nu se arată sus. */
export function isPinned(issue: Pick<Issue, 'pinnedAt'>): boolean {
  return !!issue.pinnedAt
}

/** Fixat ȘI deschis: singurul fel care urcă sus într-o listă. */
export function isPinnedOpen(issue: Pick<Issue, 'pinnedAt' | 'done'>): boolean {
  return !issue.done && isPinned(issue)
}

/**
 * Ordinea între fixate: cel fixat cel mai RECENT primul (ca o stivă — ce ai
 * pus acum sus e ce te interesează acum). La egalitate, după ID, ca ordinea
 * să nu sară între randări.
 */
export function comparePinned(a: Pick<Issue, 'pinnedAt' | 'id'>, b: Pick<Issue, 'pinnedAt' | 'id'>): number {
  const at = a.pinnedAt ? Date.parse(a.pinnedAt) : 0
  const bt = b.pinnedAt ? Date.parse(b.pinnedAt) : 0
  if (at !== bt) return bt - at
  return a.id.localeCompare(b.id)
}

/** Patch-ul comutatorului: fixează acum, sau scoate fixarea. */
export function pinPatch(issue: Pick<Issue, 'pinnedAt'>, now: Date): Pick<Issue, 'pinnedAt'> {
  return { pinnedAt: issue.pinnedAt ? null : now.toISOString() }
}

/**
 * Fixatele deschise urcă primele, în ordinea `comparePinned`; restul își
 * păstrează ordinea primită (sortarea e stabilă). Pentru „Listă" dintr-un
 * proiect: în fiecare grup (layer, temă), nu peste grupuri.
 */
export function pinnedFirst<T extends Pick<Issue, 'pinnedAt' | 'done' | 'id'>>(issues: T[]): T[] {
  const top = issues.filter(isPinnedOpen).sort(comparePinned)
  if (!top.length) return issues
  return [...top, ...issues.filter((i) => !isPinnedOpen(i))]
}

/**
 * Intrarea lui `buildSmartLists`: tichetele cu scadență (fereastra
 * `listDueIssues`) plus fixatele deschise din `openIssues`, care pot fi FĂRĂ
 * scadență — exact cazul „credențialele pentru ANAF". Fără dubluri: un tichet
 * prezent în ambele surse intră o singură dată (varianta din `due`).
 */
export function withPinned(due: Issue[], open: Issue[]): Issue[] {
  const seen = new Set(due.map((i) => i.id))
  const extra = open.filter((i) => isPinnedOpen(i) && !seen.has(i.id))
  return extra.length ? [...due, ...extra] : due
}
