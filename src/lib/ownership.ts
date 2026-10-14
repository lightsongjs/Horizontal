import type { Issue } from './types'

/**
 * Cine sunt, pentru regula „al meu". `assigneeId` = rândul meu din `assignees`;
 * `userId` = contul (`auth.users`). Oricare `null` = nu știm cine ești.
 */
export interface Me {
  assigneeId: string | null
  userId: string | null
}

/**
 * E sarcina asta a mea? Regula firului (CLAUDE.md, „Firul și pasarea"):
 * `assignee_id` gol înseamnă „al creatorului".
 *
 *  - pasată mie → da;
 *  - pasată altcuiva → nu;
 *  - nepasată → a creatorului: da dacă eu am creat-o, SAU dacă n-are autor
 *    (`created_by` null: scrisă de o unealtă cu cheia de serviciu, sau un rând
 *    din cache dinaintea coloanei) — un tichet fără stăpân nu dispare.
 *
 * Fără identitate completă (mod local, fără sesiune, cont nelegat de un nume)
 * totul e „al meu": mai bine o listă ca înainte decât sarcini care dispar
 * fără explicație.
 */
export function isMine(issue: Pick<Issue, 'assigneeId' | 'createdBy'>, me: Me): boolean {
  if (me.assigneeId === null || me.userId === null) return true
  if (issue.assigneeId != null) return issue.assigneeId === me.assigneeId
  return issue.createdBy == null || issue.createdBy === me.userId
}

/** `isMine` pe o listă; aceeași referință când nu se poate filtra. */
export function onlyMine<T extends Pick<Issue, 'assigneeId' | 'createdBy'>>(issues: T[], me: Me): T[] {
  if (me.assigneeId === null || me.userId === null) return issues
  return issues.filter((i) => isMine(i, me))
}
