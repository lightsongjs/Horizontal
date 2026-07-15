import type { Session } from '@supabase/supabase-js'

export type ProjectRole = 'read' | 'write'
export type AccessMap = Record<string, ProjectRole>

export function isAdminSession(session: Session | null): boolean {
  return session?.user?.app_metadata?.role === 'admin'
}

export function buildAccessMap(
  rows: { project_id: string; role: ProjectRole }[],
): AccessMap {
  const map: AccessMap = {}
  for (const r of rows) map[r.project_id] = r.role
  return map
}
