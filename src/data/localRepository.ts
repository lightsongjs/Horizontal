// localStorage-backed repository. Seeds from data-model.json on first run.
// Lets the app run with zero credentials while Supabase is being set up.

import { SEED_ISSUES, SEED_PROJECTS, SEED_THEMES, SEED_WAVES } from '../lib/seed'
import type { Issue, Project, Theme, Wave } from '../lib/types'
import type { NewIssue, NewProject, Repository } from './repository'

const KEY = 'depflow:v1'

interface DB {
  projects: Project[]
  themes: Theme[]
  waves: Wave[]
  issues: Issue[]
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DB
  } catch {
    /* fall through to seed */
  }
  const seeded: DB = {
    projects: clone(SEED_PROJECTS),
    themes: clone(SEED_THEMES),
    waves: clone(SEED_WAVES),
    issues: clone(SEED_ISSUES),
  }
  save(seeded)
  return seeded
}

function save(db: DB): void {
  localStorage.setItem(KEY, JSON.stringify(db))
}

/** Next free id for a project, e.g. TUR-09. Skips non-numeric ids (TUR-API). */
function nextIssueId(db: DB, project: Project): string {
  const max = db.issues
    .filter((i) => i.projectId === project.id)
    .map((i) => Number(i.id.slice(project.prefix.length + 1)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${project.prefix}-${String(max + 1).padStart(2, '0')}`
}

export function createLocalRepository(): Repository {
  return {
    async listProjects() {
      return clone(load().projects)
    },

    async createProject(input: NewProject) {
      const db = load()
      const id = input.prefix.toLowerCase()
      const project: Project = {
        id,
        name: input.name,
        description: input.description,
        prefix: input.prefix.toUpperCase(),
        currentWave: 1,
        accent: input.accent ?? '#6e7bff',
      }
      db.projects.push(project)
      save(db)
      return clone(project)
    },

    async listThemes() {
      return clone(load().themes)
    },

    async createTheme(theme: Theme) {
      const db = load()
      if (!db.themes.some((t) => t.key === theme.key)) {
        db.themes.push(theme)
        save(db)
      }
      return clone(theme)
    },

    async listWaves() {
      return clone(load().waves)
    },

    async listIssues(projectId: string) {
      return clone(load().issues.filter((i) => i.projectId === projectId))
    },

    async createIssue(input: NewIssue) {
      const db = load()
      const project = db.projects.find((p) => p.id === input.projectId)
      if (!project) throw new Error(`Unknown project ${input.projectId}`)
      const issue: Issue = {
        id: nextIssueId(db, project),
        projectId: input.projectId,
        title: input.title,
        desc: input.desc ?? '',
        type: input.type ?? 'task',
        theme: input.theme ?? '',
        wave: input.wave ?? project.currentWave,
        deps: input.deps ?? [],
        done: false,
        parentId: input.parentId ?? null,
        children: [],
      }
      db.issues.push(issue)
      save(db)
      return clone(issue)
    },

    async updateIssue(id: string, patch: Partial<Issue>) {
      const db = load()
      const issue = db.issues.find((i) => i.id === id)
      if (!issue) throw new Error(`Unknown issue ${id}`)
      Object.assign(issue, patch)
      save(db)
      return clone(issue)
    },
  }
}
