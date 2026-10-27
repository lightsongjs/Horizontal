// functions/api/_tickets-lib.ts
// Shared Supabase REST helpers for the tickets endpoints.

import { naturalCompare } from '../../src/lib/waveGrid'
import { authorFilter, pickAuthor, type AssigneeRow } from './_thread-lib'

export interface Project {
  id: string
  prefix: string
  current_wave: number
}

export function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

export async function resolveProject(
  param: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<Project | null> {
  const encoded = encodeURIComponent(param)
  const res = await fetch(
    `${supabaseUrl}/rest/v1/projects?or=(id.eq.${encoded},name.ilike.${encoded})&select=id,prefix,current_wave&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Project[]
  return rows[0] ?? null
}

// Pure: given every existing id in a project, produce the next free one.
export function nextIdFrom(existingIds: string[], prefix: string): string {
  const maxNum = existingIds
    .map(id => Number(id.slice(prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}-${String(maxNum + 1).padStart(2, '0')}`
}

export async function nextIssueId(
  projectId: string,
  prefix: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<string | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/issues?project_id=eq.${encodeURIComponent(projectId)}&select=id`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string }>
  return nextIdFrom(rows.map(r => r.id), prefix)
}

export interface Assignee {
  id: string
  name: string
}

// `assignees.id` e uuid, deci nu merge un singur `or=(id.eq.X,name.ilike.X)` ca la
// `resolveProject`: cu un X care nu e uuid, PostgREST refuză TOT query-ul (22P02
// invalid input syntax), nu doar jumătatea lui. Deci alegem coloana după forma
// valorii primite.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assigneeFilter(param: string): string {
  const encoded = encodeURIComponent(param)
  return UUID_RE.test(param) ? `id=eq.${encoded}` : `name=ilike.${encoded}`
}

export async function resolveAssignee(
  param: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<Assignee | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/assignees?${assigneeFilter(param)}&select=id,name&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Assignee[]
  return rows[0] ?? null
}

/** Tema există în proiect? `null` = eroare de bază. Cheile sunt per proiect. */
export async function themeExists(projectId: string, key: string, supabaseUrl: string, headers: Record<string, string>): Promise<boolean | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/themes?project_id=eq.${encodeURIComponent(projectId)}&key=eq.${encodeURIComponent(key)}&select=key&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  return (await res.json() as unknown[]).length > 0
}

export interface ThemeRow {
  key: string
  name: string
  color: string
}

export async function listThemes(projectId: string, supabaseUrl: string, headers: Record<string, string>): Promise<ThemeRow[] | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/themes?project_id=eq.${encodeURIComponent(projectId)}&select=key,name,color`,
    { headers }
  )
  if (!res.ok) return null
  return (await res.json() as ThemeRow[]).sort((a, b) => naturalCompare(a.name, b.name))
}

/**
 * Omul în numele căruia scrie API-ul (`author`): un rând din `assignees` legat
 * de un cont. `null` = eroare de bază. Cheia API e cheie de serviciu — poate
 * scrie oricum orice rând —, deci a scrie în numele unui cont nu lărgește
 * drepturile; regula de aici ține doar ca autorul să fie un om real.
 */
export async function resolveAuthor(param: string, supabaseUrl: string, headers: Record<string, string>) {
  const res = await fetch(`${supabaseUrl}/rest/v1/assignees?${authorFilter(param)}&select=id,name,user_id`, { headers })
  if (!res.ok) return null
  return pickAuthor(await res.json() as AssigneeRow[])
}
