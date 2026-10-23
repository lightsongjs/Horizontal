// functions/api/waves/[number].ts
// PATCH /api/waves/<number>?project=<id|name> { name?, label? } — redenumește un val
// sau îi schimbă eticheta. Numărul rămâne (tichetele îl țin); ordinea se schimbă
// din aplicație (foaia „Valuri”), nu de aici.

import { sbHeaders, resolveProject } from '../_tickets-lib'
import { waveOut, type SupabaseWave } from '../_api-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const number = Number(context.params.number)
  if (!Number.isInteger(number) || number < 0) return Response.json({ error: 'invalid_wave' }, { status: 400 })
  const projectParam = new URL(context.request.url).searchParams.get('project')
  if (!projectParam) return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })

  let body: { name?: unknown; label?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const patch: Record<string, string> = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) return Response.json({ error: 'invalid_name' }, { status: 400 })
    patch.name = body.name.trim()
  }
  if ('label' in body) {
    if (typeof body.label !== 'string') return Response.json({ error: 'invalid_label' }, { status: 400 })
    patch.label = body.label.trim()
  }
  if (!Object.keys(patch).length) return Response.json({ error: 'no_updatable_fields' }, { status: 400 })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&number=eq.${number}&select=number,name,label,position`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) }
  )
  if (!res.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const rows = await res.json() as SupabaseWave[]
  if (!rows.length) return Response.json({ error: 'wave_not_found' }, { status: 404 })
  return Response.json(waveOut(rows[0]))
}
