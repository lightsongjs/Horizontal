// functions/api/tickets/[id].ts

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
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
