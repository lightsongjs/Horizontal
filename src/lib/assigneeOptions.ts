// Lista din selectoarele „către…" (Thread.tsx) și „Assigned to"
// (AssigneeSearch din IssueForm.tsx). Pură, fără rețea — ca engine.ts și
// schedule.ts. Vezi docs/superpowers/specs/2026-09-18-membri-in-selectoare.md.
import type { Assignee, ProjectMember } from './types'

/**
 * O opțiune din listă: fie un rând real din `assignees` (nume liber SAU cont
 * deja legat), fie un cont cu acces la proiect care încă n-are rând —
 * alegerea lui creează rândul (`ensure_project_assignee`), nu funcția asta:
 * e pură.
 */
export type AssigneeOption =
  | { kind: 'assignee'; id: string; name: string; mine: boolean }
  | { kind: 'member'; userId: string; name: string; mine: boolean }

/**
 * Numele de afișat pentru un cont fără rând în `assignees`: partea locală a
 * emailului. Un „undefined" pe ecran ar fi mai rău decât un email trunchiat —
 * și un email întreg, lângă nume ca „Echipa API", arată ca zgomot.
 */
export function memberDisplayName(email: string): string {
  const local = email.split('@')[0]?.trim()
  return local || email
}

/**
 * Întâi conturile (eu primul, dacă am acces la proiect, apoi restul
 * alfabetic), apoi numele libere (alfabetic) — decizia de produs din raport.
 * „Am acces" vine din `members` (rostrul RPC, care include admin-ul chiar
 * fără rând literal în `project_members`), NU dintr-un filtru pe
 * `assignees` — de-aia un cont din `assignees` care nu mai are acces la
 * proiectul curent dispare din listă (drumul înfundat pe care voia să-l evite
 * omul), iar un cont care are acces dar încă n-are rând apare oricum, ca
 * `kind: 'member'`.
 */
export function buildAssigneeOptions(
  assignees: readonly Assignee[],
  members: readonly ProjectMember[],
  myUserId: string | null,
): AssigneeOption[] {
  const byUserId = new Map(
    assignees.filter((a): a is Assignee & { userId: string } => a.userId !== null).map((a) => [a.userId, a]),
  )

  const accounts: AssigneeOption[] = members.map((m) => {
    const mine = m.userId === myUserId
    const existing = byUserId.get(m.userId)
    return existing
      ? { kind: 'assignee', id: existing.id, name: existing.name, mine }
      : { kind: 'member', userId: m.userId, name: memberDisplayName(m.email), mine }
  })
  accounts.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const freeNames: AssigneeOption[] = assignees
    .filter((a) => a.userId === null)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ kind: 'assignee', id: a.id, name: a.name, mine: false }))

  return [...accounts, ...freeNames]
}
