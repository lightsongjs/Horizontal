// Ce vede restul aplicației din stratul offline. Opțional pe `Repository`:
// modul local (`localRepository`) n-are nici cache, nici coadă, și n-are nevoie.

import type { Assignee, InboxRow, Issue, Obstacle, ObstacleLink, Project, ProjectMember, Theme, Wave } from '../../lib/types'
import type { DueRange } from '../repository'

/** `syncing`: o golire chiar trimite acum — altfel o coadă oprită s-ar fi
 *  anunțat „se trimite" la nesfârșit. */
export interface SyncStatus { offline: boolean; pending: number; syncing: boolean }

export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  /** Varianta de acum a unui tichet (de la server, sau ecoul din altă filă). */
  | { type: 'issue'; issue: Issue }
  | { type: 'removed'; ids: string[] }
  /** Un tichet creat offline a primit numărul real. */
  | { type: 'remap'; from: string; to: string }
  /** Serverul a refuzat o scriere. `revert` = valoarea lui de acum, sau null dacă tichetul nu mai există. */
  | { type: 'failed'; message: string; issueId: string | null; revert: Issue | null }

export interface ProjectBundle {
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  obstacles: Obstacle[]
  obstacleLinks: ObstacleLink[]
  members: ProjectMember[]
}

/** Citiri DOAR din cache, fără rețea — pentru primul cadru. `null` = nu există încă. */
export interface CacheReader {
  projects(): Promise<Project[] | null>
  assignees(): Promise<Assignee[] | null>
  project(id: string): Promise<ProjectBundle | null>
  due(range: DueRange): Promise<Issue[] | null>
  inbox(): Promise<InboxRow[] | null>
}

export interface SyncControl {
  status(): SyncStatus
  subscribe(fn: (e: SyncEvent) => void): () => void
  flush(): Promise<void>
  /** Aduce în cache TOATE proiectele, nu doar cel deschis — altfel unul
   *  nedeschis recent n-ar avea nimic de arătat offline. */
  prefetchAll(): Promise<void>
  /** ID-ul real al unui provizoriu deja remapat (sau ID-ul neschimbat). Sincron, din memorie. */
  resolveId(id: string): string
  /** Logout: baza și coada de pe dispozitivul ăsta dispar. */
  clear(): Promise<void>
}
