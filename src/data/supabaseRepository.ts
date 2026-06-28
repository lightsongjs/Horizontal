// Supabase-backed repository. Maps the normalized DB (issues + dependencies
// edge table) to/from the app's denormalized Issue model (deps inline).

import { requireSupabase } from '../lib/supabase'
import type { Issue, IssueChild, Project, Theme, Wave } from '../lib/types'
import type { NewIssue, NewProject, Repository } from './repository'

interface IssueRow {
  id: string
  project_id: string
  title: string
  desc: string
  type: Issue['type']
  theme: string | null
  wave: number
  done: boolean
  parent_id: string | null
  children: IssueChild[]
}

function rowToIssue(row: IssueRow, depsByIssue: Record<string, string[]>): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    desc: row.desc,
    type: row.type,
    theme: row.theme ?? '',
    wave: row.wave,
    deps: depsByIssue[row.id] ?? [],
    done: row.done,
    parentId: row.parent_id,
    children: row.children ?? [],
  }
}

function nextIssueId(existing: string[], prefix: string): string {
  const max = existing
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}-${String(max + 1).padStart(2, '0')}`
}

export function createSupabaseRepository(): Repository {
  const db = requireSupabase()

  async function loadDeps(): Promise<Record<string, string[]>> {
    const { data, error } = await db.from('dependencies').select('issue_id, depends_on_id')
    if (error) throw error
    const map: Record<string, string[]> = {}
    for (const r of data ?? []) (map[r.issue_id] ??= []).push(r.depends_on_id)
    return map
  }

  return {
    async listProjects() {
      const { data, error } = await db.from('projects').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        prefix: p.prefix,
        currentWave: p.current_wave,
        accent: p.accent,
      }))
    },

    async createProject(input: NewProject) {
      const project: Project = {
        id: input.prefix.toLowerCase(),
        name: input.name,
        description: input.description,
        prefix: input.prefix.toUpperCase(),
        currentWave: 1,
        accent: input.accent ?? '#6e7bff',
      }
      const { error } = await db.from('projects').insert({
        id: project.id,
        name: project.name,
        description: project.description,
        prefix: project.prefix,
        current_wave: project.currentWave,
        accent: project.accent,
      })
      if (error) throw error
      return project
    },

    async listThemes() {
      const { data, error } = await db.from('themes').select('*').order('name')
      if (error) throw error
      return (data ?? []) as Theme[]
    },

    async createTheme(theme: Theme) {
      const { error } = await db.from('themes').insert(theme)
      if (error) throw error
      return theme
    },

    async listWaves() {
      const { data, error } = await db.from('waves').select('*').order('number')
      if (error) throw error
      return (data ?? []) as Wave[]
    },

    async listIssues(projectId: string) {
      const [{ data, error }, deps] = await Promise.all([
        db.from('issues').select('*').eq('project_id', projectId).order('id'),
        loadDeps(),
      ])
      if (error) throw error
      return (data as IssueRow[]).map((row) => rowToIssue(row, deps))
    },

    async createIssue(input: NewIssue) {
      const { data: existing, error: exErr } = await db
        .from('issues')
        .select('id')
        .eq('project_id', input.projectId)
      if (exErr) throw exErr
      const { data: proj, error: pErr } = await db
        .from('projects')
        .select('prefix, current_wave')
        .eq('id', input.projectId)
        .single()
      if (pErr) throw pErr

      const id = nextIssueId((existing ?? []).map((r) => r.id), proj.prefix)
      const issue: Issue = {
        id,
        projectId: input.projectId,
        title: input.title,
        desc: input.desc ?? '',
        type: input.type ?? 'task',
        theme: input.theme ?? '',
        wave: input.wave ?? proj.current_wave,
        deps: input.deps ?? [],
        done: false,
        parentId: input.parentId ?? null,
        children: [],
      }

      const { error } = await db.from('issues').insert({
        id: issue.id,
        project_id: issue.projectId,
        title: issue.title,
        desc: issue.desc,
        type: issue.type,
        theme: issue.theme || null,
        wave: issue.wave,
        done: issue.done,
        parent_id: issue.parentId,
        children: issue.children,
      })
      if (error) throw error

      if (issue.deps.length) {
        const { error: dErr } = await db
          .from('dependencies')
          .insert(issue.deps.map((d) => ({ issue_id: issue.id, depends_on_id: d })))
        if (dErr) throw dErr
      }
      return issue
    },

    async updateIssue(id: string, patch: Partial<Issue>) {
      const row: Record<string, unknown> = {}
      if (patch.title !== undefined) row.title = patch.title
      if (patch.desc !== undefined) row.desc = patch.desc
      if (patch.type !== undefined) row.type = patch.type
      if (patch.theme !== undefined) row.theme = patch.theme || null
      if (patch.wave !== undefined) row.wave = patch.wave
      if (patch.done !== undefined) row.done = patch.done
      if (patch.children !== undefined) row.children = patch.children

      if (Object.keys(row).length) {
        const { error } = await db.from('issues').update(row).eq('id', id)
        if (error) throw error
      }

      // Dependencies: replace the full set when provided.
      if (patch.deps !== undefined) {
        const { error: delErr } = await db.from('dependencies').delete().eq('issue_id', id)
        if (delErr) throw delErr
        if (patch.deps.length) {
          const { error: insErr } = await db
            .from('dependencies')
            .insert(patch.deps.map((d) => ({ issue_id: id, depends_on_id: d })))
          if (insErr) throw insErr
        }
      }

      const { data, error } = await db.from('issues').select('*').eq('id', id).single()
      if (error) throw error
      const deps = await loadDeps()
      return rowToIssue(data as IssueRow, deps)
    },
  }
}
