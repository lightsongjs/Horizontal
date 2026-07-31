import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildIssueUpdate, onRequestPatch } from './[id]'

describe('buildIssueUpdate', () => {
  it('maps desc to details', () => {
    expect(buildIssueUpdate({ desc: 'hello' })).toEqual({ details: 'hello' })
  })
  it('maps title as-is', () => {
    expect(buildIssueUpdate({ title: 'New title' })).toEqual({ title: 'New title' })
  })
  it('ignores unknown keys', () => {
    expect(buildIssueUpdate({ unknown: 'x', title: 'T' })).toEqual({ title: 'T' })
  })
  it('returns empty object for empty body', () => {
    expect(buildIssueUpdate({})).toEqual({})
  })
  it('maps multiple fields at once', () => {
    expect(buildIssueUpdate({ title: 'T', wave: 2, done: true })).toEqual({ title: 'T', wave: 2, done: true })
  })
  it('maps selectors and scenarios', () => {
    expect(buildIssueUpdate({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] }))
      .toEqual({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] })
  })
  it('does not include deps (relation handled separately)', () => {
    expect(buildIssueUpdate({ title: 'T', deps: ['KATA-01'] })).toEqual({ title: 'T' })
  })
})

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
    match: (url, method) =>
      url.includes(needle) && (!opts.method || method === opts.method),
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

function patchCtx(id: string, body: unknown): any {
  return {
    params: { id },
    env: {
      SUPABASE_URL: SB,
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TICKETS_API_KEY: 'api-key',
    },
    request: new Request(`https://app.test/api/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

afterEach(() => { globalThis.fetch = realFetch })

describe('onRequestPatch harness', () => {
  it('rejects a body with no updatable fields', async () => {
    mockFetch([])
    const res = await onRequestPatch(patchCtx('HZ-07', { nonsense: 1 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_updatable_fields' })
  })
})

describe('onRequestPatch title dup-check', () => {
  it('scopes the dup-check to the ticket own project', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'New title' }))
    expect(res.status).toBe(200)
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain('project_id=eq.horizontal')
    expect(dup.url).toContain('wave=eq.3')
    expect(dup.url).toContain('id=neq.HZ-07')
  })

  it('reports a duplicate inside the same project', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', [{ id: 'HZ-11' }]),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'Taken' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_title', existing_id: 'HZ-11' })
  })
})
