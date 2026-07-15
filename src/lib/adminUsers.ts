import { supabase } from './supabase'
import type { ProjectRole } from './access'

export interface AccessEntry { project_id: string; role: ProjectRole }
export interface AdminUser { id: string; email: string; access: AccessEntry[] }

async function call<T>(action: string, payload?: unknown): Promise<T> {
  if (!supabase) throw new Error('Supabase indisponibil.')
  const body = payload === undefined ? { action } : { action, payload }
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw new Error(error.message)
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
