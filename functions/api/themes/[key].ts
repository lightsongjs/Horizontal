// functions/api/themes/[key].ts
// PATCH /api/themes/<key>?project=<id|name> { name?, color? } — redenumește sau
// recolorează o temă. Cheia NU se schimbă (tichetele o țin), ca în aplicație.

import { sbHeaders, resolveProject, listThemes } from '../_tickets-lib'
import { isHexColor } from '../_api-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const key = context.params.key as string
  const projectParam = new URL(context.request.url).searchParams.get('project')
  if (!projectParam) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }
  let body: { name?: unknown; color?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const patch: Record<string, string> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return Response.json({ error: 'invalid_name' }, { status: 400 })
    patch.name = name
  }
  if ('color' in body) {
    if (!isHexColor(body.color)) return Response.json({ error: 'invalid_color', expected: '#RRGGBB' }, { status: 400 })
    patch.color = body.color
  }
  if (!Object.keys(patch).length) return Response.json({ error: 'no_updatable_fields' }, { status: 400 })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const themes = await listThemes(proj.id, SUPABASE_URL, headers)
  if (!themes) return Response.json({ error: 'db_error' }, { status: 502 })
  const current = themes.find((t) => t.key === key)
  if (!current) return Response.json({ error: 'theme_not_found' }, { status: 404 })
  if (patch.name) {
    const same = themes.find((t) => t.key !== key && t.name.trim().toLowerCase() === patch.name.toLowerCase())
    if (same) return Response.json({ error: 'duplicate_theme', existing_key: same.key }, { status: 409 })
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/themes?project_id=eq.${encodeURIComponent(proj.id)}&key=eq.${encodeURIComponent(key)}`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) }
  )
  if (!res.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  return Response.json({ ...current, ...patch })
}
