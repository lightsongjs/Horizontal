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
      route('/rest/v1/issues?project_id=eq.horizontal', [{ id: 'MS-161', project_id: 'horizontal', title: 'Nota', wave: 0, done: false }]),
      route('/rest/v1/dependencies?', []),
    ])
    const res = await onRequestGet(getCtx('project=MS&wave=0'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'MS-161', projectId: 'horizontal', title: 'Nota', wave: 0, done: false, theme: null, assigneeId: null, deps: [], dueAt: null, allDay: true, urgent: false },
    ])
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

// Assigning on create: --assignee takes a name or an id, like --project.
// „Ale mele” din API: filtrul pe om (și pe bifat) se face în bază, nu pe client.
describe('list by assignee (tk mine, tk list --assignee)', () => {
  const ionut = route('/rest/v1/assignees?', [{ id: '0b5d2c1e-0000-4000-8000-000000000001', name: 'Ionut' }])
  const issues = (rows: unknown[]) => route('/rest/v1/issues?', rows)
  const issuesCall = (calls: Call[]) => decodeURIComponent(calls.find(c => c.url.includes('/rest/v1/issues?'))!.url)

  it('fără project: caută în toate proiectele, după assignee_id, și întoarce proiectul și omul', async () => {
    const calls = mockFetch([
      ionut,
      issues([
        { id: 'CC-04', project_id: 'cc', title: 'A', wave: 1, done: false, theme: null, assignee_id: '0b5d2c1e-0000-4000-8000-000000000001', due_at: null, all_day: true, urgent: false },
        { id: 'MS-12', project_id: 'ms', title: 'B', wave: 2, done: false, theme: 'x', assignee_id: '0b5d2c1e-0000-4000-8000-000000000001', due_at: null, all_day: true, urgent: true },
      ]),
      route('/rest/v1/dependencies?', []),
    ])
    const res = await onRequestGet(getCtx('assignee=Ionut&done=false'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'CC-04', projectId: 'cc', title: 'A', wave: 1, done: false, theme: null, assigneeId: '0b5d2c1e-0000-4000-8000-000000000001', deps: [], dueAt: null, allDay: true, urgent: false },
      { id: 'MS-12', projectId: 'ms', title: 'B', wave: 2, done: false, theme: 'x', assigneeId: '0b5d2c1e-0000-4000-8000-000000000001', deps: [], dueAt: null, allDay: true, urgent: true },
    ])
    expect(calls.some(c => c.url.includes('/rest/v1/projects?'))).toBe(false)
    const url = issuesCall(calls)
    expect(url).not.toContain('project_id=eq.')
    expect(url).toContain('assignee_id=eq.0b5d2c1e-0000-4000-8000-000000000001')
    expect(url).toContain('done=eq.false')
    expect(calls.find(c => c.url.includes('/rest/v1/assignees?'))!.url).toContain('name=ilike.Ionut')
  })

  it('cu project: filtrul pe om se adaugă la cel pe proiect', async () => {
    const calls = mockFetch([projectRoute, ionut, issues([]), route('/rest/v1/dependencies?', [])])
    const res = await onRequestGet(getCtx('project=MS&assignee=Ionut'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    const url = issuesCall(calls)
    expect(url).toContain('project_id=eq.horizontal')
    expect(url).toContain('assignee_id=eq.0b5d2c1e-0000-4000-8000-000000000001')
    expect(url).not.toContain('done=')
  })

  it('assignee= (gol) = nepasate, doar într-un proiect', async () => {
    const calls = mockFetch([projectRoute, issues([]), route('/rest/v1/dependencies?', [])])
    expect((await onRequestGet(getCtx('project=MS&assignee='))).status).toBe(200)
    expect(issuesCall(calls)).toContain('assignee_id=is.null')
    expect(calls.some(c => c.url.includes('/rest/v1/assignees?'))).toBe(false)

    mockFetch([])
    const res = await onRequestGet(getCtx('assignee='))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing_params', required: ['project'] })
  })

  it('un om necunoscut → 404 assignee_not_found, fără nicio listă', async () => {
    const calls = mockFetch([route('/rest/v1/assignees?', [])])
    const res = await onRequestGet(getCtx('assignee=Nimeni'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'assignee_not_found' })
    expect(calls.some(c => c.url.includes('/rest/v1/issues?'))).toBe(false)
  })

  it('done altceva decât true/false → 400 invalid_done', async () => {
    mockFetch([projectRoute])
    const res = await onRequestGet(getCtx('project=MS&done=da'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_done' })
  })

  it('fără project și fără assignee, lista tot cere proiectul', async () => {
    mockFetch([])
    const res = await onRequestGet(getCtx('done=false'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing_params', required: ['project'] })
  })
})

describe('create with an assignee', () => {
  const createRoutes = (assignees: unknown) => [
    projectRoute,
    route('/rest/v1/assignees?', assignees),
    route('/rest/v1/issues?project_id=eq.horizontal&select=id', [{ id: 'MS-160' }]),
    route('&title=ilike.', []),
    route('/rest/v1/issues', [{ id: 'MS-161' }], { method: 'POST' }),
  ]

  it('resolves a name to the assignee id and writes it', async () => {
    const calls = mockFetch(createRoutes([{ id: 'uuid-ionut', name: 'Ionut' }]))
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1, assigneeId: 'Ionut' }))
    expect(res.status).toBe(201)
    expect(calls.find(c => c.url.includes('/rest/v1/assignees?'))!.url).toContain('name=ilike.Ionut')
    expect(calls.find(c => c.method === 'POST')!.body.assignee_id).toBe('uuid-ionut')
  })

  it('looks a uuid up by id, not by name', async () => {
    const id = 'a3fa07cf-b1ac-4b2e-8895-a855e1c55929'
    const calls = mockFetch(createRoutes([{ id, name: 'Ionut' }]))
    await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1, assigneeId: id }))
    expect(calls.find(c => c.url.includes('/rest/v1/assignees?'))!.url).toContain(`id=eq.${id}`)
  })

  it('422s on an unknown person instead of writing a broken foreign key', async () => {
    const calls = mockFetch(createRoutes([]))
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1, assigneeId: 'Nimeni' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'assignee_not_found' })
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('leaves the ticket unassigned when no assignee is given', async () => {
    const calls = mockFetch(createRoutes([]))
    await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1 }))
    expect(calls.find(c => c.method === 'POST')!.body.assignee_id).toBe(null)
    expect(calls.some(c => c.url.includes('/rest/v1/assignees?'))).toBe(false)
  })
})

describe('create with an author (created_by)', () => {
  const createRoutes = (people: unknown) => [
    projectRoute,
    route('/rest/v1/assignees?', people),
    route('/rest/v1/issues?project_id=eq.horizontal&select=id', [{ id: 'MS-160' }]),
    route('&title=ilike.', []),
    route('/rest/v1/issues', [{ id: 'MS-161' }], { method: 'POST' }),
  ]

  it('scrie created_by = contul omului, ca o creare din aplicație', async () => {
    const calls = mockFetch(createRoutes([{ id: 'a-ion', name: 'Ionut', user_id: 'u-ion' }]))
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1, author: 'Ionut' }))
    expect(res.status).toBe(201)
    expect(calls.find(c => c.method === 'POST')!.body.created_by).toBe('u-ion')
  })

  it('un om fără cont nu poate fi autor → 422, nimic scris', async () => {
    const calls = mockFetch(createRoutes([{ id: 'a-ana', name: 'Ana', user_id: null }]))
    const res = await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1, author: 'Ana' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'author_not_linked', author: 'Ana' })
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('fără author, created_by nu se trimite (rămâne null: fără autor uman)', async () => {
    const calls = mockFetch(createRoutes([]))
    await onRequestPost(postCtx({ projectId: 'MS', title: 'Nota', wave: 1 }))
    expect(calls.find(c => c.method === 'POST')!.body).not.toHaveProperty('created_by')
  })
})
