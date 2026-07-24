// functions/api/projects.ts

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

  return Response.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      prefix: p.prefix,
      currentWave: p.current_wave,
      accent: p.accent ?? null,
      type: (p.type ?? 'personal') as 'personal' | 'work',
    }))
  )
}
