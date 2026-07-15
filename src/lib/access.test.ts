import { describe, expect, it } from 'vitest'
import { isAdminSession, buildAccessMap } from './access'

describe('isAdminSession', () => {
  it('true when app_metadata.role is admin', () => {
    const session = { user: { app_metadata: { role: 'admin' } } } as never
    expect(isAdminSession(session)).toBe(true)
  })
  it('false when role missing or not admin', () => {
    expect(isAdminSession({ user: { app_metadata: {} } } as never)).toBe(false)
    expect(isAdminSession(null)).toBe(false)
  })
})

describe('buildAccessMap', () => {
  it('maps project_id to role', () => {
    const rows = [
      { project_id: 'a', role: 'read' as const },
      { project_id: 'b', role: 'write' as const },
    ]
    expect(buildAccessMap(rows)).toEqual({ a: 'read', b: 'write' })
  })
  it('returns empty object for empty input', () => {
    expect(buildAccessMap([])).toEqual({})
  })
})
