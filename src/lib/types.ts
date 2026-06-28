// Core domain types for DepFlow. See REQUIREMENTS.md §1 and data-model.json.

export type IssueType = 'external' | 'task' | 'epic'

/** Derived, never stored. See deriveState(). */
export type IssueState = 'done' | 'active' | 'blocked'

export interface Project {
  id: string
  name: string
  description: string
  /** Issue-id prefix, e.g. "TUR". */
  prefix: string
  currentWave: number
  /** Hex accent color. */
  accent: string
}

export interface Theme {
  key: string
  name: string
  /** Hex color. */
  color: string
}

export interface Wave {
  number: number
  name: string
  /** Sub-label, e.g. "MVP". */
  label: string
}

/** A child of an epic. Modeled inline; mirror of an issue with parentId set. */
export interface IssueChild {
  id: string
  title: string
}

export interface Issue {
  id: string
  projectId: string
  title: string
  desc: string
  type: IssueType
  /** Theme key. */
  theme: string
  wave: number
  /** Issue ids this depends on. Global — cross-wave deps are allowed. */
  deps: string[]
  done: boolean
  /** Set on children of an epic; null otherwise. */
  parentId?: string | null
  children?: IssueChild[]
}

/** Output of computeLayers: layer depth -> issue ids, ordered within layer. */
export type Layers = Record<number, string[]>
