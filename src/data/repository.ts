// Storage-agnostic data access. The app talks only to this interface; the
// concrete backend (local or Supabase) is chosen in ./index.ts by env.

import type { Issue, Project, Wave } from '../lib/types'

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
  wave?: number
  deps?: string[]
}

export interface Repository {
  listProjects(): Promise<Project[]>
  /** Creates the project and its first wave ("Val 1"). */
  createProject(input: NewProject): Promise<Project>

  listWaves(projectId: string): Promise<Wave[]>
  createWave(projectId: string, name: string, label?: string): Promise<Wave>
  updateWave(projectId: string, number: number, patch: Partial<Pick<Wave, 'name' | 'label' | 'position'>>): Promise<Wave>
  deleteWave(projectId: string, number: number): Promise<void>

  listIssues(projectId: string): Promise<Issue[]>
  createIssue(input: NewIssue): Promise<Issue>
  updateIssue(id: string, patch: Partial<Issue>): Promise<Issue>
  /** Deletes the issue and any dependency edges referencing it. */
  deleteIssue(id: string): Promise<void>
}
