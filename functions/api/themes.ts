// functions/api/themes.ts
// GET  /api/themes?project=<id|name> — temele proiectului: cheia, numele, culoarea,
//      în ordinea naturală a numelor („Pasul 2” înaintea lui „Pasul 10”), ca în aplicație.
// POST /api/themes { projectId, name, color } — o temă nouă. Cheia se face din nume
//      cu aceeași regulă ca în aplicație (`themeKey`), unică în proiect.

import { sbHeaders, resolveProject, listThemes } from './_tickets-lib'
import { isHexColor, isUniqueViolation } from './_api-lib'
import { themeKey } from '../../src/data/repository'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const projectParam = new URL(context.request.url).searchParams.get('project')
  if (!projectParam) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })
  const themes = await listThemes(proj.id, SUPABASE_URL, headers)
  if (!themes) return Response.json({ error: 'db_error' }, { status: 502 })
  return Response.json(themes)
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { projectId?: unknown; name?: unknown; color?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (typeof body.projectId !== 'string' || !body.projectId || !name || body.color === undefined) {
    return Response.json({ error: 'missing_fields', required: ['projectId', 'name', 'color'] }, { status: 400 })
  }
  if (!isHexColor(body.color)) {
    return Response.json({ error: 'invalid_color', expected: '#RRGGBB' }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(body.projectId, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const existing = await listThemes(proj.id, SUPABASE_URL, headers)
  if (!existing) return Response.json({ error: 'db_error' }, { status: 502 })
  // Două teme cu același nume ar fi două grupuri identice în „Teme × Valuri”.
  const same = existing.find((t) => t.name.trim().toLowerCase() === name.toLowerCase())
  if (same) return Response.json({ error: 'duplicate_theme', existing_key: same.key }, { status: 409 })

  const key = themeKey(name, existing.map((t) => t.key))
  const color = body.color
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/themes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ project_id: proj.id, key, name, color }),
  })
  if (!ins.ok) {
    const detail = await ins.json().catch(() => undefined)
    if (isUniqueViolation(detail)) return Response.json({ error: 'conflict', detail: 'Altcineva a creat în același timp; reîncearcă.' }, { status: 409 })
    return Response.json({ error: 'insert_failed', ...(detail !== undefined ? { detail } : {}) }, { status: 500 })
  }
  return Response.json({ key, name, color }, { status: 201 })
}
