// supabase/functions/admin-users/index.ts
// Admin-only user management. Guards on app_metadata.role === 'admin'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Guard: verify caller is an admin.
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'missing token' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || userData.user?.app_metadata?.role !== 'admin')
    return json({ error: 'forbidden' }, 403)

  const { action, payload } = await req.json()

  try {
    if (action === 'list_users') {
      const { data } = await admin.auth.admin.listUsers()
      const { data: members } = await admin.from('project_members').select('user_id, project_id, role')
      const users = (data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        access: (members ?? []).filter((m) => m.user_id === u.id).map((m) => ({ project_id: m.project_id, role: m.role })),
      }))
      return json({ users })
    }

    if (action === 'create_user') {
      const { email, password, access } = payload as { email: string; password: string; access: { project_id: string; role: string }[] }
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) return json({ error: error.message }, 400)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id: data.user.id, project_id: a.project_id, role: a.role }))
        const { error: mErr } = await admin.from('project_members').insert(rows)
        if (mErr) return json({ error: mErr.message }, 400)
      }
      return json({ id: data.user.id })
    }

    if (action === 'set_access') {
      const { user_id, access } = payload as { user_id: string; access: { project_id: string; role: string }[] }
      await admin.from('project_members').delete().eq('user_id', user_id)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id, project_id: a.project_id, role: a.role }))
        const { error } = await admin.from('project_members').insert(rows)
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    if (action === 'reset_password') {
      const { user_id, password } = payload as { user_id: string; password: string }
      const { error } = await admin.auth.admin.updateUserById(user_id, { password })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    if (action === 'delete_user') {
      const { user_id } = payload as { user_id: string }
      const { error } = await admin.auth.admin.deleteUser(user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
