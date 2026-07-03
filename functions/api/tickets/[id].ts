// functions/api/tickets/[id].ts

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

const FIELD_MAP: Record<string, string> = {
  title: 'title',
  desc: 'details',
  theme: 'theme',
  wave: 'wave',
  done: 'done',
  notes: 'notes',
  selectors: 'selectors',
  scenarios: 'scenarios',
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

export function buildIssueUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  for (const [clientKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (clientKey in body) update[dbKey] = body[clientKey]
  }
  return update
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const issueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id,title,details,theme,wave,done,notes,assignee_id,selectors,scenarios&limit=1`,
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
  const deps = hasDeps ? (body.deps as string[]) : null

  if (Object.keys(issueUpdate).length === 0 && !hasDeps) {
    return Response.json({ error: 'no_updatable_fields' }, { status: 400 })
  }

  // Dup-check when title is being renamed
  if ('title' in issueUpdate) {
    let wave = issueUpdate.wave as number | undefined
    if (wave === undefined) {
      const currentRes = await fetch(
        `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=wave&limit=1`,
        { headers }
      )
      if (!currentRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const current = await currentRes.json() as Array<{ wave: number }>
      if (!current.length) return Response.json({ error: 'not_found' }, { status: 404 })
      wave = current[0].wave
    }
    const encoded = encodeURIComponent(issueUpdate.title as string)
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
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
    if (!patchRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const patched = await patchRes.json() as Array<unknown>
    if (!patched.length) return Response.json({ error: 'not_found' }, { status: 404 })
  } else {
    // Only deps update — verify ticket exists
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!checkRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const check = await checkRes.json() as Array<{ id: string }>
    if (!check.length) return Response.json({ error: 'not_found' }, { status: 404 })
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

  const updatedFields = [...Object.keys(issueUpdate), ...(hasDeps ? ['deps'] : [])]
  return Response.json({ id, updated: updatedFields })
}
