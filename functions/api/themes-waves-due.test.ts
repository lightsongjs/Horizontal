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

describe('DELETE /api/themes/<key>', () => {
  const del = (q: string, key = 'pasul-2') =>
    themeOne.onRequestDelete(ctx(`/api/themes/${key}?${q}`, { method: 'DELETE', params: { key } }))

  it('o temă nefolosită se șterge direct', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/themes?project_id=eq.cc&key=eq.pasul-2', null, { method: 'DELETE' }),
      route('/rest/v1/themes?', themeRows),
      route('/rest/v1/issues?', []),
    ])
    const res = await del('project=cc')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: { key: 'pasul-2', name: 'Pasul 2: Admiterea', color: '#F06B1F' }, cleared: [] })
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
  })

  it('purtată de tichete → 409 theme_in_use cu câte și care, fără nicio scriere', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/themes?', themeRows),
      route('/rest/v1/issues?', [{ id: 'CC-03' }, { id: 'CC-07' }]),
    ])
    const res = await del('project=cc')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'theme_in_use', theme: 'pasul-2', count: 2, tickets: ['CC-03', 'CC-07'] })
    expect(calls.every(c => c.method === 'GET')).toBe(true)
    expect(calls.find(c => c.url.includes('/rest/v1/issues?'))!.url).toContain('project_id=eq.cc&theme=eq.pasul-2')
  })

  it('force=true: întâi scoate tema de pe tichete, apoi o șterge; întoarce ce a golit', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.cc&theme=eq.pasul-2', [{ id: 'CC-07' }, { id: 'CC-03' }], { method: 'PATCH' }),
      route('/rest/v1/themes?project_id=eq.cc&key=eq.pasul-2', null, { method: 'DELETE' }),
      route('/rest/v1/themes?', themeRows),
      route('/rest/v1/issues?', [{ id: 'CC-03' }, { id: 'CC-07' }]),
    ])
    const res = await del('project=cc&force=true')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: { key: 'pasul-2', name: 'Pasul 2: Admiterea', color: '#F06B1F' }, cleared: ['CC-03', 'CC-07'] })
    const writes = calls.filter(c => c.method !== 'GET')
    expect(writes.map(c => c.method)).toEqual(['PATCH', 'DELETE'])
    expect(writes[0].body).toEqual({ theme: null })
  })

  it('golirea pică → tema rămâne (nicio ștergere)', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.cc&theme=eq.pasul-2', { message: 'x' }, { method: 'PATCH', ok: false, status: 500 }),
      route('/rest/v1/themes?', themeRows),
      route('/rest/v1/issues?', [{ id: 'CC-03' }]),
    ])
    const res = await del('project=cc&force=true')
    expect(res.status).toBe(502)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('404 pe temă sau proiect necunoscut, 400 fără proiect', async () => {
    mockFetch([projectRoute, route('/rest/v1/themes?', themeRows)])
    const res = await del('project=cc', 'nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'theme_not_found', theme: 'nope' })
    mockFetch([route('/rest/v1/projects?', [])])
    expect((await del('project=zz')).status).toBe(404)
    mockFetch([])
    expect((await del('')).status).toBe(400)
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
  it('sprint din dată: numele = eticheta = „dd/mm/yy”, locul în ordinea datei', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/waves', [], { method: 'POST' }),
      route('/rest/v1/waves?project_id=eq.cc&number=eq.', [{}], { method: 'PATCH' }),
      route('/rest/v1/waves?', [
        { number: 0, name: 'Scratchpad', label: '', position: 0 },
        { number: 1, name: 'Backlog', label: 'Backlog', position: 1 },
        { number: 2, name: '12/11/26', label: '12/11/26', position: 2 },
        { number: 3, name: '26/11/26', label: '26/11/26', position: 3 },
      ]),
    ])
    const res = await waves.onRequestPost(ctx('/api/waves', { method: 'POST', body: { projectId: 'cc', date: '2026-11-19' } }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ number: 4, name: '19/11/26', label: '19/11/26', position: 3 })
    const patch = calls.find(c => c.method === 'PATCH')!
    expect(patch.url).toContain('number=eq.3')
    expect(patch.body).toEqual({ position: 4 })
    expect(calls.findIndex(c => c.method === 'PATCH')).toBeLessThan(calls.findIndex(c => c.method === 'POST'))
  })
  it('sprint din dată: dată invalidă → 400, dată deja folosită → 409', async () => {
    mockFetch([projectRoute, route('/rest/v1/waves?', [{ number: 2, name: '19/11/26', label: '19/11/26', position: 2 }])])
    const bad = await waves.onRequestPost(ctx('/api/waves', { method: 'POST', body: { projectId: 'cc', date: '19.11.2026' } }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid_date' })
    const dup = await waves.onRequestPost(ctx('/api/waves', { method: 'POST', body: { projectId: 'cc', date: '2026-11-19' } }))
    expect(dup.status).toBe(409)
    expect(await dup.json()).toMatchObject({ error: 'sprint_exists', number: 2 })
  })
  it('redenumește un val existent; 404 pe unul necunoscut', async () => {
    mockFetch([projectRoute, route('/rest/v1/waves?project_id=eq.cc&number=eq.2', [{ number: 2, name: 'II', label: 'Nou', position: 2 }], { method: 'PATCH' })])
    const ok = await waveOne.onRequestPatch(ctx('/api/waves/2?project=cc', { method: 'PATCH', params: { number: '2' }, body: { label: 'Nou' } }))
    expect(await ok.json()).toEqual({ number: 2, name: 'II', label: 'Nou', position: 2, archived: false })
    mockFetch([projectRoute, route('/rest/v1/waves?', [], { method: 'PATCH' })])
    const missing = await waveOne.onRequestPatch(ctx('/api/waves/9?project=cc', { method: 'PATCH', params: { number: '9' }, body: { label: 'X' } }))
    expect(missing.status).toBe(404)
  })
})

describe('DELETE /api/waves/<n> și arhivarea', () => {
  // Valurile proiectului: 0 Notițe, 1 MVP, 2 Wave2, 3 arhivat. `archived_at`
  // prezent = baza are migrarea.
  const waveRows = [
    { number: 0, name: 'Scratchpad', label: '', position: 0, archived_at: null },
    { number: 1, name: 'I', label: 'MVP', position: 1, archived_at: null },
    { number: 2, name: 'II', label: 'Wave2', position: 2, archived_at: null },
    { number: 3, name: 'III', label: 'Vechi', position: 3, archived_at: '2026-11-01T00:00:00Z' },
  ]
  const wavesRoute = (rows: unknown[] = waveRows) => route('/rest/v1/waves?project_id=eq.cc&select=*', rows, { method: 'GET' })
  const ticketsRoute = (rows: unknown[]) => route('/rest/v1/issues?project_id=eq.cc&wave=eq.1&select=id,done', rows, { method: 'GET' })
  const del = (q: string) => waveOne.onRequestDelete(ctx(`/api/waves/1?project=cc${q}`, { method: 'DELETE', params: { number: '1' } }))
  const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

  it('tichete deschise: 409 wave_in_use cu lista lor, nicio scriere', async () => {
    const calls = mockFetch([projectRoute, wavesRoute(), ticketsRoute([{ id: 'CC-01', done: false }, { id: 'CC-02', done: true }, { id: 'CC-03', done: false }])])
    const res = await del('')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'wave_in_use', wave: 1, count: 2, tickets: ['CC-01', 'CC-03'] })
    expect(writes(calls)).toEqual([])
  })

  it('moveTo mută deschisele, iar gatele țin valul în arhivă (nu se șterge)', async () => {
    const calls = mockFetch([
      projectRoute, wavesRoute(), ticketsRoute([{ id: 'CC-01', done: false }, { id: 'CC-02', done: true }]),
      route('/rest/v1/issues?project_id=eq.cc&wave=eq.1&done=eq.false', [], { method: 'PATCH' }),
      route('/rest/v1/waves?project_id=eq.cc&number=eq.1', [], { method: 'PATCH' }),
    ])
    const res = await del('&moveTo=2')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: null, archived: 1, moved: ['CC-01'], moveTo: 2, kept: 1 })
    const w = writes(calls)
    expect(w.map((c) => c.method)).toEqual(['PATCH', 'PATCH'])
    expect(w[0].body).toEqual({ wave: 2 })
    expect(Object.keys(w[1].body)).toEqual(['archived_at'])
  })

  it('moveTo=0 (Notițele) și un val rămas gol: se șterge de-a binelea', async () => {
    let moved = false
    const calls = mockFetch([
      projectRoute, wavesRoute(),
      { match: (u, m) => m === 'GET' && u.includes('/rest/v1/issues?project_id=eq.cc&wave=eq.1&select=id,done'), respond: () => ({ body: [{ id: 'CC-01', done: false }] }) },
      { match: (u, m) => m === 'PATCH' && u.includes('/rest/v1/issues?'), respond: () => { moved = true; return { body: [] } } },
      { match: (u, m) => m === 'GET' && u.includes('&select=id&limit=1'), respond: () => ({ body: moved ? [] : [{ id: 'CC-01' }] }) },
      route('/rest/v1/waves?project_id=eq.cc&number=eq.1', [], { method: 'DELETE' }),
    ])
    const res = await del('&moveTo=0')
    expect(await res.json()).toEqual({ deleted: 1, archived: null, moved: ['CC-01'], moveTo: 0, kept: 0 })
    expect(writes(calls).map((c) => c.method)).toEqual(['PATCH', 'DELETE'])
    expect(writes(calls)[0].body).toEqual({ wave: 0 })
  })

  it('refuză Notițele, un moveTo inexistent / arhivat / același, un val necunoscut', async () => {
    mockFetch([projectRoute, wavesRoute()])
    expect((await waveOne.onRequestDelete(ctx('/api/waves/0?project=cc', { method: 'DELETE', params: { number: '0' } }))).status).toBe(400)
    expect((await del('&moveTo=1')).status).toBe(400)
    const arch = await del('&moveTo=3')
    expect(arch.status).toBe(422)
    expect(await arch.json()).toMatchObject({ error: 'move_to_not_found' })
    expect((await del('&moveTo=9')).status).toBe(422)
    const unknown = await waveOne.onRequestDelete(ctx('/api/waves/7?project=cc', { method: 'DELETE', params: { number: '7' } }))
    expect(unknown.status).toBe(404)
  })

  it('fără migrare: arhivarea refuză ÎNAINTE de a muta ceva', async () => {
    const noCol = waveRows.map(({ archived_at: _a, ...w }) => w)
    const calls = mockFetch([projectRoute, wavesRoute(noCol), ticketsRoute([{ id: 'CC-01', done: false }, { id: 'CC-02', done: true }])])
    const res = await del('&moveTo=2')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'migration_missing', kept: 1 })
    expect(writes(calls)).toEqual([])
  })

  it('PATCH archived: true arhivează și un val gol; false îl scoate din arhivă', async () => {
    const calls = mockFetch([
      projectRoute, wavesRoute(), ticketsRoute([]),
      route('/rest/v1/waves?project_id=eq.cc&number=eq.1', [{ number: 1, name: 'I', label: 'MVP', position: 1, archived_at: null }], { method: 'PATCH' }),
    ])
    const a = await waveOne.onRequestPatch(ctx('/api/waves/1?project=cc', { method: 'PATCH', params: { number: '1' }, body: { archived: true } }))
    expect(await a.json()).toEqual({ deleted: null, archived: 1, moved: [], moveTo: null, kept: 0 })
    const u = await waveOne.onRequestPatch(ctx('/api/waves/1?project=cc', { method: 'PATCH', params: { number: '1' }, body: { archived: false } }))
    expect(await u.json()).toEqual({ number: 1, name: 'I', label: 'MVP', position: 1, archived: false })
    expect(writes(calls)[1].body).toEqual({ archived_at: null })
    const mixed = await waveOne.onRequestPatch(ctx('/api/waves/1?project=cc', { method: 'PATCH', params: { number: '1' }, body: { archived: true, label: 'x' } }))
    expect(mixed.status).toBe(400)
  })
})

describe('GET /api/tickets: tema, dependențele, scadența', () => {
  it('fiecare rând are tema, dependențele și scadența; filtrul pe temă', async () => {
    const calls = mockFetch([
      projectRoute,
      route('/rest/v1/issues?project_id=eq.cc', [
        { id: 'CC-01', project_id: 'cc', title: 'A', wave: 1, done: false, theme: 'pasul-2', assignee_id: 'uuid-ana', due_at: '2026-10-23T21:00:00.000Z', all_day: true, urgent: true },
        { id: 'CC-02', project_id: 'cc', title: 'B', wave: 2, done: false, theme: 'pasul-2', assignee_id: null, due_at: null, all_day: true, urgent: false },
      ]),
      route('/rest/v1/dependencies?', [{ issue_id: 'CC-02', depends_on_id: 'CC-01' }]),
    ])
    const res = await tickets.onRequestGet(ctx('/api/tickets?project=cc&theme=pasul-2'))
    expect(await res.json()).toEqual([
      { id: 'CC-01', projectId: 'cc', title: 'A', wave: 1, done: false, theme: 'pasul-2', assigneeId: 'uuid-ana', deps: [], dueAt: '2026-10-23T21:00:00.000Z', allDay: true, urgent: true },
      { id: 'CC-02', projectId: 'cc', title: 'B', wave: 2, done: false, theme: 'pasul-2', assigneeId: null, deps: ['CC-01'], dueAt: null, allDay: true, urgent: false },
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
