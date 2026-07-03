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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const project = url.searchParams.get('project')?.toLowerCase()
  const title = url.searchParams.get('title')
  const waveParam = url.searchParams.get('wave')

  if (!project) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

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
