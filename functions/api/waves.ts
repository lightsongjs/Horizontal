// functions/api/waves.ts
// GET  /api/waves?project=<id|name> — valurile proiectului: număr, nume, etichetă și
//      locul (`position`), în ordinea locului — ordinea coloanelor din aplicație.
// POST /api/waves { projectId, label, name? } — un val nou. Numărul și locul se
//      calculează ca în aplicație (cel mai mare + 1); numele implicit e cifra
//      romană următoare (`nextWaveName`), ca în foaia „Valuri”.

import { sbHeaders, resolveProject } from './_tickets-lib'
import { nextWaveName } from '../../src/lib/waveBar'
import { isUniqueViolation, waveOut, type SupabaseWave } from './_api-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
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
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&select=number,name,label,position&order=position.asc,number.asc`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseWave[]

  return Response.json(rows.map(waveOut))
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { projectId?: unknown; name?: unknown; label?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.projectId !== 'string' || !body.projectId) {
    return Response.json({ error: 'missing_fields', required: ['projectId'] }, { status: 400 })
  }
  if (body.label !== undefined && typeof body.label !== 'string') return Response.json({ error: 'invalid_label' }, { status: 400 })
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return Response.json({ error: 'invalid_name' }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(body.projectId, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&select=number,name,position`,
    { headers }
  )
  if (!res.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const rows = await res.json() as Array<{ number: number; name: string | null; position: number | null }>
  // Ca `createWave` din supabaseRepository: cel mai mare număr + 1, ultimul loc.
  const number = rows.reduce((m, w) => Math.max(m, w.number), 0) + 1
  const position = rows.reduce((m, w) => Math.max(m, w.position ?? w.number), -1) + 1
  const name = typeof body.name === 'string' ? body.name.trim() : nextWaveName(rows.map((w) => ({ number: w.number, name: w.name ?? '' })))
  const label = typeof body.label === 'string' ? body.label.trim() : ''

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/waves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ project_id: proj.id, number, name, label, position }),
  })
  if (!ins.ok) {
    const detail = await ins.json().catch(() => undefined)
    if (isUniqueViolation(detail)) return Response.json({ error: 'conflict', detail: 'Altcineva a creat în același timp; reîncearcă.' }, { status: 409 })
    return Response.json({ error: 'insert_failed', ...(detail !== undefined ? { detail } : {}) }, { status: 500 })
  }
  return Response.json({ number, name, label, position }, { status: 201 })
}
