import { supabase } from './supabase'
import { errorMessage } from './errorMessage'
import type { ProjectRole } from './access'

export interface AccessEntry { project_id: string; role: ProjectRole }
export interface AdminUser { id: string; email: string; access: AccessEntry[] }

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
export async function createUser(email: string, password: string, access: AccessEntry[]): Promise<string> {
  const { id } = await call<{ id: string }>('create_user', { email, password, access })
  return id
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
