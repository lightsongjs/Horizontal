// functions/api/assignees.ts
// GET /api/assignees — oamenii cărora li se poate da un tichet.
// `assignees` e o tabelă globală, fără project_id: `issues.assignee_id` și
// `issue_events.handoff_to` o referă direct, deci lista e aceeași peste tot.

import { sbHeaders } from './_tickets-lib'

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

interface SupabaseAssignee {
  id: string
  name: string
  user_id: string | null
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/assignees?select=id,name,user_id&order=name.asc`,
    { headers }
  )
  if (!res.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const rows = await res.json() as SupabaseAssignee[]

  // `linked` = rândul are un cont: numai un astfel de om poate fi autorul unui
  // comentariu (`author`). Id-ul contului nu iese din API.
  return Response.json(rows.map((a) => ({ id: a.id, name: a.name, linked: !!a.user_id })))
}
