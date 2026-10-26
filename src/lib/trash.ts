// Coșul de gunoi — regulile clientului (pure).
//
// Serverul e sursa de adevăr: triggerul `issues_trash` pune deoparte tichetul
// la ștergere, `restore_issue` îl pune la loc (`supabase/migration-trash.sql`).
// Aici stau textele ecranului „Coș" și, pentru modul local (fără Postgres),
// aceeași restaurare scrisă a doua oară: `planRestore`.
//
// Spec: docs/superpowers/specs/2026-10-26-cos-de-gunoi-design.md

import { nextIssueId } from './issueId'
import { dayOffset, toDayMonth } from './schedule'
import type { Issue, IssueEvent, Project } from './types'

/** Câte zile stă un tichet în coș. Același număr ca `purge_expired_trash`. */
export const TRASH_DAYS = 30
const DAY_MS = 86_400_000

/** Un rând din coș, așa cum îl arată ecranul (fără poza întreagă). */
export interface TrashItem {
  /** ID-ul rândului din coș, nu al tichetului. */
  id: string
  issueId: string
  projectId: string
  title: string
  deletedAt: string
  /** Contul care a șters; `null` = o unealtă cu cheia de serviciu sau modul local. */
  deletedBy: string | null
  deletedByName: string | null
}

export interface RestoreResult {
  /** ID-ul cu care a revenit tichetul. */
  id: string
  /** ID-ul pe care îl avea când a fost șters. */
  originalId: string
}

/** Cele mai noi întâi; la egalitate, ID-ul (stabil). */
export function sortTrash<T extends Pick<TrashItem, 'deletedAt' | 'issueId'>>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0))
}

/** „1 zi", „2 zile", „20 de zile" — forma românească de la 20 încolo. */
export function daysWord(n: number): string {
  if (n === 1) return '1 zi'
  const rest = n % 100
  return rest === 0 || rest >= 20 ? `${n} de zile` : `${n} zile`
}

/** Câte zile întregi mai stă în coș (0 = pleacă la următoarea golire). */
export function daysLeft(deletedAt: string, now: Date): number {
  const left = Date.parse(deletedAt) + TRASH_DAYS * DAY_MS - now.getTime()
  return Math.max(0, Math.ceil(left / DAY_MS))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Când a fost șters: „azi 14:05", „ieri 09:10", altfel „11 oct". */
export function deletedWhen(deletedAt: string, now: Date): string {
  const d = new Date(deletedAt)
  const off = dayOffset(deletedAt, now)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (off === 0) return `azi ${hm}`
  if (off === -1) return `ieri ${hm}`
  return d.getFullYear() === now.getFullYear() ? toDayMonth(d) : `${toDayMonth(d)} ${d.getFullYear()}`
}

/** Coada rândului: „Inbox · azi 14:05 · Ion". Fără nume când nu se știe. */
export function trashMeta(item: TrashItem, projectName: string | undefined, now: Date): string {
  return [projectName, deletedWhen(item.deletedAt, now), item.deletedByName].filter(Boolean).join(' · ')
}

/** „încă 29 de zile" / „pleacă azi" — sub listă, pe fiecare rând în `title`. */
export function expiryLabel(deletedAt: string, now: Date): string {
  const n = daysLeft(deletedAt, now)
  return n === 0 ? 'pleacă azi' : `încă ${daysWord(n)}`
}

/**
 * Toastul restaurării. Numărul refolosit între timp („cel mai mare + 1" ia un
 * număr eliberat) se spune: un link vechi la `HZ-12` duce acum la alt tichet.
 */
export function restoreNotice(r: RestoreResult): string {
  return r.id === r.originalId
    ? `${r.id} a revenit.`
    : `${r.originalId} a revenit ca ${r.id} — numărul vechi fusese refolosit.`
}

/** Ce scrie modul local în coș la ștergere — oglinda triggerului. */
export interface LocalTrashEntry extends TrashItem {
  issue: Issue
  /** Tichetele care depindeau DE el (muchiile în celălalt sens stau în `issue.deps`). */
  dependents: string[]
  obstacleIds: string[]
  events: IssueEvent[]
  seenAt: string | null
}

/** Ce se întâmplă la restaurare, în modul local — oglinda lui `restore_issue`. */
export interface RestorePlan {
  issue: Issue
  /** Tichete existente care primesc din nou muchia spre el. */
  dependents: string[]
  obstacleIds: string[]
}

/** `from` ajunge la `to` mergând pe `deps`? */
function reaches(byId: Map<string, Issue>, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const d of byId.get(id)?.deps ?? []) stack.push(d)
  }
  return false
}

/**
 * Restaurarea, aceleași reguli ca SQL-ul: numărul vechi dacă e liber, altfel
 * „cel mai mare + 1"; valul dispărut → valul activ; tema dispărută → fără;
 * dependențele doar spre tichete care există și fără să închidă un ciclu;
 * obstacolele doar cele care mai există.
 */
export function planRestore(
  entry: Pick<LocalTrashEntry, 'issue' | 'dependents' | 'obstacleIds'>,
  ctx: {
    project: Pick<Project, 'prefix' | 'currentWave'>
    issues: Issue[]
    waves: number[]
    themes: string[]
    obstacleIds: string[]
  },
): RestorePlan {
  const { project, issues } = ctx
  const taken = new Set(issues.map((i) => i.id))
  const sameProject = issues.filter((i) => i.projectId === entry.issue.projectId).map((i) => i.id)
  let id = entry.issue.id
  if (taken.has(id)) {
    id = nextIssueId(sameProject, project.prefix)
    // ID-ul e unic în toată baza: unul rămas cu același prefix în alt proiect sare mai departe.
    while (taken.has(id)) id = nextIssueId([...sameProject, id], project.prefix)
  }
  const byId = new Map(issues.map((i) => [i.id, i]))
  // a depinde de b: ciclu dacă b ajunge deja la a.
  const deps = (entry.issue.deps ?? []).filter((b) => byId.has(b) && b !== id && !reaches(byId, b, id))
  const restored: Issue = {
    ...entry.issue,
    id,
    deps,
    wave: ctx.waves.includes(entry.issue.wave) ? entry.issue.wave : project.currentWave,
    theme: entry.issue.theme && !ctx.themes.includes(entry.issue.theme) ? '' : entry.issue.theme,
  }
  byId.set(id, restored)
  const dependents = entry.dependents.filter((a) => byId.has(a) && a !== id && !reaches(byId, id, a))
  return {
    issue: restored,
    dependents,
    obstacleIds: entry.obstacleIds.filter((o) => ctx.obstacleIds.includes(o)),
  }
}
