import { describe, it, expect, afterEach } from 'vitest'
import { onRequestGet } from './waves'

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

function ctx(query: string): any {
  return { env, request: new Request(`https://app.test/api/waves?${query}`) }
}

afterEach(() => { globalThis.fetch = realFetch })

describe('GET /api/waves', () => {
  it('returns the wave numbers with their names, wave 0 included', async () => {
    const urls = mockFetch((url) => {
      if (url.includes('/rest/v1/projects?')) return { body: [{ id: 'horizontal', prefix: 'MS', current_wave: 1 }] }
      return {
        body: [
          { number: 0, name: 'Scratchpad', label: null },
          { number: 1, name: 'Val 1', label: 'MVP' },
        ],
      }
    })
    const res = await onRequestGet(ctx('project=MS'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { number: 0, name: 'Scratchpad', label: '' },
      { number: 1, name: 'Val 1', label: 'MVP' },
    ])
    expect(urls.some(u => u.includes('/rest/v1/waves?project_id=eq.horizontal'))).toBe(true)
  })

  it('requires a project param', async () => {
    mockFetch(() => ({ body: [] }))
    const res = await onRequestGet(ctx(''))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_params' })
  })

  it('404s on an unknown project', async () => {
    mockFetch(() => ({ body: [] }))
    const res = await onRequestGet(ctx('project=Nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'project_not_found' })
  })

  it('502s when the waves query fails', async () => {
    mockFetch((url) => {
      if (url.includes('/rest/v1/projects?')) return { body: [{ id: 'horizontal', prefix: 'MS', current_wave: 1 }] }
      return { ok: false, body: {} }
    })
    const res = await onRequestGet(ctx('project=MS'))
    expect(res.status).toBe(502)
  })
})
