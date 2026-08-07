import { describe, it, expect, afterEach } from 'vitest'
import { onRequestGet, onRequestPost } from './tickets'

// ---- handler test harness ----

interface Call { url: string; method: string; body?: any }
interface Route {
  match: (url: string, method: string) => boolean
  respond: () => { ok?: boolean; status?: number; body: unknown }
}

const SB = 'https://db.test'
const realFetch = globalThis.fetch

// Routes are tried in order; the first match wins, so put specific ones first.
function route(
  needle: string,
  body: unknown,
  opts: { ok?: boolean; status?: number; method?: string } = {}
): Route {
  return {
    match: (url, method) => url.includes(needle) && (!opts.method || method === opts.method),
    respond: () => ({ body, ok: opts.ok, status: opts.status }),
  }
}

function mockFetch(routes: Route[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const method = String(init.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
    const hit = routes.find(r => r.match(url, method))
    if (!hit) throw new Error(`unmocked fetch: ${method} ${url}`)
    const { ok = true, status = 200, body } = hit.respond()
    return { ok, status, json: async () => body } as any
  }) as any
  return calls
}

const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', TICKETS_API_KEY: 'api-key' }

function getCtx(query: string): any {
  return { env, request: new Request(`https://app.test/api/tickets?${query}`) }
}

function postCtx(body: unknown): any {
  return {
    env,
    request: new Request('https://app.test/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

const projectRoute = route('/rest/v1/projects?', [{ id: 'horizontal', prefix: 'MS', current_wave: 1 }])

afterEach(() => { globalThis.fetch = realFetch })

// Wave 0 is the Scratchpad wave. Falsy checks used to treat it as "missing".
describe('wave 0 is a real wave', () => {
  it('lists tickets in wave 0 instead of rejecting it', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.horizontal', [{ id: 'MS-161', title: 'Nota', wave: 0, done: false }]),
    ])
    const res = await onRequestGet(getCtx('project=MS&wave=0'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'MS-161', title: 'Nota', wave: 0, done: false }])
    expect(calls.some(c => c.url.includes('wave=eq.0'))).toBe(true)
  })

  it('looks up a ticket by title in wave 0', async () => {
    mockFetch([
      projectRoute,
      route('&title=ilike.', [{ id: 'MS-161', title: 'Nota', wave: 0, done: false }]),
    ])
    const res = await onRequestGet(getCtx('project=MS&title=Nota&wave=0'))
    expect(res.status).toBe(200)
  })

  it('creates a ticket directly in wave 0', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.horizontal&select=id', [{ id: 'MS-160' }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues', [{ id: 'MS-161' }], { method: 'POST' }),
    ])
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 0 }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 'MS-161', wave: 0 })
    const insert = calls.find(c => c.method === 'POST')!
    expect(insert.body.wave).toBe(0)
  })

  it('scopes the create dup-check to wave 0, not to the string "0"', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.horizontal&select=id', [{ id: 'MS-160' }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues', [{ id: 'MS-161' }], { method: 'POST' }),
    ])
    await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: '0' }))
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain('wave=eq.0')
  })
})

describe('wave validation still rejects bad input', () => {
  it('rejects a negative wave on list', async () => {
    mockFetch([projectRoute])
    const res = await onRequestGet(getCtx('project=MS&wave=-1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_wave' })
  })

  it('rejects a non-integer wave on list', async () => {
    mockFetch([projectRoute])
    const res = await onRequestGet(getCtx('project=MS&wave=abc'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_wave' })
  })

  it('rejects a create with no wave at all', async () => {
    mockFetch([])
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_fields' })
  })

  it('rejects a create with a negative wave', async () => {
    mockFetch([])
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: -2 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_wave' })
  })
})
