import { describe, it, expect, afterEach } from 'vitest'
import { onRequestGet } from './assignees'
import { assigneeFilter } from './_tickets-lib'

const SB = 'https://db.test'
const realFetch = globalThis.fetch

function mockFetch(handler: (url: string) => { ok?: boolean; body: unknown }): string[] {
  const urls: string[] = []
  globalThis.fetch = (async (input: any) => {
    const url = String(input)
    urls.push(url)
    const { ok = true, body } = handler(url)
    return { ok, status: ok ? 200 : 500, json: async () => body } as any
  }) as any
  return urls
}

const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', TICKETS_API_KEY: 'api-key' }

function ctx(): any {
  return { env, request: new Request('https://app.test/api/assignees') }
}

afterEach(() => { globalThis.fetch = realFetch })

describe('GET /api/assignees', () => {
  it('returns id and name for every person, ordered by name', async () => {
    const urls = mockFetch(() => ({
      body: [
        { id: 'a3fa07cf-b1ac-4b2e-8895-a855e1c55929', name: 'Ionut' },
        { id: 'e9f3d61d-991d-40c3-90bb-80f5a8c8605d', name: 'Mihai' },
      ],
    }))
    const res = await onRequestGet(ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'a3fa07cf-b1ac-4b2e-8895-a855e1c55929', name: 'Ionut' },
      { id: 'e9f3d61d-991d-40c3-90bb-80f5a8c8605d', name: 'Mihai' },
    ])
    expect(urls[0]).toContain('/rest/v1/assignees?select=id,name&order=name.asc')
  })

  it('returns an empty list when nobody is registered', async () => {
    mockFetch(() => ({ body: [] }))
    const res = await onRequestGet(ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('502s when the query fails', async () => {
    mockFetch(() => ({ ok: false, body: {} }))
    const res = await onRequestGet(ctx())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'db_error' })
  })
})

// A uuid goes to the id column, anything else to the name column: PostgREST
// rejects the whole query when a non-uuid reaches a uuid column.
describe('assigneeFilter', () => {
  it('filters by id when the value is a uuid', () => {
    expect(assigneeFilter('a3fa07cf-b1ac-4b2e-8895-a855e1c55929'))
      .toBe('id=eq.a3fa07cf-b1ac-4b2e-8895-a855e1c55929')
  })
  it('filters by name for anything else', () => {
    expect(assigneeFilter('Ionut')).toBe('name=ilike.Ionut')
  })
  it('escapes a name with spaces', () => {
    expect(assigneeFilter('Ana Maria')).toBe('name=ilike.Ana%20Maria')
  })
})
