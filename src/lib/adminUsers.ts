import { supabase } from './supabase'
import { errorMessage } from './errorMessage'
import type { ProjectRole } from './access'

export interface AccessEntry { project_id: string; role: ProjectRole }
/**
 * `name` e rândul din `assignees` legat prin `user_id` — ACELAȘI nume pe care
 * îl vede toată lumea în „Assigned to", pe carduri și în fir. `null` înseamnă
 * „contul n-are încă rând"; interfața cade atunci pe partea locală a
 * emailului (`memberDisplayName`), ca până acum. Nu există o a doua coloană
 * de nume pe cont: ar fi al doilea adevăr, iar cele două ar diverge.
 */
export interface AdminUser {
  id: string
  email: string
  name: string | null
  /**
   * `app_metadata.role === 'admin'`. Un admin vede și scrie tot prin
   * `is_admin()`, fără niciun rând în `project_members` — a-i arăta „0
   * proiecte" ar fi o minciună, nu o listă goală.
   */
  admin: boolean
  access: AccessEntry[]
}

/** Un nume gol e o absență, nu o valoare — serverul primește `null`, nu `''`. */
const cleanName = (name: string): string | null => name.trim() || null

/**
 * Ce a spus de fapt funcția edge.
 *
 * `functions.invoke` aruncă un `FunctionsHttpError` cu mesajul fix „Edge
 * Function returned a non-2xx status code" pentru ORICE răspuns non-2xx, iar
 * motivul adevărat („Password should be at least 6 characters.") stă în corpul
 * răspunsului, agățat de eroare ca `context`. Fără despachetarea asta, orice
 * greșeală de administrare arată identic și nu se poate repara.
 */
async function edgeMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) {
    try {
      const msg = errorMessage(await ctx.json())
      if (msg !== 'Eroare necunoscută') return msg
    } catch {
      // Corp gol sau non-JSON: rămâne mesajul generic, tot mai bun decât nimic.
    }
  }
  return errorMessage(error)
}

async function call<T>(action: string, payload?: unknown): Promise<T> {
  if (!supabase) throw new Error('Supabase indisponibil.')
  const body = payload === undefined ? { action } : { action, payload }
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw new Error(await edgeMessage(error))
  if (data && typeof data === 'object' && 'error' in data && data.error)
    throw new Error(String((data as { error: unknown }).error))
  return data as T
}

export async function listUsers(): Promise<AdminUser[]> {
  const { users } = await call<{ users: AdminUser[] }>('list_users')
  return users
}
export async function createUser(email: string, password: string, name: string, access: AccessEntry[]): Promise<string> {
  const { id } = await call<{ id: string }>('create_user', { email, password, name: cleanName(name), access })
  return id
}
export async function setName(user_id: string, name: string): Promise<void> {
  await call('set_name', { user_id, name: cleanName(name) })
}
export async function setAccess(user_id: string, access: AccessEntry[]): Promise<void> {
  await call('set_access', { user_id, access })
}
export async function resetPassword(user_id: string, password: string): Promise<void> {
  await call('reset_password', { user_id, password })
}
export async function deleteUser(user_id: string): Promise<void> {
  await call('delete_user', { user_id })
}
