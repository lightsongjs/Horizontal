// Mutarea unui tichet în alt proiect — regulile clientului.
//
// Serverul (`move_issue` din `supabase/migration-move-issue.sql`) e sursa de
// adevăr: regulile de aici există ca să arate motivul ÎNAINTE de a cere, nu în
// locul lui. Clientul vede doar ce e încărcat — dependențele unui tichet dintr-un
// proiect nedeschis pot lipsi —, deci un `null` de aici înseamnă „merită
// încercat", nu „sigur merge". Textele refuzurilor sunt aceleași ca în SQL, ca
// omul să vadă aceeași frază oricare a refuzat.
//
// Spec: docs/superpowers/specs/2026-10-12-mutare-tichet-intre-proiecte-design.md

import { isTempIssueId, nextIssueId } from './issueId'
import { inboxFirst } from './projectOrder'
import type { Issue, ObstacleLink, Project } from './types'

export type MoveBlock =
  /** `HZ-~…`: numărul real încă n-a venit de la server. */
  | { kind: 'temp' }
  /** Depinde de ceva SAU ceva depinde de el — `ids` sunt celelalte capete. */
  | { kind: 'deps'; ids: string[] }
  /** Obstacolele sunt ale proiectului și nu pot urma tichetul. */
  | { kind: 'obstacle' }

/** Sortare ca în SQL: `HZ-3` înaintea lui `HZ-10` (lungime, apoi text). */
const byIdOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

/**
 * De ce NU se poate muta tichetul, după ce știe clientul; `null` = încearcă.
 * `issues` = tichetele încărcate (oricâte proiecte), `links` = legăturile
 * obstacol → tichet încărcate.
 */
export function moveBlock(issue: Issue, issues: Issue[], links: ObstacleLink[]): MoveBlock | null {
  if (isTempIssueId(issue.id)) return { kind: 'temp' }
  const ids = new Set(issue.deps ?? [])
  for (const i of issues) if (i.id !== issue.id && i.deps?.includes(issue.id)) ids.add(i.id)
  if (ids.size) return { kind: 'deps', ids: [...ids].sort(byIdOrder) }
  if (links.some((l) => l.issueId === issue.id)) return { kind: 'obstacle' }
  return null
}

/** Fraza refuzului, identică cu `raise exception` din `move_issue`. */
export function moveBlockMessage(id: string, block: MoveBlock): string {
  switch (block.kind) {
    case 'temp': return 'Nu se poate muta: tichetul încă n-a primit numărul de la server.'
    case 'deps': return `Nu se poate muta ${id}: are dependențe (${block.ids.join(', ')}). Scoate-le întâi.`
    case 'obstacle': return `Nu se poate muta ${id}: e legat de un obstacol. Scoate-l întâi.`
  }
}

export const noWriteMessage = (projectName: string) => `Nu ai drept de editare în proiectul „${projectName}".`
export const MOVE_SYNCING = 'Se sincronizează încă — încearcă peste câteva secunde.'
export const SAME_PROJECT = (projectName: string) => `Tichetul e deja în proiectul „${projectName}".`

/**
 * Proiectele în care se poate muta: cele cu drept de scriere, fără cel de
 * acum, Inbox primul (ca în sertar). Dreptul pe SURSĂ îl verifică apelantul:
 * fără el nu se arată deloc selectorul.
 */
export function moveTargets<P extends Pick<Project, 'id' | 'name'>>(projects: P[], sourceId: string, canWrite: (projectId: string) => boolean): P[] {
  return inboxFirst(projects.filter((p) => p.id !== sourceId && canWrite(p.id)))
}

/**
 * Tichetul așa cum arată după mutare, pentru modul local (serverul își face
 * singur copia). ID nou din `nextIssueId` (același algoritm ca SQL-ul), valul
 * activ al țintei, fără temă (cheile temelor sunt per proiect). Persoana rămâne
 * numai dacă `keepAssignee` — vezi regula din `move_issue`.
 */
export function movedIssue(issue: Issue, target: Pick<Project, 'id' | 'prefix' | 'currentWave'>, existingIds: string[], keepAssignee: boolean): Issue {
  return {
    ...issue,
    id: nextIssueId(existingIds, target.prefix),
    projectId: target.id,
    wave: target.currentWave,
    theme: '',
    assigneeId: keepAssignee ? issue.assigneeId : null,
  }
}

/** Confirmarea: `Mutat în „Apologetica" ca APO-07.` */
export const movedNotice = (projectName: string, id: string) => `Mutat în „${projectName}" ca ${id}.`
