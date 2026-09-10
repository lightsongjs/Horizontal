// localStorage-backed repository for credential-free local dev. Seeds the tiny
// example on first run. Mirrors the Supabase backend's behavior.

import { SEED_ISSUES, SEED_PROJECTS, SEED_THEMES, SEED_WAVES } from '../lib/seed'
import type { Assignee, Issue, Obstacle, ObstacleLink, Project, Theme, Wave } from '../lib/types'
import { themeKey, type DueRange, type NewIssue, type NewObstacle, type NewProject, type Repository } from './repository'

const KEY = 'horizontal:v2'

interface DB {
  projects: Project[]
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  assignees: Assignee[]
  obstacles: Obstacle[]
  obstacleLinks: ObstacleLink[]
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as Partial<DB>
      return {
        projects: db.projects ?? [],
        waves: db.waves ?? [],
        themes: db.themes ?? [],
        // Câmpurile adăugate după ce cineva avea deja date în localStorage se
        // completează la citire. Fără asta, un tichet vechi ar avea `dueAt`
        // undefined, iar `dueAt === null` (testul „are scadență") ar fi fals
        // în ambele sensuri.
        issues: (db.issues ?? []).map((i) => ({
          ...i,
          urgent: i.urgent ?? false,
          dueAt: i.dueAt ?? null,
          allDay: i.allDay ?? true,
          remindAt: i.remindAt ?? null,
          rrule: i.rrule ?? null,
        })),
        assignees: db.assignees ?? [],
        // Adăugate după ce cineva avea deja date în localStorage.
        obstacles: (db.obstacles ?? []).map((o) => ({ ...o, deps: o.deps ?? [] })),
        obstacleLinks: db.obstacleLinks ?? [],
      }
    }
  } catch {
    /* fall through to seed */
  }
  const seeded: DB = {
    projects: clone(SEED_PROJECTS),
    waves: clone(SEED_WAVES),
    themes: clone(SEED_THEMES),
    issues: clone(SEED_ISSUES),
    assignees: [],
    obstacles: [],
    obstacleLinks: [],
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

/** Next free obstacle id for a project, e.g. MCP-O01. Același tipar ca la
 *  tichete, cu „O" ca să nu se confunde niciodată un obstacol cu un tichet. */
function nextObstacleId(db: DB, project: Project): string {
  const pre = `${project.prefix}-O`
  const max = db.obstacles
    .filter((o) => o.projectId === project.id)
    .map((o) => Number(o.id.slice(pre.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${pre}${String(max + 1).padStart(2, '0')}`
}

/** Removes issues by id and strips them from every other issue's `deps`. */
function deleteIssuesImpl(db: DB, ids: string[]): void {
  if (ids.length === 0) return
  const gone = new Set(ids)
  db.issues = db.issues
    .filter((i) => !gone.has(i.id))
    .map((i) => (i.deps?.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
  db.obstacleLinks = db.obstacleLinks.filter((l) => !gone.has(l.issueId))
  save(db)
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
        accent: input.accent ?? '#0EA5E9',
        type: input.type ?? 'personal',
      }
      db.projects.push(project)
      db.waves.push({ projectId: id, number: 0, name: 'Scratchpad', label: '', position: 0 })
      db.waves.push({ projectId: id, number: 1, name: 'Val 1', label: 'MVP', position: 1 })
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
      const goneObstacles = new Set(db.obstacles.filter((o) => o.projectId === id).map((o) => o.id))
      db.obstacles = db.obstacles.filter((o) => o.projectId !== id)
      db.obstacleLinks = db.obstacleLinks.filter((l) => !goneObstacles.has(l.obstacleId))
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
      if (number === 0) throw new Error('The Scratchpad wave cannot be deleted')
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

    async listDueIssues({ to, doneFrom }: DueRange) {
      // Comparăm timpi, nu string-uri: Supabase întoarce `+00:00` iar
      // `toISOString()` produce `.000Z`, deci un `<` pe text ar minți. Backend-ul
      // Supabase face aceeași comparație în Postgres — asta e paritatea.
      const toT = Date.parse(to)
      const doneT = Date.parse(doneFrom)
      return clone(
        load().issues.filter((i) => {
          if (!i.dueAt) return false
          const t = Date.parse(i.dueAt)
          if (!(t < toT)) return false
          return !i.done || t >= doneT
        }),
      )
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
        selectors: [],
        scenarios: [],
        notes: '',
        assigneeId: input.assigneeId ?? null,
        urgent: input.urgent ?? false,
        dueAt: input.dueAt ?? null,
        allDay: input.allDay ?? true,
        remindAt: input.remindAt ?? null,
        rrule: input.rrule ?? null,
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
      deleteIssuesImpl(load(), [id])
    },

    // Fără attachment-uri: n-au sens în modul local seeded, iar `Attachments`
    // nu se randează acolo.
    async deleteIssues(ids: string[]) {
      deleteIssuesImpl(load(), ids)
    },

    async listObstacles(projectId: string) {
      return clone(
        load()
          .obstacles.filter((o) => o.projectId === projectId)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      )
    },

    async listObstacleLinks(projectId: string) {
      const db = load()
      const mine = new Set(db.obstacles.filter((o) => o.projectId === projectId).map((o) => o.id))
      return clone(db.obstacleLinks.filter((l) => mine.has(l.obstacleId)))
    },

    async createObstacle(input: NewObstacle) {
      const db = load()
      const project = db.projects.find((p) => p.id === input.projectId)
      if (!project) throw new Error(`Unknown project ${input.projectId}`)
      const obstacle: Obstacle = {
        id: nextObstacleId(db, project),
        projectId: input.projectId,
        title: input.title,
        detail: input.detail ?? '',
        owner: input.owner ?? '',
        state: input.state ?? 'necunoscut',
        blocking: input.blocking ?? true,
        bypass: input.bypass ?? null,
        evidence: input.evidence ?? 'necunoscut',
        askedAt: input.askedAt ?? null,
        resolvedAt: null,
        deps: input.deps ?? [],
        position: db.obstacles.filter((o) => o.projectId === input.projectId).length,
      }
      db.obstacles.push(obstacle)
      for (const issueId of input.issueIds ?? []) {
        db.obstacleLinks.push({ obstacleId: obstacle.id, issueId })
      }
      save(db)
      return clone(obstacle)
    },

    async updateObstacle(id: string, patch: Partial<Obstacle>) {
      const db = load()
      const o = db.obstacles.find((x) => x.id === id)
      if (!o) throw new Error(`Unknown obstacle ${id}`)
      Object.assign(o, patch)
      if (patch.state !== undefined) {
        const closed = patch.state === 'depasit' || patch.state === 'ocolit'
        o.resolvedAt = closed ? (o.resolvedAt ?? new Date().toISOString()) : null
      }
      save(db)
      return clone(o)
    },

    async deleteObstacle(id: string) {
      const db = load()
      db.obstacles = db.obstacles
        .filter((o) => o.id !== id)
        .map((o) => (o.deps.includes(id) ? { ...o, deps: o.deps.filter((d) => d !== id) } : o))
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.obstacleId !== id)
      save(db)
    },

    async setObstacleIssues(obstacleId: string, issueIds: string[]) {
      const db = load()
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.obstacleId !== obstacleId)
      for (const issueId of issueIds) db.obstacleLinks.push({ obstacleId, issueId })
      save(db)
    },

    async setIssueObstacles(issueId: string, obstacleIds: string[]) {
      const db = load()
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.issueId !== issueId)
      for (const obstacleId of obstacleIds) db.obstacleLinks.push({ obstacleId, issueId })
      save(db)
    },

    async listAssignees() {
      return clone(load().assignees)
    },

    async createAssignee(name: string) {
      const db = load()
      const assignee: Assignee = { id: crypto.randomUUID(), name }
      db.assignees.push(assignee)
      save(db)
      return clone(assignee)
    },
  }
}
