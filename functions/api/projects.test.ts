// POST /api/projects: aceleași reguli ca formularul din aplicație
// (src/lib/newProject.ts), cu refuzul prefixului ocupat.
import { describe, it, expect, afterEach } from 'vitest'
import * as projects from './projects'

interface Call { url: string; method: string; body?: any }
interface Route { match: (url: string, method: string) => boolean; respond: () => { ok?: boolean; status?: number; body: unknown } }

const SB = 'https://db.test'
const realFetch = globalThis.fetch
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', TICKETS_API_KEY: 'api-key' }

function route(needle: string, body: unknown, opts: { ok?: boolean; status?: number; method?: string } = {}): Route {
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
function post(body: unknown): any {
  return {
    env,
    params: {},
    request: new Request('https://app.test/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  }
}

const existing = route('/rest/v1/projects?select=id,prefix', [{ id: 'horizontal', prefix: 'HZ' }, { id: 'kata', prefix: 'KATA' }], { method: 'GET' })
const okInserts = [route('/rest/v1/projects', [], { method: 'POST', status: 201 }), route('/rest/v1/waves', [], { method: 'POST', status: 201 })]

afterEach(() => { globalThis.fetch = realFetch })

describe('POST /api/projects', () => {
  it('ca formularul: prefix din nume, id = prefixul mic, valul 1, cele două valuri', async () => {
    const calls = mockFetch([existing, ...okInserts])
    const res = await projects.onRequestPost(post({ name: '  Turul României ', type: 'work' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'tr', name: 'Turul României', description: '', prefix: 'TR', currentWave: 1, accent: '#0EA5E9', type: 'work',
    })
    const posts = calls.filter(c => c.method === 'POST')
    expect(posts[0].url).toBe(`${SB}/rest/v1/projects`)
    expect(posts[0].body).toEqual({ id: 'tr', name: 'Turul României', description: '', prefix: 'TR', current_wave: 1, accent: '#0EA5E9', type: 'work' })
    expect(posts[1].body).toEqual([
      { project_id: 'tr', number: 0, name: 'Scratchpad', label: '', position: 0 },
      { project_id: 'tr', number: 1, name: 'Val 1', label: 'MVP', position: 1 },
    ])
  })

  it('prefixul dat se curăță; tipul implicit e personal; culoarea dată rămâne', async () => {
    const calls = mockFetch([existing, ...okInserts])
    const res = await projects.onRequestPost(post({ name: 'X', prefix: 'tur-ism 9', accent: '#ffb454' }))
    expect(await res.json()).toMatchObject({ id: 'turism', prefix: 'TURISM', type: 'personal', accent: '#ffb454' })
    expect(calls.find(c => c.method === 'POST')!.body).toMatchObject({ id: 'turism', prefix: 'TURISM' })
  })

  it('409 pe un prefix ocupat (după prefix sau după id), fără nicio scriere', async () => {
    const calls = mockFetch([existing])
    const byPrefix = await projects.onRequestPost(post({ name: 'Altceva', prefix: 'hz' }))
    expect(byPrefix.status).toBe(409)
    expect(await byPrefix.json()).toEqual({ error: 'prefix_taken', prefix: 'HZ', existing_project: 'horizontal' })
    const byId = await projects.onRequestPost(post({ name: 'K', prefix: 'Kata' }))
    expect(byId.status).toBe(409)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('409 și când cheia primară prinde o creare simultană', async () => {
    mockFetch([route('/rest/v1/projects?select=id,prefix', [], { method: 'GET' }), route('/rest/v1/projects', { code: '23505' }, { method: 'POST', ok: false, status: 409 })])
    const res = await projects.onRequestPost(post({ name: 'Nou', prefix: 'NOU' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'prefix_taken', existing_project: 'nou' })
  })

  it('valurile eșuate scot proiectul la loc', async () => {
    const calls = mockFetch([
      existing,
      route('/rest/v1/projects?id=eq.nou', [], { method: 'DELETE' }),
      route('/rest/v1/projects', [], { method: 'POST', status: 201 }),
      route('/rest/v1/waves', { message: 'boom' }, { method: 'POST', ok: false, status: 500 }),
    ])
    const res = await projects.onRequestPost(post({ name: 'Nou', prefix: 'NOU' }))
    expect(res.status).toBe(500)
    expect(calls.some(c => c.method === 'DELETE' && c.url.includes('id=eq.nou'))).toBe(true)
  })

  it('400: fără nume, prefix fără nicio literă, tip sau culoare greșite', async () => {
    mockFetch([existing, ...okInserts])
    expect((await projects.onRequestPost(post({ prefix: 'X' }))).status).toBe(400)
    const noPrefix = await projects.onRequestPost(post({ name: 'Știri' }))
    expect(noPrefix.status).toBe(400)
    expect(await noPrefix.json()).toMatchObject({ error: 'invalid_prefix' })
    expect((await projects.onRequestPost(post({ name: 'X', type: 'job' }))).status).toBe(400)
    expect((await projects.onRequestPost(post({ name: 'X', accent: 'red' }))).status).toBe(400)
  })
})
