// Filtrele salvate: liste personale, transversale pe proiecte, numai cu
// tichete DESCHISE. Pur, ca `schedule.ts` — store-ul dă tichetele, ecranul
// dă regulile, aici se decide cine trece și în ce ordine.
//
// Forma regulilor: rânduri de condiții, OR în interiorul unui rând (oricare
// dintre proiectele alese), AND între rânduri (și proiect, și persoană, și
// scadență). Un rând gol nu filtrează nimic — „oricare".

import { compareDue, dayOffset, isOverdue, SMART_LIST_DAYS } from './schedule'
import { isDormant } from './routines'
import type { Assignee, Issue, Project } from './types'

/** Scadența, în aceleași găleți ca listele inteligente. */
export type DueBucket = 'overdue' | 'today' | 'week' | 'none'
export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: 'overdue', label: 'Restanță' },
  { key: 'today', label: 'Azi' },
  { key: 'week', label: '7 zile' },
  { key: 'none', label: 'Fără dată' },
]

/** „Eu" ca persoană: contul curent, oricare i-ar fi rândul din `assignees`. */
export const ME = 'me'

export interface FilterRules {
  /** Id-uri de proiect. Gol = toate. */
  projects: string[]
  /** Id-uri de `assignees`, sau `ME`. Gol = oricine. */
  people: string[]
  /** Gol = oricând (inclusiv fără dată). */
  due: DueBucket[]
  /** `true` = doar urgente; `false` = indiferent. */
  urgent: boolean
}

export const EMPTY_RULES: FilterRules = { projects: [], people: [], due: [], urgent: false }

/** Setul mic de iconițe din care se alege (nume de rol din `Icon.tsx`). */
export const FILTER_ICONS = ['filter', 'people', 'urgent', 'star', 'flag', 'work', 'home', 'tag', 'today', 'inbox'] as const
export type FilterIcon = (typeof FILTER_ICONS)[number]

export interface SavedFilter {
  id: string
  name: string
  icon: FilterIcon
  rules: FilterRules
  position: number
}

export const isFilterIcon = (v: unknown): v is FilterIcon =>
  typeof v === 'string' && (FILTER_ICONS as readonly string[]).includes(v)

/**
 * Regulile citite din bază (`jsonb`), puse în formă. Defensiv, nu încrezător:
 * un rând scris de o versiune viitoare (o cheie nouă, o găleată nouă) nu are
 * voie să spargă ecranul — ce nu se recunoaște cade, restul rămâne.
 */
export function normalizeRules(raw: unknown): FilterRules {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : [])
  const buckets = DUE_BUCKETS.map((b) => b.key) as string[]
  return {
    projects: strings(o.projects),
    people: strings(o.people),
    due: strings(o.due).filter((d): d is DueBucket => buckets.includes(d)),
    urgent: o.urgent === true,
  }
}

export interface MatchContext {
  now: Date
  assignees: readonly Pick<Assignee, 'id' | 'userId'>[]
  /** Eu: rândul meu din `assignees` (dacă sunt legat) și contul meu. */
  me: { assigneeId: string | null; userId: string | null }
  /** Proiectele „doar mementouri": rutinele adormite nu apar nici aici. */
  routines?: Set<string>
}

/**
 * Persoana X se potrivește dacă tichetul e PASAT ei (`assignee_id = X`) SAU e
 * nepasat și CREAT de contul ei (decizia omului: „ale Clarei" = pasate ei +
 * create de ea nepasate). Exact regula firului: `assignee_id` gol înseamnă
 * „al creatorului".
 */
export function personMatches(issue: Pick<Issue, 'assigneeId' | 'createdBy'>, person: string, ctx: MatchContext): boolean {
  const assigneeId = person === ME ? ctx.me.assigneeId : person
  const userId = person === ME ? ctx.me.userId : ctx.assignees.find((a) => a.id === person)?.userId ?? null
  if (assigneeId !== null && issue.assigneeId === assigneeId) return true
  return issue.assigneeId === null && userId !== null && issue.createdBy === userId
}

export function dueBucketMatches(issue: Pick<Issue, 'dueAt' | 'allDay' | 'done'>, bucket: DueBucket, now: Date): boolean {
  if (bucket === 'none') return !issue.dueAt
  if (!issue.dueAt) return false
  const overdue = isOverdue(issue, now)
  if (bucket === 'overdue') return overdue
  if (overdue) return false
  const off = dayOffset(issue.dueAt, now)
  return bucket === 'today' ? off === 0 : off >= 0 && off < SMART_LIST_DAYS
}

export function matchesFilter(issue: Issue, rules: FilterRules, ctx: MatchContext): boolean {
  if (issue.done) return false
  if (ctx.routines && isDormant(issue, ctx.routines, ctx.now)) return false
  if (rules.projects.length && !rules.projects.includes(issue.projectId)) return false
  if (rules.urgent && !issue.urgent) return false
  if (rules.people.length && !rules.people.some((p) => personMatches(issue, p, ctx))) return false
  if (rules.due.length && !rules.due.some((b) => dueBucketMatches(issue, b, ctx.now))) return false
  return true
}

/** Cu dată întâi (ca în liste), apoi cele fără dată: urgentele sus, apoi după număr. */
export function compareFilterRows(a: Issue, b: Issue): number {
  if (!!a.dueAt !== !!b.dueAt) return a.dueAt ? -1 : 1
  if (a.dueAt && b.dueAt) return compareDue(a, b)
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
  return a.id.localeCompare(b.id, undefined, { numeric: true })
}

export function filterIssues(issues: readonly Issue[], rules: FilterRules, ctx: MatchContext): Issue[] {
  return issues.filter((i) => matchesFilter(i, rules, ctx)).sort(compareFilterRows)
}

/**
 * Grupate pe proiect (cerința omului: „tichetele lui Mihai grupate pe fiecare
 * proiect"), în ordinea proiectelor din sidebar. Un tichet al unui proiect
 * necunoscut (încă neîncărcat) iese la coadă, nu dispare.
 */
export function groupByProject(issues: readonly Issue[], projects: readonly Pick<Project, 'id'>[]): { projectId: string; issues: Issue[] }[] {
  const by = new Map<string, Issue[]>()
  for (const i of issues) {
    const list = by.get(i.projectId)
    if (list) list.push(i)
    else by.set(i.projectId, [i])
  }
  const out: { projectId: string; issues: Issue[] }[] = []
  for (const p of projects) {
    const list = by.get(p.id)
    if (list) { out.push({ projectId: p.id, issues: list }); by.delete(p.id) }
  }
  for (const [projectId, list] of by) out.push({ projectId, issues: list })
  return out
}

/** Subtitlul filtrului, în cuvinte: „Mihai · azi, restanță · urgente". */
export function describeRules(
  rules: FilterRules,
  names: { project(id: string): string | undefined; person(id: string): string | undefined },
): string {
  const parts: string[] = []
  if (rules.people.length) parts.push(rules.people.map((p) => (p === ME ? 'eu' : names.person(p) ?? '?')).join(', '))
  if (rules.projects.length === 1) parts.push(names.project(rules.projects[0]) ?? '1 proiect')
  else if (rules.projects.length > 1) parts.push(`${rules.projects.length} proiecte`)
  if (rules.due.length) parts.push(rules.due.map((d) => DUE_BUCKETS.find((b) => b.key === d)!.label.toLowerCase()).join(', '))
  if (rules.urgent) parts.push('urgente')
  return parts.length ? parts.join(' · ') : 'toate tichetele deschise'
}
