// Supabase-backed repository. Maps the normalized DB (issues + dependencies
// edge table, per-project waves) to/from the app's models.

import { requireSupabase } from '../lib/supabase'
import type { Issue, Project, Wave } from '../lib/types'
import type { NewIssue, NewProject, Repository } from './repository'

interface IssueRow {
  id: string
  project_id: string
  title: string
  desc: string
  wave: number
  done: boolean
}

function rowToIssue(row: IssueRow, depsByIssue: Record<string, string[]>): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    desc: row.desc,
    wave: row.wave,
    deps: depsByIssue[row.id] ?? [],
    done: row.done,
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

  async function loadDeps(projectId: string): Promise<Record<string, string[]>> {
    // Only edges whose dependent issue belongs to this project (deps may point
    // cross-project in theory, but ids are project-scoped here).
    const { data, error } = await db.from('dependencies').select('issue_id, depends_on_id')
    if (error) throw error
    const map: Record<string, string[]> = {}
    for (const r of data ?? []) (map[r.issue_id] ??= []).push(r.depends_on_id)
    void projectId
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
      const { error: wErr } = await db
        .from('waves')
        .insert({ project_id: project.id, number: 1, name: 'Val 1', label: 'MVP', position: 0 })
      if (wErr) throw wErr
      return project
    },

    async listWaves(projectId: string) {
      const { data, error } = await db
        .from('waves')
        .select('*')
        .eq('project_id', projectId)
        .order('position')
      if (error) throw error
      return (data ?? []).map((w) => ({
        projectId: w.project_id,
        number: w.number,
        name: w.name,
        label: w.label,
        position: w.position,
      }))
    },

    async createWave(projectId: string, name: string, label = '') {
      const { data: rows, error: exErr } = await db
        .from('waves')
        .select('number, position')
        .eq('project_id', projectId)
      if (exErr) throw exErr
      const number = (rows ?? []).reduce((m, w) => Math.max(m, w.number), 0) + 1
      const position = (rows ?? []).reduce((m, w) => Math.max(m, w.position), -1) + 1
      const wave: Wave = { projectId, number, name, label, position }
      const { error } = await db
        .from('waves')
        .insert({ project_id: projectId, number, name, label, position })
      if (error) throw error
      return wave
    },

    async updateWave(projectId, number, patch) {
      const row: Record<string, unknown> = {}
      if (patch.name !== undefined) row.name = patch.name
      if (patch.label !== undefined) row.label = patch.label
      if (patch.position !== undefined) row.position = patch.position
      const { data, error } = await db
        .from('waves')
        .update(row)
        .eq('project_id', projectId)
        .eq('number', number)
        .select('*')
        .single()
      if (error) throw error
      return {
        projectId: data.project_id,
        number: data.number,
        name: data.name,
        label: data.label,
        position: data.position,
      }
    },

    async deleteWave(projectId, number) {
      const { error } = await db
        .from('waves')
        .delete()
        .eq('project_id', projectId)
        .eq('number', number)
      if (error) throw error
    },

    async listIssues(projectId: string) {
      const [{ data, error }, deps] = await Promise.all([
        db.from('issues').select('*').eq('project_id', projectId).order('id'),
        loadDeps(projectId),
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
        wave: input.wave ?? proj.current_wave,
        deps: input.deps ?? [],
        done: false,
      }
      const { error } = await db.from('issues').insert({
        id: issue.id,
        project_id: issue.projectId,
        title: issue.title,
        desc: issue.desc,
        wave: issue.wave,
        done: issue.done,
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
      if (patch.wave !== undefined) row.wave = patch.wave
      if (patch.done !== undefined) row.done = patch.done
      if (Object.keys(row).length) {
        const { error } = await db.from('issues').update(row).eq('id', id)
        if (error) throw error
      }

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

      const projectId = (await db.from('issues').select('project_id').eq('id', id).single()).data
        ?.project_id as string
      const { data, error } = await db.from('issues').select('*').eq('id', id).single()
      if (error) throw error
      const deps = await loadDeps(projectId)
      return rowToIssue(data as IssueRow, deps)
    },

    async deleteIssue(id: string) {
      const { error } = await db.from('issues').delete().eq('id', id)
      if (error) throw error
    },
  }
}
