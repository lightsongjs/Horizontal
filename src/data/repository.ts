// Storage-agnostic data access. The app talks only to this interface; the
// concrete backend (local or Supabase) is chosen in ./index.ts by env.

import type { Issue, Project, Theme, Wave } from '../lib/types'

export interface NewProject {
  name: string
  description: string
  prefix: string
  accent?: string
}

export interface NewIssue {
  projectId: string
  title: string
  desc?: string
  theme?: string
  wave?: number
  deps?: string[]
  selectors?: string[]
  scenarios?: { text: string; kind: string }[]
  notes?: string
}

export interface Repository {
  listProjects(): Promise<Project[]>
  /** Creates the project and its first wave ("Val 1"). */
  createProject(input: NewProject): Promise<Project>
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'accent'>>): Promise<Project>
  /** Deletes the project and all its waves, themes, and issues. */
  deleteProject(id: string): Promise<void>

  listWaves(projectId: string): Promise<Wave[]>
  createWave(projectId: string, name: string, label?: string): Promise<Wave>
  updateWave(projectId: string, number: number, patch: Partial<Pick<Wave, 'name' | 'label' | 'position'>>): Promise<Wave>
  deleteWave(projectId: string, number: number): Promise<void>

  listThemes(projectId: string): Promise<Theme[]>
  createTheme(projectId: string, name: string, color: string): Promise<Theme>
  updateTheme(projectId: string, key: string, patch: Partial<Pick<Theme, 'name' | 'color'>>): Promise<Theme>
  /** Deletes the theme and clears it from any issue referencing it. */
  deleteTheme(projectId: string, key: string): Promise<void>

  listIssues(projectId: string): Promise<Issue[]>
  createIssue(input: NewIssue): Promise<Issue>
  updateIssue(id: string, patch: Partial<Issue>): Promise<Issue>
  /** Deletes the issue and any dependency edges referencing it. */
  deleteIssue(id: string): Promise<void>
}

/** Slugify a theme name into a key, unique within `existing`. */
export function themeKey(name: string, existing: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'tema'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}
