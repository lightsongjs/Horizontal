// localStorage-backed repository for credential-free local dev. Seeds the tiny
// example on first run. Mirrors the Supabase backend's behavior.

import { SEED_ISSUES, SEED_PROJECTS, SEED_THEMES, SEED_WAVES } from '../lib/seed'
import type { Issue, Project, Theme, Wave } from '../lib/types'
import { themeKey, type NewIssue, type NewProject, type Repository } from './repository'

const KEY = 'depflow:v2'

interface DB {
  projects: Project[]
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as Partial<DB>
      return { projects: db.projects ?? [], waves: db.waves ?? [], themes: db.themes ?? [], issues: db.issues ?? [] }
    }
  } catch {
    /* fall through to seed */
  }
  const seeded: DB = {
    projects: clone(SEED_PROJECTS),
    waves: clone(SEED_WAVES),
    themes: clone(SEED_THEMES),
    issues: clone(SEED_ISSUES),
  }
  save(seeded)
  return seeded
}

function save(db: DB): void {
  localStorage.setItem(KEY, JSON.stringify(db))
}

/** Next free issue id for a project, e.g. TUR-09. */
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
      db.waves.push({ projectId: id, number: 1, name: 'Val 1', label: 'MVP', position: 0 })
      save(db)
      return clone(project)
    },

    async updateProject(id, patch) {
      const db = load()
      const project = db.projects.find((p) => p.id === id)
      if (!project) throw new Error(`Unknown project ${id}`)
      Object.assign(project, patch)
      save(db)
      return clone(project)
    },

    async deleteProject(id) {
      const db = load()
      db.projects = db.projects.filter((p) => p.id !== id)
      db.waves = db.waves.filter((w) => w.projectId !== id)
      db.themes = db.themes.filter((t) => t.projectId !== id)
      db.issues = db.issues.filter((i) => i.projectId !== id)
      save(db)
    },

    async listWaves(projectId: string) {
      return clone(
        load()
          .waves.filter((w) => w.projectId === projectId)
          .sort((a, b) => a.position - b.position),
      )
    },

    async createWave(projectId: string, name: string, label = '') {
      const db = load()
      const existing = db.waves.filter((w) => w.projectId === projectId)
      const number = existing.reduce((m, w) => Math.max(m, w.number), 0) + 1
      const position = existing.reduce((m, w) => Math.max(m, w.position), -1) + 1
      const wave: Wave = { projectId, number, name, label, position }
      db.waves.push(wave)
      save(db)
      return clone(wave)
    },

    async updateWave(projectId, number, patch) {
      const db = load()
      const wave = db.waves.find((w) => w.projectId === projectId && w.number === number)
      if (!wave) throw new Error(`Unknown wave ${projectId}/${number}`)
      Object.assign(wave, patch)
      save(db)
      return clone(wave)
    },

    async deleteWave(projectId, number) {
      const db = load()
      db.waves = db.waves.filter((w) => !(w.projectId === projectId && w.number === number))
      save(db)
    },

    async listThemes(projectId: string) {
      return clone(load().themes.filter((t) => t.projectId === projectId))
    },

    async createTheme(projectId: string, name: string, color: string) {
      const db = load()
      const existing = db.themes.filter((t) => t.projectId === projectId).map((t) => t.key)
      const theme: Theme = { projectId, key: themeKey(name, existing), name, color }
      db.themes.push(theme)
      save(db)
      return clone(theme)
    },

    async updateTheme(projectId, key, patch) {
      const db = load()
      const theme = db.themes.find((t) => t.projectId === projectId && t.key === key)
      if (!theme) throw new Error(`Unknown theme ${projectId}/${key}`)
      Object.assign(theme, patch)
      save(db)
      return clone(theme)
    },

    async deleteTheme(projectId, key) {
      const db = load()
      db.themes = db.themes.filter((t) => !(t.projectId === projectId && t.key === key))
      db.issues = db.issues.map((i) =>
        i.projectId === projectId && i.theme === key ? { ...i, theme: '' } : i,
      )
      save(db)
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
        theme: input.theme ?? '',
        wave: input.wave ?? project.currentWave,
        deps: input.deps ?? [],
        done: false,
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

    async deleteIssue(id: string) {
      const db = load()
      db.issues = db.issues
        .filter((i) => i.id !== id)
        .map((i) => (i.deps?.includes(id) ? { ...i, deps: i.deps.filter((d) => d !== id) } : i))
      save(db)
    },
  }
}
