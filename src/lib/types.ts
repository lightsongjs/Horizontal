// Core domain types for DepFlow. See REQUIREMENTS.md §1.
// User's model: simple issues (no type/epic/children). Waves are per-project
// and user-managed. Themes are deferred to a later phase.

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

export interface Wave {
  projectId: string
  /** Wave number, unique within a project; also the layer-math wave id. */
  number: number
  name: string
  /** Sub-label, e.g. "MVP". */
  label: string
  /** Ordering within the project's wave list. */
  position: number
}

export interface Issue {
  id: string
  projectId: string
  title: string
  desc: string
  wave: number
  /** Issue ids this depends on. Global — cross-wave deps are allowed. */
  deps: string[]
  done: boolean
}

/** Output of computeLayers: layer depth -> issue ids, ordered within layer. */
export type Layers = Record<number, string[]>
