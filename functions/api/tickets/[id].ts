// functions/api/tickets/[id].ts

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

import { sbHeaders, resolveProject, nextIssueId, resolveAssignee, themeExists } from '../_tickets-lib'
import { dueOut, normalizeTheme, parseDue, type DueRow } from '../_api-lib'
import { ATTACHMENT_SELECT, signAttachments, type AttachmentRow } from '../_attachments-lib'

const FIELD_MAP: Record<string, string> = {
  title: 'title',
  desc: 'details',
  theme: 'theme',
  wave: 'wave',
  done: 'done',
  urgent: 'urgent',
  notes: 'notes',
  selectors: 'selectors',
  scenarios: 'scenarios',
}

export function buildIssueUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  for (const [clientKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (clientKey in body) update[dbKey] = body[clientKey]
  }
  return update
}

// Atașamentele: citirea și semnarea stau în `_attachments-lib.ts`, comune cu
// `GET /api/tickets/<id>/attachments`. Re-exportat pentru testele vechi.
export { attachmentsPayload, type AttachmentRow } from '../_attachments-lib'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const issueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id,title,details,theme,wave,done,notes,assignee_id,selectors,scenarios,due_at,all_day,urgent,pinned_at&limit=1`,
    { headers }
  )
  if (!issueRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const issues = await issueRes.json() as Array<Record<string, unknown>>
  if (!issues.length) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const depsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/dependencies?issue_id=eq.${encodeURIComponent(id)}&select=depends_on_id`,
    { headers }
  )
  if (!depsRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const depsRows = await depsRes.json() as Array<{ depends_on_id: string }>

  const attRes = await fetch(
    `${SUPABASE_URL}/rest/v1/attachments?issue_id=eq.${encodeURIComponent(id)}` +
      `&select=${ATTACHMENT_SELECT}&order=created_at`,
    { headers }
  )
  if (!attRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const attachments = await signAttachments(await attRes.json() as AttachmentRow[], SUPABASE_URL, headers)

  // Numai numărul: firul întreg e `GET /api/tickets/<id>/comments`. Îl dăm aici
  // ca un agent să vadă că există o discuție, nu doar `notes` (câmpul vechi).
  const evRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issue_events?issue_id=eq.${encodeURIComponent(id)}&select=id`,
    { headers }
  )
  if (!evRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const commentCount = (await evRes.json() as unknown[]).length

  const row = issues[0]
  return Response.json({
    id: row.id,
    title: row.title,
    desc: row.details,
    theme: row.theme ?? null,
    wave: row.wave,
    done: row.done,
    notes: row.notes ?? '',
    assigneeId: row.assignee_id ?? null,
    selectors: row.selectors ?? [],
    scenarios: row.scenarios ?? [],
    deps: depsRows.map(r => r.depends_on_id),
    ...dueOut(row as unknown as DueRow),
    pinnedAt: row.pinned_at ?? null,
    attachments,
    commentCount,
  })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  let body: Record<string, unknown>
  try {
    body = await context.request.json() as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const issueUpdate = buildIssueUpdate(body)
  const hasDeps = 'deps' in body
  if (hasDeps && !Array.isArray(body.deps)) {
    return Response.json({ error: 'deps_must_be_array' }, { status: 400 })
  }
  const deps = hasDeps ? (body.deps as string[]) : null

  const wantsMove = 'projectId' in body
  if (wantsMove && (typeof body.projectId !== 'string' || body.projectId.length === 0)) {
    return Response.json({ error: 'invalid_project_id' }, { status: 400 })
  }

  // `assigneeId` nu stă în FIELD_MAP fiindcă valoarea se REZOLVĂ, nu se copiază:
  // clientul poate trimite un nume, iar coloana ține un uuid. `null` sau șirul
  // gol golesc asignarea — la fel ca `deps: []`.
  const wantsAssignee = 'assigneeId' in body
  if (wantsAssignee && body.assigneeId !== null && typeof body.assigneeId !== 'string') {
    return Response.json({ error: 'invalid_assignee' }, { status: 400 })
  }

  if ('urgent' in body && typeof body.urgent !== 'boolean') {
    return Response.json({ error: 'invalid_urgent' }, { status: 400 })
  }
  // „Fixează sus” (`pinned_at`, migration-pinned-tasks.sql): un comutator, ca în
  // aplicație — momentul fixării îl dă serverul (ordinea: fixat recent primul).
  if ('pinned' in body) {
    if (typeof body.pinned !== 'boolean') return Response.json({ error: 'invalid_pinned' }, { status: 400 })
    issueUpdate.pinned_at = body.pinned ? new Date().toISOString() : null
  }
  if ('theme' in issueUpdate) {
    const t = normalizeTheme(issueUpdate.theme)
    if ('error' in t) return Response.json(t, { status: 400 })
    issueUpdate.theme = t.theme
  }
  // Scadența: `due` → due_at / all_day / remind_at, ca în `POST /api/tickets`.
  const wantsDue = 'due' in body
  if (wantsDue) {
    const due = parseDue(body.due)
    if ('error' in due) return Response.json({ ...due, expected: 'YYYY-MM-DD sau YYYY-MM-DD HH:MM' }, { status: 400 })
    Object.assign(issueUpdate, due)
  }

  if (Object.keys(issueUpdate).length === 0 && !hasDeps && !wantsMove && !wantsAssignee) {
    return Response.json({ error: 'no_updatable_fields' }, { status: 400 })
  }

  // Load the ticket once: the dup-check and the move both need its current state.
  const currentRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id,project_id,title,wave,rrule&limit=1`,
    { headers }
  )
  if (!currentRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const currentRows = await currentRes.json() as Array<{
    id: string; project_id: string; title: string; wave: number; rrule?: string | null
  }>
  if (!currentRows.length) return Response.json({ error: 'not_found' }, { status: 404 })
  const current = currentRows[0]

  // O recurentă își mută scadența singură (triggerul din baza de date) și își
  // ține mementoul cu decalajul lui; o dată scrisă de aici le-ar strica pe
  // amândouă. Se schimbă din aplicație.
  if (wantsDue && current.rrule) {
    return Response.json({ error: 'recurring', detail: 'Tichetul se repetă; scadența se schimbă din aplicație.' }, { status: 409 })
  }

  if (wantsAssignee) {
    const raw = body.assigneeId as string | null
    if (raw === null || raw === '') {
      issueUpdate.assignee_id = null
    } else {
      const who = await resolveAssignee(raw, SUPABASE_URL, headers)
      if (!who) {
        return Response.json({ error: 'assignee_not_found' }, { status: 422 })
      }
      issueUpdate.assignee_id = who.id
    }
  }

  // Move to another project: new id with the target prefix, target wave, no theme.
  let movedFrom: string | null = null
  let dupProjectId = current.project_id

  if (wantsMove) {
    const target = await resolveProject(body.projectId as string, SUPABASE_URL, headers)
    if (!target) {
      return Response.json({ error: 'project_not_found' }, { status: 404 })
    }

    if (target.id !== current.project_id) {
      // Shape checks first: a malformed body should not earn a semantic error.
      if ('theme' in body && typeof body.theme !== 'string' && body.theme !== null) {
        return Response.json({ error: 'invalid_theme' }, { status: 400 })
      }

      if (hasDeps) {
        return Response.json({ error: 'cannot_move_and_set_deps' }, { status: 400 })
      }

      const enc = encodeURIComponent(id)
      const depRes = await fetch(
        `${SUPABASE_URL}/rest/v1/dependencies?or=(issue_id.eq.${enc},depends_on_id.eq.${enc})&select=issue_id,depends_on_id`,
        { headers }
      )
      if (!depRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const depRows = await depRes.json() as Array<{ issue_id: string; depends_on_id: string }>
      if (depRows.length > 0) {
        return Response.json({
          error: 'has_dependencies',
          dependsOn: depRows.filter(r => r.issue_id === id).map(r => r.depends_on_id),
          dependedOnBy: depRows.filter(r => r.depends_on_id === id).map(r => r.issue_id),
        }, { status: 409 })
      }

      const newId = await nextIssueId(target.id, target.prefix, SUPABASE_URL, headers)
      if (newId === null) return Response.json({ error: 'db_error' }, { status: 502 })

      // Wave: caller override, else the target project active wave. Must exist there.
      let wave = target.current_wave
      if ('wave' in body) {
        wave = Number(body.wave)
        if (!Number.isInteger(wave) || wave < 1) {
          return Response.json({ error: 'invalid_wave' }, { status: 400 })
        }
      }
      const waveRes = await fetch(
        `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(target.id)}&number=eq.${wave}&select=number&limit=1`,
        { headers }
      )
      if (!waveRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const waveRows = await waveRes.json() as Array<{ number: number }>
      if (!waveRows.length) {
        return Response.json({ error: 'wave_not_in_target' }, { status: 422 })
      }
      issueUpdate.wave = wave

      // Theme: cleared by default, because theme keys are per-project.
      // Normalizată mai sus: `""` înseamnă „fără temă”, nu cheia goală.
      const theme = (issueUpdate.theme as string | null | undefined) ?? null
      if (theme !== null) {
        const themeRes = await fetch(
          `${SUPABASE_URL}/rest/v1/themes?project_id=eq.${encodeURIComponent(target.id)}&key=eq.${encodeURIComponent(theme)}&select=key&limit=1`,
          { headers }
        )
        if (!themeRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
        const themeRows = await themeRes.json() as Array<{ key: string }>
        if (!themeRows.length) {
          return Response.json({ error: 'theme_not_in_target' }, { status: 422 })
        }
      }
      issueUpdate.theme = theme
      issueUpdate.id = newId
      issueUpdate.project_id = target.id
      movedFrom = id
      dupProjectId = target.id
    }
  }

  // Tema trebuie să existe în proiectul tichetului (la mutare s-a verificat mai sus, în țintă).
  if (!movedFrom && typeof issueUpdate.theme === 'string') {
    const ok = await themeExists(current.project_id, issueUpdate.theme, SUPABASE_URL, headers)
    if (ok === null) return Response.json({ error: 'db_error' }, { status: 502 })
    if (!ok) return Response.json({ error: 'theme_not_found', theme: issueUpdate.theme }, { status: 422 })
  }

  // Dup-check the effective title. A move must check against the target project
  // even when the title is unchanged, since the collision is new there.
  if ('title' in issueUpdate || movedFrom) {
    const wave = (issueUpdate.wave as number | undefined) ?? current.wave
    const effectiveTitle = (issueUpdate.title as string | undefined) ?? current.title
    const encoded = encodeURIComponent(effectiveTitle)
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${encodeURIComponent(dupProjectId)}&title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!dupRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const dups = await dupRes.json() as Array<{ id: string }>
    if (dups.length > 0) {
      return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
    }
  }

  // Validate deps IDs exist
  if (deps && deps.length > 0) {
    const depsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=in.(${deps.map(encodeURIComponent).join(',')})&select=id`,
      { headers }
    )
    if (!depsRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const existing = await depsRes.json() as Array<{ id: string }>
    const existingIds = new Set(existing.map(d => d.id))
    const unknown = deps.filter(d => !existingIds.has(d))
    if (unknown.length > 0) {
      return Response.json({ error: 'invalid_deps', unknown }, { status: 422 })
    }
  }

  // PATCH issue fields (if any)
  if (Object.keys(issueUpdate).length > 0) {
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(issueUpdate) }
    )
    if (!patchRes.ok) {
      let detail: unknown
      try {
        detail = await patchRes.json()
      } catch {
        // non-JSON error body from PostgREST — fall back to a bare db_error
      }
      return Response.json(
        { error: 'db_error', ...(detail !== undefined ? { detail } : {}) },
        { status: 502 }
      )
    }
    const patched = await patchRes.json() as Array<unknown>
    if (!patched.length) return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Replace deps (delete all, re-insert)
  if (hasDeps) {
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dependencies?issue_id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers }
    )
    if (!delRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    if (deps && deps.length > 0) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/dependencies`, {
        method: 'POST',
        headers,
        body: JSON.stringify(deps.map(depId => ({ issue_id: id, depends_on_id: depId }))),
      })
      if (!insRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    }
  }

  const dbToClient: Record<string, string> = {
    ...Object.fromEntries(Object.entries(FIELD_MAP).map(([client, db]) => [db, client])),
    assignee_id: 'assigneeId',
    pinned_at: 'pinned',
  }
  const updatedFields = [
    ...Object.keys(issueUpdate)
      .filter(k => k !== 'id' && k !== 'project_id' && k !== 'due_at' && k !== 'all_day' && k !== 'remind_at')
      .map(k => dbToClient[k] ?? k),
    ...(movedFrom ? ['projectId'] : []),
    ...(hasDeps ? ['deps'] : []),
    ...(wantsDue ? ['due'] : []),
  ]
  const finalId = (issueUpdate.id as string | undefined) ?? id
  return Response.json({
    id: finalId,
    ...(movedFrom ? { movedFrom } : {}),
    updated: updatedFields,
  })
}

// DELETE /api/tickets/<id> — repară o încărcare greșită. API-ul scrie cu cheia de
// serviciu, deci o ștergere nu se poate anula: se refuză tot ce ar pierde muncă
// sau ar rupe alt tichet — tichete care depind de el, comentarii / pase,
// fișiere (ar rămâne orfane în Storage). Dependențele LUI, vizitele și
// legăturile cu obstacole pleacă odată cu el (`on delete cascade`).
// Din migration-trash.sql ștergerea trece și ea prin coș (`deleted_by` null),
// dar refuzurile rămân: un tichet abia încărcat n-are ce pierde.
// Asumat: verificările și ștergerea nu sunt o tranzacție. Un comentariu scris
// exact între ele ar pleca odată cu tichetul — fereastra e de milisecunde, iar
// ruta e pentru tichete abia încărcate, pe care nu scrie nimeni.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const enc = encodeURIComponent(id)
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const get = async <T>(path: string): Promise<T[] | null> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
    return res.ok ? await res.json() as T[] : null
  }
  const [issue, dependents, events, files] = await Promise.all([
    get<{ id: string }>(`issues?id=eq.${enc}&select=id&limit=1`),
    get<{ issue_id: string }>(`dependencies?depends_on_id=eq.${enc}&select=issue_id`),
    get<{ id: string }>(`issue_events?issue_id=eq.${enc}&select=id&limit=1`),
    get<{ id: string }>(`attachments?issue_id=eq.${enc}&select=id&limit=1`),
  ])
  if (!issue || !dependents || !events || !files) return Response.json({ error: 'db_error' }, { status: 502 })
  if (!issue.length) return Response.json({ error: 'not_found' }, { status: 404 })
  if (dependents.length) {
    return Response.json({ error: 'has_dependents', dependedOnBy: dependents.map((d) => d.issue_id) }, { status: 409 })
  }
  if (events.length || files.length) {
    return Response.json({
      error: 'has_activity',
      detail: 'Tichetul are comentarii sau fișiere; se șterge din aplicație.',
    }, { status: 409 })
  }

  const del = await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${enc}`, { method: 'DELETE', headers })
  if (!del.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const gone = await del.json().catch(() => []) as unknown[]
  if (!gone.length) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ id, deleted: true })
}
