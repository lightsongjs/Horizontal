// supabase/functions/admin-users/index.ts
// Admin-only user management. Guards on app_metadata.role === 'admin'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const validAccess = (access: { project_id: string; role: string }[] | undefined) =>
  (access ?? []).every((a) => a.role === 'read' || a.role === 'write')

type Admin = ReturnType<typeof createClient>

/**
 * Numele afisat al unui cont = randul din `assignees` legat prin `user_id`.
 *
 * Scriem aici, cu cheia de serviciu, nu prin `ensure_project_assignee`: aceea
 * cere ca apelantul sa fie membru al unui PROIECT anume, iar adminul care
 * boteaza un cont nu are (si nu trebuie sa aiba) un proiect in mana.
 *
 * Select-then-write, nu `upsert`: indexul unic de pe `assignees.user_id` e
 * PARTIAL (`where user_id is not null`, vezi migration-comments.sql), iar un
 * `on conflict (user_id)` simplu nu se potriveste cu el.
 */
async function writeName(admin: Admin, user_id: string, name: string | null) {
  const { data: row, error: selErr } = await admin
    .from('assignees').select('id').eq('user_id', user_id).maybeSingle()
  if (selErr) return selErr.message

  if (!name) {
    // Gol pe un cont fara rand = nu e nimic de facut. Gol pe un cont care ARE
    // deja un nume ar insemna sa stergem randul — dar de el atarna
    // `issues.assignee_id` si istoricul pasarilor, deci se refuza aici.
    return row ? 'Numele nu poate fi sters. Scrie altul.' : null
  }
  const { error } = row
    ? await admin.from('assignees').update({ name }).eq('id', row.id)
    : await admin.from('assignees').insert({ name, user_id })
  return error?.message ?? null
}

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
      const { data: named } = await admin.from('assignees').select('user_id, name').not('user_id', 'is', null)
      const users = (data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        name: (named ?? []).find((a) => a.user_id === u.id)?.name ?? null,
        admin: u.app_metadata?.role === 'admin',
        access: (members ?? []).filter((m) => m.user_id === u.id).map((m) => ({ project_id: m.project_id, role: m.role })),
      }))
      return json({ users })
    }

    if (action === 'create_user') {
      const { email, password, name, access } = payload as { email: string; password: string; name: string | null; access: { project_id: string; role: string }[] }
      if (!validAccess(access)) return json({ error: 'invalid role (must be read or write)' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) return json({ error: error.message }, 400)
      // Contul exista deja aici. Un nume care nu se scrie nu mai justifica
      // anularea lui, deci esecul se raporteaza dupa ce accesul e pus.
      const nameErr = await writeName(admin, data.user.id, name ?? null)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id: data.user.id, project_id: a.project_id, role: a.role }))
        const { error: mErr } = await admin.from('project_members').insert(rows)
        if (mErr) return json({ error: mErr.message }, 400)
      }
      if (nameErr) return json({ error: nameErr }, 400)
      return json({ id: data.user.id })
    }

    if (action === 'set_access') {
      const { user_id, access } = payload as { user_id: string; access: { project_id: string; role: string }[] }
      if (!validAccess(access)) return json({ error: 'invalid role (must be read or write)' }, 400)
      // NOTE: delete-then-insert is not transactional; on insert failure the
      // caller gets a 400 and should retry. Acceptable for this admin tool.
      await admin.from('project_members').delete().eq('user_id', user_id)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id, project_id: a.project_id, role: a.role }))
        const { error } = await admin.from('project_members').insert(rows)
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    if (action === 'set_name') {
      const { user_id, name } = payload as { user_id: string; name: string | null }
      const err = await writeName(admin, user_id, name ?? null)
      return err ? json({ error: err }, 400) : json({ ok: true })
    }

    if (action === 'reset_password') {
      const { user_id, password } = payload as { user_id: string; password: string }
      const { error } = await admin.auth.admin.updateUserById(user_id, { password })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    if (action === 'delete_user') {
      const { user_id } = payload as { user_id: string }
      // Refuzat pe server, nu doar ascuns din interfata (`UsersView` nu-ti
      // arata propriul rand): un buton ascuns nu e o regula. Stergerea
      // propriului cont de admin e singura actiune din aplicatie dupa care
      // nu mai exista nimeni care sa-ti dea accesul inapoi — doar
      // `scripts/set-admin.mjs`, din linia de comanda.
      if (user_id === userData.user!.id)
        return json({ error: 'Nu-ti poti sterge propriul cont.' }, 400)
      const { error } = await admin.auth.admin.deleteUser(user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
