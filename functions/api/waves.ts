// functions/api/waves.ts
// GET  /api/waves?project=<id|name> — valurile proiectului: număr, nume, etichetă și
//      locul (`position`), în ordinea locului — ordinea coloanelor din aplicație.
// POST /api/waves { projectId, label, name? } — un val nou. Numărul și locul se
//      calculează ca în aplicație (cel mai mare + 1); numele implicit e cifra
//      romană următoare (`nextWaveName`).
// POST /api/waves { projectId, date: "AAAA-LL-ZZ" } — un SPRINT (în interfață
//      valul se cheamă sprint): numele = eticheta = „dd/mm/yy”, locul înaintea
//      primului sprint mai târziu (`placeSprint`), ca în foaia „Sprinturi”.
//      Aceeași dată de două ori → 409 `sprint_exists`.

import { sbHeaders, resolveProject } from './_tickets-lib'
import { nextWaveName } from '../../src/lib/waveBar'
import { duplicateSprint, placeSprint, sprintName } from '../../src/lib/sprints'
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
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&select=*&order=position.asc,number.asc`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseWave[]

  return Response.json(rows.map(waveOut))
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { projectId?: unknown; name?: unknown; label?: unknown; date?: unknown }
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
  // Sprintul din dată: numele și eticheta sunt data, „dd/mm/yy” (lib/sprints).
  let sprint: { iso: string; name: string } | null = null
  if (body.date !== undefined) {
    const iso = typeof body.date === 'string' ? body.date.trim() : ''
    const name = sprintName(iso)
    if (!name) return Response.json({ error: 'invalid_date', detail: 'Data sprintului: AAAA-LL-ZZ.' }, { status: 400 })
    sprint = { iso, name }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(body.projectId, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&select=number,name,label,position`,
    { headers }
  )
  if (!res.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const rows = await res.json() as Array<{ number: number; name: string | null; label?: string | null; position: number | null }>
  const known = rows.map((w) => ({ number: w.number, name: w.name ?? '', label: w.label ?? '', position: w.position ?? w.number }))
  // Ca `createWave` din supabaseRepository: cel mai mare număr + 1, ultimul loc.
  const number = rows.reduce((m, w) => Math.max(m, w.number), 0) + 1
  let position = rows.reduce((m, w) => Math.max(m, w.position ?? w.number), -1) + 1
  let name = typeof body.name === 'string' ? body.name.trim() : nextWaveName(known)
  let label = typeof body.label === 'string' ? body.label.trim() : ''
  if (sprint) {
    const dup = duplicateSprint(known, sprint.iso)
    if (dup) return Response.json({ error: 'sprint_exists', number: dup.number, detail: `Există deja sprintul ${sprint.name}.` }, { status: 409 })
    const place = placeSprint(known, sprint.iso)
    // Întâi se fac loc cele de după (de la coadă), apoi intră sprintul.
    for (const s of place.shifts) {
      const up = await fetch(
        `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&number=eq.${s.number}`,
        { method: 'PATCH', headers, body: JSON.stringify({ position: s.position }) },
      )
      if (!up.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    }
    position = place.position
    name = sprint.name
    label = sprint.name
  }

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
