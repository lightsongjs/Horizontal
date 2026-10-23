// Rutele adăugate pentru încărcarea fără scrieri directe în bază: temele,
// valurile (creare, redenumire), tema verificată, scadența / urgentul și
// ștergerea unui tichet.
import { describe, it, expect, afterEach } from 'vitest'
import * as themes from './themes'
import * as themeOne from './themes/[key]'
import * as waves from './waves'
import * as waveOne from './waves/[number]'
import * as tickets from './tickets'
import * as ticketOne from './tickets/[id]'

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
function ctx(path: string, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}): any {
  return {
    env,
    params: opts.params ?? {},
    request: new Request(`https://app.test${path}`, {
      method: opts.method ?? 'GET',
      ...(opts.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : {}),
    }),
  }
}

const projectRoute = route('/rest/v1/projects?', [{ id: 'cc', prefix: 'CC', current_wave: 1 }])
const themeRows = [
  { key: 'pasul-10', name: 'Pasul 10: Sfârșitul', color: '#111111' },
  { key: 'pasul-2', name: 'Pasul 2: Admiterea', color: '#F06B1F' },
]

afterEach(() => { globalThis.fetch = realFetch })

describe('GET /api/themes', () => {
  it('întoarce temele în ordinea naturală a numelor', async () => {
    mockFetch([projectRoute, route('/rest/v1/themes?', themeRows)])
    const res = await themes.onRequestGet(ctx('/api/themes?project=cc'))
    expect(res.status).toBe(200)
    expect((await res.json() as any[]).map(t => t.key)).toEqual(['pasul-2', 'pasul-10'])
  })
})

describe('POST /api/themes', () => {
  it('face cheia din nume, cu regula aplicației, unică în proiect', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/themes', [], { method: 'POST' }),
      route('/rest/v1/themes?', [{ key: 'pasul-3-verificarea', name: 'Altceva', color: '#000000' }]),
    ])
    const res = await themes.onRequestPost(ctx('/api/themes', { method: 'POST', body: { projectId: 'cc', name: 'Pasul 3: Verificarea', color: '#C98A00' } }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ key: 'pasul-3-verificarea-2', name: 'Pasul 3: Verificarea', color: '#C98A00' })
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ project_id: 'cc', key: 'pasul-3-verificarea-2', name: 'Pasul 3: Verificarea', color: '#C98A00' })
  })
  it('refuză un nume care există deja și o culoare greșită', async () => {
    mockFetch([projectRoute, route('/rest/v1/themes?', themeRows)])
    const dup = await themes.onRequestPost(ctx('/api/themes', { method: 'POST', body: { projectId: 'cc', name: 'pasul 2: admiterea', color: '#000000' } }))
    expect(dup.status).toBe(409)
    expect(await dup.json()).toEqual({ error: 'duplicate_theme', existing_key: 'pasul-2' })
    const bad = await themes.onRequestPost(ctx('/api/themes', { method: 'POST', body: { projectId: 'cc', name: 'X', color: 'red' } }))
    expect(bad.status).toBe(400)
  })
})

describe('PATCH /api/themes/<key>', () => {
  it('schimbă numele și culoarea, nu cheia', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/themes?project_id=eq.cc&key=eq.pasul-2', [], { method: 'PATCH' }),
      route('/rest/v1/themes?', themeRows),
    ])
    const res = await themeOne.onRequestPatch(ctx('/api/themes/pasul-2?project=cc', { method: 'PATCH', params: { key: 'pasul-2' }, body: { name: 'Pasul 2: Admis', color: '#00AA00' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ key: 'pasul-2', name: 'Pasul 2: Admis', color: '#00AA00' })
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ name: 'Pasul 2: Admis', color: '#00AA00' })
  })
  it('404 pe o temă necunoscută', async () => {
    mockFetch([projectRoute, route('/rest/v1/themes?', themeRows)])
    const res = await themeOne.onRequestPatch(ctx('/api/themes/nope?project=cc', { method: 'PATCH', params: { key: 'nope' }, body: { name: 'X' } }))
    expect(res.status).toBe(404)
  })
})

describe('POST / PATCH /api/waves', () => {
  it('numărul și locul = cel mai mare + 1; numele implicit = cifra romană următoare', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/waves', [], { method: 'POST' }),
      route('/rest/v1/waves?', [
        { number: 0, name: 'Scratchpad', position: 0 },
        { number: 1, name: 'I', position: 2 },
        { number: 3, name: 'II', position: 1 },
      ]),
    ])
    const res = await waves.onRequestPost(ctx('/api/waves', { method: 'POST', body: { projectId: 'cc', label: 'Pilot' } }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ number: 4, name: 'III', label: 'Pilot', position: 3 })
    expect(calls.find(c => c.method === 'POST')!.body).toMatchObject({ project_id: 'cc', number: 4, position: 3 })
  })
  it('redenumește un val existent; 404 pe unul necunoscut', async () => {
    mockFetch([projectRoute, route('/rest/v1/waves?project_id=eq.cc&number=eq.2', [{ number: 2, name: 'II', label: 'Nou', position: 2 }], { method: 'PATCH' })])
    const ok = await waveOne.onRequestPatch(ctx('/api/waves/2?project=cc', { method: 'PATCH', params: { number: '2' }, body: { label: 'Nou' } }))
    expect(await ok.json()).toEqual({ number: 2, name: 'II', label: 'Nou', position: 2 })
    mockFetch([projectRoute, route('/rest/v1/waves?', [], { method: 'PATCH' })])
    const missing = await waveOne.onRequestPatch(ctx('/api/waves/9?project=cc', { method: 'PATCH', params: { number: '9' }, body: { label: 'X' } }))
    expect(missing.status).toBe(404)
  })
})

describe('GET /api/tickets: tema, dependențele, scadența', () => {
  it('fiecare rând are tema, dependențele și scadența; filtrul pe temă', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.cc', [
        { id: 'CC-01', title: 'A', wave: 1, done: false, theme: 'pasul-2', due_at: '2026-10-23T21:00:00.000Z', all_day: true, urgent: true },
        { id: 'CC-02', title: 'B', wave: 2, done: false, theme: 'pasul-2', due_at: null, all_day: true, urgent: false },
      ]),
      route('/rest/v1/dependencies?', [{ issue_id: 'CC-02', depends_on_id: 'CC-01' }]),
    ])
    const res = await tickets.onRequestGet(ctx('/api/tickets?project=cc&theme=pasul-2'))
    expect(await res.json()).toEqual([
      { id: 'CC-01', title: 'A', wave: 1, done: false, theme: 'pasul-2', deps: [], dueAt: '2026-10-23T21:00:00.000Z', allDay: true, urgent: true },
      { id: 'CC-02', title: 'B', wave: 2, done: false, theme: 'pasul-2', deps: ['CC-01'], dueAt: null, allDay: true, urgent: false },
    ])
    expect(calls[1].url).toContain('theme=eq.pasul-2')
    expect(decodeURIComponent(calls[2].url)).toContain('issue_id=in.("CC-01","CC-02")')
  })
})

describe('POST /api/tickets: tema verificată, scadența, urgentul', () => {
  const createRoutes = (themeFound: boolean) => [
    projectRoute,
    route('/rest/v1/themes?', themeFound ? [{ key: 'pasul-2' }] : []),
    route('/rest/v1/issues?project_id=eq.cc&select=id', [{ id: 'CC-01' }]),
    route('&title=ilike.', []),
    route('/rest/v1/issues', [{ id: 'CC-02' }], { method: 'POST' }),
  ]
  it('refuză o temă care nu există, fără să scrie', async () => {
    const calls = mockFetch(createRoutes(false))
    const res = await tickets.onRequestPost(ctx('/api/tickets', { method: 'POST', body: { projectId: 'cc', title: 'X', wave: 1, theme: 'nope' } }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'theme_not_found', theme: 'nope' })
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })
  it('scrie tema, scadența cu oră (cu memento) și urgentul', async () => {
    const calls = mockFetch(createRoutes(true))
    const res = await tickets.onRequestPost(ctx('/api/tickets', { method: 'POST', body: { projectId: 'cc', title: 'X', wave: 1, theme: 'pasul-2', due: '2099-10-24 15:30', urgent: true } }))
    expect(res.status).toBe(201)
    const at = '2099-10-24T12:30:00.000Z'
    expect(calls.find(c => c.method === 'POST')!.body).toMatchObject({ theme: 'pasul-2', due_at: at, all_day: false, remind_at: at, urgent: true })
    expect(await res.json()).toMatchObject({ id: 'CC-02', theme: 'pasul-2', dueAt: at, allDay: false, urgent: true })
  })
  it('o dată greșită e 400, înainte de orice apel', async () => {
    const calls = mockFetch([])
    const res = await tickets.onRequestPost(ctx('/api/tickets', { method: 'POST', body: { projectId: 'cc', title: 'X', wave: 1, due: 'mâine' } }))
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('PATCH /api/tickets/<id>: scadența, urgentul, tema', () => {
  const current = (rrule: string | null = null) =>
    route('/rest/v1/issues?id=eq.CC-01&select=id,project_id,title,wave', [{ id: 'CC-01', project_id: 'cc', title: 'A', wave: 1, rrule }])
  it('pune ziua (toată ziua, fără memento) și urgentul', async () => {
    const calls = mockFetch([current(), route('/rest/v1/issues?id=eq.CC-01', [{ id: 'CC-01' }], { method: 'PATCH' })])
    const res = await ticketOne.onRequestPatch(ctx('/api/tickets/CC-01', { method: 'PATCH', params: { id: 'CC-01' }, body: { due: '2026-10-24', urgent: true } }))
    expect(res.status).toBe(200)
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ urgent: true, due_at: '2026-10-23T21:00:00.000Z', all_day: true, remind_at: null })
    expect(await res.json()).toEqual({ id: 'CC-01', updated: ['urgent', 'due'] })
  })
  it('refuză scadența pe o recurentă', async () => {
    const calls = mockFetch([current('FREQ=DAILY')])
    const res = await ticketOne.onRequestPatch(ctx('/api/tickets/CC-01', { method: 'PATCH', params: { id: 'CC-01' }, body: { due: null } }))
    expect(res.status).toBe(409)
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })
  it('refuză o temă care nu e în proiect; tema goală o scoate', async () => {
    mockFetch([current(), route('/rest/v1/themes?', [])])
    const bad = await ticketOne.onRequestPatch(ctx('/api/tickets/CC-01', { method: 'PATCH', params: { id: 'CC-01' }, body: { theme: 'nope' } }))
    expect(bad.status).toBe(422)
    const calls = mockFetch([current(), route('/rest/v1/issues?id=eq.CC-01', [{ id: 'CC-01' }], { method: 'PATCH' })])
    const clear = await ticketOne.onRequestPatch(ctx('/api/tickets/CC-01', { method: 'PATCH', params: { id: 'CC-01' }, body: { theme: '' } }))
    expect(clear.status).toBe(200)
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ theme: null })
  })
})

describe('PATCH /api/tickets/<id>: mutarea cu temă goală', () => {
  it('„” înseamnă fără temă, nu cheia goală căutată în țintă', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.CC-01&select=id,project_id,title,wave', [{ id: 'CC-01', project_id: 'cc', title: 'A', wave: 1, rrule: null }]),
      route('/rest/v1/projects?', [{ id: 'tk', prefix: 'TK', current_wave: 1 }]),
      route('/rest/v1/dependencies?', []),
      route('/rest/v1/issues?project_id=eq.tk&select=id', [{ id: 'TK-01' }]),
      route('/rest/v1/waves?', [{ number: 1 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.CC-01', [{ id: 'TK-02' }], { method: 'PATCH' }),
    ])
    const res = await ticketOne.onRequestPatch(ctx('/api/tickets/CC-01', { method: 'PATCH', params: { id: 'CC-01' }, body: { projectId: 'tk', theme: '' } }))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.url.includes('/rest/v1/themes?'))).toBe(false)
    expect(calls.find(c => c.method === 'PATCH')!.body).toMatchObject({ theme: null, id: 'TK-02', project_id: 'tk' })
  })
})

describe('creări simultane', () => {
  it('cheia duplicată (23505) e 409 conflict, nu 500', async () => {
    mockFetch([
      projectRoute,
      route('/rest/v1/themes', { code: '23505' }, { method: 'POST', ok: false, status: 409 }),
      route('/rest/v1/themes?', []),
    ])
    const res = await themes.onRequestPost(ctx('/api/themes', { method: 'POST', body: { projectId: 'cc', name: 'X', color: '#000000' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'conflict' })
  })
})

describe('DELETE /api/tickets/<id>', () => {
  const routes = (o: { dependents?: unknown[]; events?: unknown[]; files?: unknown[]; exists?: boolean }) => [
    route('/rest/v1/issues?id=eq.CC-05', [{ id: 'CC-05' }], { method: 'DELETE' }),
    route('/rest/v1/issues?id=eq.CC-05&select=id', o.exists === false ? [] : [{ id: 'CC-05' }]),
    route('/rest/v1/dependencies?depends_on_id=eq.CC-05', o.dependents ?? []),
    route('/rest/v1/issue_events?', o.events ?? []),
    route('/rest/v1/attachments?', o.files ?? []),
  ]
  const del = () => ticketOne.onRequestDelete(ctx('/api/tickets/CC-05', { method: 'DELETE', params: { id: 'CC-05' } }))

  it('șterge un tichet fără nimic legat de el', async () => {
    const calls = mockFetch(routes({}))
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'CC-05', deleted: true })
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
  })
  it('refuză dacă alte tichete depind de el', async () => {
    const calls = mockFetch(routes({ dependents: [{ issue_id: 'CC-06' }] }))
    const res = await del()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'has_dependents', dependedOnBy: ['CC-06'] })
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })
  it('refuză dacă are comentarii sau fișiere', async () => {
    mockFetch(routes({ events: [{ id: 'e1' }] }))
    expect((await del()).status).toBe(409)
    mockFetch(routes({ files: [{ id: 'f1' }] }))
    expect((await del()).status).toBe(409)
  })
  it('404 pe un tichet care nu există', async () => {
    mockFetch(routes({ exists: false }))
    expect((await del()).status).toBe(404)
  })
})
