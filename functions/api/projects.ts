// functions/api/projects.ts
// GET  /api/projects — toate proiectele (cheia de serviciu vede tot).
// POST /api/projects { name, prefix?, type?, accent?, description? } — un proiect
//      nou, exact ca formularul din aplicație: prefixul sugerat din nume și
//      curățat, id = prefixul cu litere mici, valul 1 activ, Notițele (0) +
//      „Val 1 / MVP” (1). Regulile vin din src/lib/newProject.ts, nu de aici.
//
// Vizibilitatea: ca în aplicație (unde numai un admin poate crea proiecte),
// proiectul nou n-are niciun rând în `project_members`, deci îl văd adminii
// (`is_admin()`, migration-access.sql) și cheia API; un cont obișnuit îl vede
// abia după ce un admin îl adaugă din „Utilizatori”.

import { autoPrefix, buildNewProject, cleanPrefix, initialWaves, prefixOwner } from '../../src/lib/newProject'
import { isHexColor, isUniqueViolation } from './_api-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

interface SupabaseProject {
  id: string
  name: string
  description: string | null
  prefix: string
  current_wave: number
  accent: string | null
  type: string | null
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

function projectOut(p: SupabaseProject) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    prefix: p.prefix,
    currentWave: p.current_wave,
    accent: p.accent ?? null,
    type: (p.type ?? 'personal') as 'personal' | 'work',
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?select=id,name,description,prefix,current_wave,accent,type&order=name.asc`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseProject[]

  return Response.json(rows.map(projectOut))
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { name?: unknown; prefix?: unknown; type?: unknown; accent?: unknown; description?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalid_json' }, { status: 400 })
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return Response.json({ error: 'missing_fields', required: ['name'] }, { status: 400 })
  if (body.prefix !== undefined && typeof body.prefix !== 'string') return Response.json({ error: 'invalid_prefix' }, { status: 400 })
  // Fără prefix: cel pe care formularul l-ar fi sugerat din nume.
  const prefix = cleanPrefix(typeof body.prefix === 'string' && body.prefix.trim() ? body.prefix : autoPrefix(name))
  if (!prefix) {
    return Response.json({ error: 'invalid_prefix', detail: 'Prefixul are nevoie de cel puțin o literă A–Z sau o cifră; dă-l explicit.' }, { status: 400 })
  }
  if (body.type !== undefined && body.type !== 'work' && body.type !== 'personal') {
    return Response.json({ error: 'invalid_type', allowed: ['work', 'personal'] }, { status: 400 })
  }
  if (body.accent !== undefined && !isHexColor(body.accent)) return Response.json({ error: 'invalid_accent' }, { status: 400 })
  if (body.description !== undefined && typeof body.description !== 'string') return Response.json({ error: 'invalid_description' }, { status: 400 })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const existing = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=id,prefix`, { headers })
  if (!existing.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const owner = prefixOwner(await existing.json() as Array<{ id: string; prefix: string }>, prefix)
  if (owner) return Response.json({ error: 'prefix_taken', prefix, existing_project: owner.id }, { status: 409 })

  const project = buildNewProject({
    name,
    prefix,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    accent: body.accent as string | undefined,
    type: body.type as 'work' | 'personal' | undefined,
  })
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: project.id,
      name: project.name,
      description: project.description,
      prefix: project.prefix,
      current_wave: project.currentWave,
      accent: project.accent,
      type: project.type,
    }),
  })
  if (!ins.ok) {
    const detail = await ins.json().catch(() => undefined)
    // Două creări simultane cu același prefix: cheia primară o prinde.
    if (isUniqueViolation(detail)) return Response.json({ error: 'prefix_taken', prefix, existing_project: project.id }, { status: 409 })
    return Response.json({ error: 'insert_failed', ...(detail !== undefined ? { detail } : {}) }, { status: 500 })
  }

  const waves = await fetch(`${SUPABASE_URL}/rest/v1/waves`, {
    method: 'POST',
    headers,
    body: JSON.stringify(initialWaves(project.id).map((w) => ({
      project_id: w.projectId, number: w.number, name: w.name, label: w.label, position: w.position,
    }))),
  })
  if (!waves.ok) {
    const detail = await waves.json().catch(() => undefined)
    // Un proiect fără valuri n-are unde pune un tichet: îl scoatem la loc
    // (FK-urile cascadează), ca reîncercarea să nu dea „prefix ocupat”.
    await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(project.id)}`, { method: 'DELETE', headers }).catch(() => undefined)
    return Response.json({ error: 'insert_failed', ...(detail !== undefined ? { detail } : {}) }, { status: 500 })
  }

  return Response.json(projectOut({
    id: project.id, name: project.name, description: project.description, prefix: project.prefix,
    current_wave: project.currentWave, accent: project.accent, type: project.type,
  }), { status: 201 })
}
