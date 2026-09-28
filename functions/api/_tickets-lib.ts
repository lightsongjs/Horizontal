// functions/api/_tickets-lib.ts
// Shared Supabase REST helpers for the tickets endpoints.

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
