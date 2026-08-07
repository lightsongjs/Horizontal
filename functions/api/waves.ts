// functions/api/waves.ts
// GET /api/waves?project=<id|name> — the wave numbers and their names for a project.
// Wave names live in the `waves` table and were previously invisible from the CLI.

import { sbHeaders, resolveProject } from './_tickets-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

interface SupabaseWave {
  number: number
  name: string | null
  label: string | null
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const projectParam = url.searchParams.get('project')

  if (!projectParam) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) {
    return Response.json({ error: 'project_not_found' }, { status: 404 })
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&select=number,name,label&order=number.asc`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseWave[]

  return Response.json(
    rows.map((w) => ({
      number: w.number,
      name: w.name ?? '',
      label: w.label ?? '',
    }))
  )
}
