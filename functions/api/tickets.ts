// functions/api/tickets.ts

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

interface SupabaseIssue {
  id: string
  title: string
  wave: number
  done: boolean
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

async function resolveProject(
  param: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<{ id: string; prefix: string } | null> {
  const encoded = encodeURIComponent(param)
  const res = await fetch(
    `${supabaseUrl}/rest/v1/projects?or=(id.eq.${encoded},name.ilike.${encoded})&select=id,prefix&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string; prefix: string }>
  return rows[0] ?? null
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const projectParam = url.searchParams.get('project')
  const title = url.searchParams.get('title')
  const waveParam = url.searchParams.get('wave')

  if (!projectParam) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const proj = await resolveProject(projectParam, SUPABASE_URL, headers)
  if (!proj) {
    return Response.json({ error: 'project_not_found' }, { status: 404 })
  }
  const project = proj.id

  // LIST mode: no title param — return all tickets for project, optionally filtered by wave
  if (!title) {
    let filter = `project_id=eq.${project}`
    if (waveParam) {
      const waveNum = Number(waveParam)
      if (!Number.isInteger(waveNum) || waveNum < 1) {
        return Response.json({ error: 'invalid_wave' }, { status: 400 })
      }
      filter += `&wave=eq.${waveNum}`
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?${filter}&select=id,title,wave,done&order=id.asc`,
      { headers }
    )
    if (!res.ok) {
      return Response.json({ error: 'db_error' }, { status: 502 })
    }
    const data = await res.json() as SupabaseIssue[]
    return Response.json(data)
  }

  // LOOKUP mode: title provided — return single ticket or 404
  if (!waveParam) {
    return Response.json({ error: 'missing_params', required: ['project', 'title', 'wave'] }, { status: 400 })
  }
  const waveNum = Number(waveParam)
  if (!Number.isInteger(waveNum) || waveNum < 1) {
    return Response.json({ error: 'invalid_wave' }, { status: 400 })
  }

  const encoded = encodeURIComponent(title)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${project}&title=ilike.${encoded}&wave=eq.${waveNum}&select=id,title,wave,done&limit=1`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const data = await res.json() as SupabaseIssue[]

  if (!data.length) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json(data[0])
}

interface CreateBody {
  projectId: string
  title: string
  wave: number
  deps?: string[]
  theme?: string | null
  desc?: string
  notes?: string
  assigneeId?: string | null
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: CreateBody
  try {
    body = await context.request.json() as CreateBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { projectId, title, wave } = body
  const deps = body.deps ?? []

  if (!projectId || !title || !wave) {
    return Response.json({ error: 'missing_fields', required: ['projectId', 'title', 'wave'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const projResolved = await resolveProject(projectId, SUPABASE_URL, headers)
  if (!projResolved) {
    return Response.json({ error: 'project_not_found' }, { status: 404 })
  }
  const pid = projResolved.id

  // 1. Validate deps exist
  if (deps.length > 0) {
    const depsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=in.(${deps.join(',')})&select=id`,
      { headers }
    )
    if (!depsRes.ok) {
      return Response.json({ error: 'db_error' }, { status: 502 })
    }
    const existing = await depsRes.json() as Array<{ id: string }>
    const existingIds = new Set(existing.map(d => d.id))
    const unknown = deps.filter(d => !existingIds.has(d))
    if (unknown.length > 0) {
      return Response.json({ error: 'invalid_deps', unknown }, { status: 422 })
    }
  }

  const prefix = projResolved.prefix

  // 2. Compute next ID
  const issuesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&select=id`,
    { headers }
  )
  if (!issuesRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const existingIssues = await issuesRes.json() as Array<{ id: string }>
  const maxNum = existingIssues
    .map(r => Number(r.id.slice(prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  const newId = `${prefix}-${String(maxNum + 1).padStart(2, '0')}`

  // 4. Check for duplicate title in same wave
  const encoded = encodeURIComponent(title)
  const dupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&title=ilike.${encoded}&wave=eq.${wave}&select=id&limit=1`,
    { headers }
  )
  if (!dupRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const dups = await dupRes.json() as Array<{ id: string }>
  if (dups.length > 0) {
    return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
  }

  // 5. Insert issue
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: newId,
      project_id: pid,
      title,
      details: body.desc ?? '',
      theme: body.theme ?? null,
      wave: Number(wave),
      done: false,
      selectors: [],
      scenarios: [],
      notes: body.notes ?? '',
      assignee_id: body.assigneeId ?? null,
    }),
  })
  if (!insertRes.ok) {
    const err = await insertRes.json()
    return Response.json({ error: 'insert_failed', detail: err }, { status: 500 })
  }

  // 6. Insert dependencies
  if (deps.length > 0) {
    const depsInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/dependencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deps.map(depId => ({ issue_id: newId, depends_on_id: depId }))),
    })
    if (!depsInsertRes.ok) {
      const err = await depsInsertRes.json()
      return Response.json({ error: 'deps_insert_failed', detail: err }, { status: 500 })
    }
  }

  return Response.json({ id: newId, title, wave: Number(wave), deps }, { status: 201 })
}
