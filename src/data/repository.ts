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
  type?: Issue['type']
  theme?: string
  wave?: number
  deps?: string[]
  parentId?: string | null
}

export interface Repository {
  listProjects(): Promise<Project[]>
  createProject(input: NewProject): Promise<Project>

  listThemes(): Promise<Theme[]>
  createTheme(theme: Theme): Promise<Theme>

  listWaves(): Promise<Wave[]>

  listIssues(projectId: string): Promise<Issue[]>
  createIssue(input: NewIssue): Promise<Issue>
  updateIssue(id: string, patch: Partial<Issue>): Promise<Issue>
  /** Deletes the issue and any dependency edges referencing it. */
  deleteIssue(id: string): Promise<void>
}
