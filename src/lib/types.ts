// Core domain types for DepFlow. See REQUIREMENTS.md §1.
// Simple issues (no type/epic/children). Waves and themes are per-project and
// user-managed.

/** Derived, never stored. See deriveState(). */
export type IssueState = 'done' | 'active' | 'blocked'

export interface Assignee {
  id: string
  name: string
}

export interface Project {
  id: string
  name: string
  description: string
  /** Issue-id prefix, e.g. "TUR". */
  prefix: string
  currentWave: number
  /** Hex accent color. */
  accent: string
  type: 'personal' | 'work'
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

export interface Theme {
  projectId: string
  /** Stable key, unique within a project. */
  key: string
  name: string
  /** Hex color. */
  color: string
}

export type ScenarioKind = 'pass' | 'fail' | 'neutral'

export interface TestScenario {
  text: string
  kind: ScenarioKind
}

export interface Issue {
  id: string
  projectId: string
  title: string
  desc: string
  /** Theme key (within the project), or '' if none. */
  theme: string
  wave: number
  /** Issue ids this depends on. Global — cross-wave deps are allowed. */
  deps: string[]
  done: boolean
  /** Playwright locator strings. */
  selectors: string[]
  scenarios: TestScenario[]
  notes: string
  assigneeId: string | null
}

/** Output of computeLayers: layer depth -> issue ids, ordered within layer. */
export type Layers = Record<number, string[]>
