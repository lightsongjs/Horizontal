// functions/api/waves/[number].ts
// PATCH  /api/waves/<number>?project=<id|name> { name?, label?, archived?, moveTo? } —
//        redenumește un val, îi schimbă eticheta, îl arhivează / îl scoate din arhivă.
//        Numărul rămâne (tichetele îl țin); ordinea se schimbă din aplicație
//        (foaia „Valuri”), nu de aici.
// DELETE /api/waves/<number>?project=<id|name>[&moveTo=<n>] — șterge valul; dacă are
//        tichete gata, îl arhivează în loc (`waveRemovalPlan`).
//
// Tichetele DESCHISE opresc ștergerea și arhivarea: 409 `wave_in_use` cu lista
// lor, fără nicio scriere — afară de `moveTo`, care le mută întâi în alt val
// (0 = Notițele). Arhivarea cere `migration-wave-archive.sql`; fără ea, 409
// `migration_missing` ÎNAINTE de orice scriere.

import { sbHeaders, resolveProject } from '../_tickets-lib'
import { waveOut, waveRemovalPlan, type SupabaseWave } from '../_api-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

/** Notițele (valul 0) n-au cum să dispară: sunt locul în care cad celelalte. */
const SCRATCH = 0

type Ctx = Parameters<PagesFunction<Env>>[0]

function parseNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Șterge sau arhivează valul `number`, după `waveRemovalPlan`. Comun lui
 * `DELETE` și lui `PATCH { archived: true }`.
 */
async function removeWave(context: Ctx, number: number, projectParam: string, mode: 'delete' | 'archive', moveToIn: unknown): Promise<Response> {
  if (number === SCRATCH) return Response.json({ error: 'scratch_wave', detail: 'Notițele (valul 0) nu se șterg și nu se arhivează.' }, { status: 400 })
  let moveTo: number | null = null
  if (moveToIn !== undefined && moveToIn !== null && moveToIn !== '') {
    moveTo = parseNumber(moveToIn)
    if (moveTo === null || moveTo === number) return Response.json({ error: 'invalid_move_to' }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })
  const pid = encodeURIComponent(proj.id)

  // `select=*`: `archived_at` există doar după migrare, iar lipsa ei se vede aici.
  const wRes = await fetch(`${SUPABASE_URL}/rest/v1/waves?project_id=eq.${pid}&select=*`, { headers })
  if (!wRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const waves = await wRes.json() as SupabaseWave[]
  const wave = waves.find((w) => w.number === number)
  if (!wave) return Response.json({ error: 'wave_not_found', wave: number }, { status: 404 })
  if (moveTo !== null) {
    const target = waves.find((w) => w.number === moveTo)
    if (!target || target.archived_at) return Response.json({ error: 'move_to_not_found', moveTo }, { status: 422 })
  }

  const tRes = await fetch(`${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&wave=eq.${number}&select=id,done&order=id`, { headers })
  if (!tRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const tickets = await tRes.json() as Array<{ id: string; done: boolean }>

  const plan = waveRemovalPlan(tickets, mode, moveTo)
  if ('error' in plan) {
    return Response.json({ error: 'wave_in_use', wave: number, count: plan.open.length, tickets: plan.open }, { status: 409 })
  }
  if (plan.action === 'archive' && !('archived_at' in wave)) {
    return Response.json({ error: 'migration_missing', detail: 'Arhivarea cere supabase/migration-wave-archive.sql.', kept: plan.kept }, { status: 409 })
  }

  if (plan.move.length) {
    const mv = await fetch(`${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&wave=eq.${number}&done=eq.false`, {
      method: 'PATCH', headers, body: JSON.stringify({ wave: moveTo }),
    })
    if (!mv.ok) return Response.json({ error: 'db_error', step: 'move' }, { status: 502 })
  }

  if (plan.action === 'delete') {
    // Plasa: un tichet apărut între citire și ștergere oprește ștergerea (rămâne
    // pe val), nu se pierde — PostgREST n-are tranzacții, deci se verifică iar.
    const again = await fetch(`${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&wave=eq.${number}&select=id&limit=1`, { headers })
    if (!again.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    if ((await again.json() as unknown[]).length) return Response.json({ error: 'wave_in_use', wave: number, count: 1, tickets: [], moved: plan.move }, { status: 409 })
    const del = await fetch(`${SUPABASE_URL}/rest/v1/waves?project_id=eq.${pid}&number=eq.${number}`, { method: 'DELETE', headers })
    if (!del.ok) return Response.json({ error: 'db_error', step: 'delete', moved: plan.move }, { status: 502 })
    return Response.json({ deleted: number, archived: null, moved: plan.move, moveTo, kept: 0 })
  }

  const arc = await fetch(`${SUPABASE_URL}/rest/v1/waves?project_id=eq.${pid}&number=eq.${number}`, {
    method: 'PATCH', headers, body: JSON.stringify({ archived_at: new Date().toISOString() }),
  })
  if (!arc.ok) return Response.json({ error: 'db_error', step: 'archive', moved: plan.move }, { status: 502 })
  return Response.json({ deleted: null, archived: number, moved: plan.move, moveTo, kept: plan.kept })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const number = parseNumber(context.params.number)
  if (number === null) return Response.json({ error: 'invalid_wave' }, { status: 400 })
  const projectParam = new URL(context.request.url).searchParams.get('project')
  if (!projectParam) return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })

  let body: { name?: unknown; label?: unknown; archived?: unknown; moveTo?: unknown }
  try {
    body = await context.request.json() as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const patch: Record<string, string | null> = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) return Response.json({ error: 'invalid_name' }, { status: 400 })
    patch.name = body.name.trim()
  }
  if ('label' in body) {
    if (typeof body.label !== 'string') return Response.json({ error: 'invalid_label' }, { status: 400 })
    patch.label = body.label.trim()
  }
  if ('archived' in body && typeof body.archived !== 'boolean') return Response.json({ error: 'invalid_archived' }, { status: 400 })
  // Arhivarea are regulile ei (tichetele deschise, mutarea) — n-o amestecăm cu o redenumire.
  if (body.archived === true) {
    if (Object.keys(patch).length) return Response.json({ error: 'archive_alone', detail: 'Arhivarea nu se combină cu name/label.' }, { status: 400 })
    return removeWave(context, number, projectParam, 'archive', body.moveTo)
  }
  if (body.archived === false) patch.archived_at = null
  if (!Object.keys(patch).length) return Response.json({ error: 'no_updatable_fields' }, { status: 400 })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) return Response.json({ error: 'project_not_found' }, { status: 404 })

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(proj.id)}&number=eq.${number}&select=*`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) }
  )
  if (!res.ok) {
    // Scoaterea din arhivă pe o bază fără coloană: nimic de scos.
    if (body.archived === false) return Response.json({ error: 'migration_missing', detail: 'Arhivarea cere supabase/migration-wave-archive.sql.' }, { status: 409 })
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseWave[]
  if (!rows.length) return Response.json({ error: 'wave_not_found' }, { status: 404 })
  return Response.json(waveOut(rows[0]))
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const number = parseNumber(context.params.number)
  if (number === null) return Response.json({ error: 'invalid_wave' }, { status: 400 })
  const url = new URL(context.request.url)
  const projectParam = url.searchParams.get('project')
  if (!projectParam) return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  return removeWave(context, number, projectParam, 'delete', url.searchParams.get('moveTo') ?? undefined)
}
