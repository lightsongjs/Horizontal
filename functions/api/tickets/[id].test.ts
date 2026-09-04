import { describe, it, expect, afterEach } from 'vitest'
import { attachmentsPayload, buildIssueUpdate, onRequestGet, onRequestPatch } from './[id]'

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
  respond: () => { ok?: boolean; status?: number; body: unknown; jsonRejects?: boolean }
}

const SB = 'https://db.test'
const realFetch = globalThis.fetch

// Routes are tried in order; the first match wins, so put specific ones first.
function route(
  needle: string,
  body: unknown,
  opts: { ok?: boolean; status?: number; method?: string; jsonRejects?: boolean } = {}
): Route {
  return {
    match: (url, method) =>
      url.includes(needle) && (!opts.method || method === opts.method),
    respond: () => ({ body, ok: opts.ok, status: opts.status, jsonRejects: opts.jsonRejects }),
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
    const { ok = true, status = 200, body, jsonRejects = false } = hit.respond()
    return {
      ok,
      status,
      json: async () => {
        if (jsonRejects) throw new Error('invalid json body')
        return body
      },
    } as any
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

// Standard mocks for a HZ-07 -> ticket-kit move. Override by prepending routes.
function moveRoutes(over: Route[] = []): Route[] {
  return [
    ...over,
    route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
      [{ id: 'HZ-07', project_id: 'horizontal', title: 'Wrong project', wave: 3 }]),
    route('/rest/v1/projects?or=', [{ id: 'ticket-kit', prefix: 'TK', current_wave: 2 }]),
    route('/rest/v1/dependencies?or=', []),
    route('/rest/v1/waves?project_id=eq.ticket-kit', [{ number: 2 }]),
    route('/rest/v1/issues?project_id=eq.ticket-kit&select=id', [{ id: 'TK-01' }, { id: 'TK-02' }]),
    route('&title=ilike.', []),
    route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'IGNORED-99' }], { method: 'PATCH' }),
  ]
}

describe('onRequestPatch move to another project', () => {
  it('renames the ticket with the target prefix and reports movedFrom', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.id).toBe('TK-03')
    expect(out.movedFrom).toBe('HZ-07')
    expect(out.updated).toContain('projectId')

    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.id).toBe('TK-03')
    expect(write.body.project_id).toBe('ticket-kit')
    expect(write.body.wave).toBe(2)      // target current_wave
    expect(write.body.theme).toBe(null)  // theme keys are per-project
  })

  it('accepts field edits in the same request as the move', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Fixed title', desc: 'body' })
    )
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.title).toBe('Fixed title')
    expect(write.body.details).toBe('body')
    expect(write.body.id).toBe('TK-03')
  })

  it('treats a move to the current project as a no-op', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Stay', wave: 3 }]),
      route('/rest/v1/projects?or=', [{ id: 'horizontal', prefix: 'HZ', current_wave: 5 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'horizontal', title: 'Stay put' }))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.id).toBe('HZ-07')
    expect(out.movedFrom).toBeUndefined()
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.id).toBeUndefined()
    expect(write.body.wave).toBeUndefined()
  })

  it('404s on an unknown target project', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'X', wave: 3 }]),
      route('/rest/v1/projects?or=', []),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'nope' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'project_not_found' })
  })
})

describe('onRequestPatch move dependency guard', () => {
  it('refuses when the ticket depends on another', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-07', depends_on_id: 'HZ-03' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'has_dependencies',
      dependsOn: ['HZ-03'],
      dependedOnBy: [],
    })
  })

  it('refuses when another ticket depends on it', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-09', depends_on_id: 'HZ-07' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'has_dependencies',
      dependsOn: [],
      dependedOnBy: ['HZ-09'],
    })
  })

  it('reports both directions at once', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [
        { issue_id: 'HZ-07', depends_on_id: 'HZ-03' },
        { issue_id: 'HZ-09', depends_on_id: 'HZ-07' },
      ]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    const out = await res.json() as any
    expect(out.dependsOn).toEqual(['HZ-03'])
    expect(out.dependedOnBy).toEqual(['HZ-09'])
  })

  it('queries the dependency table before writing anything', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-07', depends_on_id: 'HZ-03' }]),
    ]))
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('refuses to combine a move with a deps update', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', deps: ['HZ-03'] })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_move_and_set_deps' })
  })

  it('still allows a deps update with no move', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'X', wave: 3 }]),
      route('/rest/v1/issues?id=in.', [{ id: 'HZ-03' }]),
      route('/rest/v1/dependencies?issue_id=eq.HZ-07', [], { method: 'DELETE' }),
      route('/rest/v1/dependencies', [{}], { method: 'POST' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { deps: ['HZ-03'] }))
    expect(res.status).toBe(200)
    expect((await res.json() as any).updated).toEqual(['deps'])
  })
})

describe('onRequestPatch move wave and theme overrides', () => {
  it('honours an explicit wave that exists in the target', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/waves?project_id=eq.ticket-kit&number=eq.4', [{ number: 4 }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 4 }))
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.wave).toBe(4)
  })

  it('422s on a wave the target project does not have', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/waves?project_id=eq.ticket-kit&number=eq.9', []),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 9 }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'wave_not_in_target' })
  })

  it('400s on a non-integer wave', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 'two' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_wave' })
  })

  it('validates the default wave too', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.url.includes('/rest/v1/waves?project_id=eq.ticket-kit'))).toBe(true)
  })

  it('honours a theme key that exists in the target', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/themes?project_id=eq.ticket-kit', [{ key: 'api' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 'api' }))
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.theme).toBe('api')
  })

  it('422s on a theme key the target project does not have', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/themes?project_id=eq.ticket-kit', []),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 'ghost' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'theme_not_in_target' })
  })

  it('does not query themes when no theme is given', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.url.includes('/rest/v1/themes'))).toBe(false)
  })
})

describe('onRequestPatch move dup-check', () => {
  it('checks the title against the target project and the final wave', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Fresh' }))
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain('project_id=eq.ticket-kit')
    expect(dup.url).toContain('wave=eq.2')
  })

  it('409s when the target project already has that title in that wave', async () => {
    mockFetch(moveRoutes([
      route('&title=ilike.', [{ id: 'TK-05' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Taken' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_title', existing_id: 'TK-05' })
  })

  it('carries the current title into the dup-check when the move renames nothing', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(200)
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain(encodeURIComponent('Wrong project'))
    expect(dup.url).toContain('project_id=eq.ticket-kit')
  })
})

describe('onRequestPatch invalid move payloads', () => {
  it('400s on an empty-string projectId', async () => {
    mockFetch([])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: '' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_project_id' })
  })

  it('400s on a null projectId', async () => {
    mockFetch([])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: null }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_project_id' })
  })

  it('400s on a non-string projectId', async () => {
    mockFetch([])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 42 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_project_id' })
  })

  it('400s on a non-string, non-null theme during a move', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 42 })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_theme' })
  })

  // A malformed body must not earn a semantic error: the shape check has to beat
  // every rule check, or a bad theme hides behind whichever rule fails first.
  it('reports invalid_theme ahead of a rule violation elsewhere in the body', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/waves?project_id=eq.ticket-kit&number=eq.99', []),
    ]))
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 42, wave: 99 })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_theme' })
  })

  it('leaves a non-string theme alone when no move is happening', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { theme: 42 }))
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.theme).toBe(42)
  })

  it('treats a body with no projectId key as a plain update, not a move', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'New title' }))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.movedFrom).toBeUndefined()
  })
})

describe('onRequestPatch failed write surfaces detail', () => {
  it('echoes the PostgREST error body as detail on a failed PATCH', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', { code: '23505', message: 'duplicate key' },
        { method: 'PATCH', ok: false, status: 502 }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'New title' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'db_error',
      detail: { code: '23505', message: 'duplicate key' },
    })
  })

  it('returns a clean 502 when the failed PATCH error body is not JSON', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', null,
        { method: 'PATCH', ok: false, status: 502, jsonRejects: true }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'New title' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'db_error' })
  })
})

// ---- attachments ----

const ATT_ROW = {
  id: 'a1',
  path: 'horizontal/HZ-07/a1',
  filename: 'eroare-login.png',
  size: 84213,
  content_type: 'image/png',
  created_at: '2026-09-03T18:22:04.113Z',
}

describe('attachmentsPayload', () => {
  it('renames the DB columns and prefixes the relative signed URL', () => {
    expect(attachmentsPayload(
      [ATT_ROW],
      [{ path: 'horizontal/HZ-07/a1', signedURL: '/object/sign/attachments/horizontal/HZ-07/a1?token=t' }],
      `${SB}/storage/v1`,
    )).toEqual([{
      id: 'a1',
      filename: 'eroare-login.png',
      contentType: 'image/png',
      size: 84213,
      createdAt: '2026-09-03T18:22:04.113Z',
      url: `${SB}/storage/v1/object/sign/attachments/horizontal/HZ-07/a1?token=t`,
    }])
  })

  it('keeps the metadata but omits url when that path was not signed', () => {
    const [out] = attachmentsPayload([ATT_ROW], [], `${SB}/storage/v1`)
    expect(out).not.toHaveProperty('url')
    expect(out.filename).toBe('eroare-login.png')
  })

  it('omits url for the failed file only, not for its neighbours', () => {
    const other = { ...ATT_ROW, id: 'a2', path: 'horizontal/HZ-07/a2', filename: 'b.png' }
    const out = attachmentsPayload(
      [ATT_ROW, other],
      [
        { path: 'horizontal/HZ-07/a1', signedURL: null },
        { path: 'horizontal/HZ-07/a2', signedURL: '/object/sign/attachments/horizontal/HZ-07/a2?token=t' },
      ],
      `${SB}/storage/v1`,
    )
    expect(out[0]).not.toHaveProperty('url')
    expect(out[1].url).toBe(`${SB}/storage/v1/object/sign/attachments/horizontal/HZ-07/a2?token=t`)
  })

  it('returns an empty list for a ticket with no attachments', () => {
    expect(attachmentsPayload([], [], `${SB}/storage/v1`)).toEqual([])
  })
})

function getCtx(id: string): any {
  return {
    params: { id },
    env: {
      SUPABASE_URL: SB,
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TICKETS_API_KEY: 'api-key',
    },
    request: new Request(`https://app.test/api/tickets/${id}`),
  }
}

const ISSUE_ROUTES = [
  route('/rest/v1/issues?id=eq.HZ-07&select=id,title,details',
    [{ id: 'HZ-07', title: 'Login picat', details: 'nu intru', wave: 3, done: false }]),
  route('/rest/v1/dependencies?issue_id=eq.HZ-07', []),
]

describe('onRequestGet attachments', () => {
  it('signs every path in one call and returns downloadable URLs', async () => {
    const calls = mockFetch([
      ...ISSUE_ROUTES,
      route('/rest/v1/attachments?issue_id=eq.HZ-07', [ATT_ROW]),
      route('/storage/v1/object/sign/attachments',
        [{ path: 'horizontal/HZ-07/a1', signedURL: '/object/sign/attachments/horizontal/HZ-07/a1?token=t' }],
        { method: 'POST' }),
    ])
    const res = await onRequestGet(getCtx('HZ-07'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].url).toContain('token=t')

    const signCalls = calls.filter(c => c.url.includes('/object/sign/'))
    expect(signCalls).toHaveLength(1)
    expect(signCalls[0].body).toEqual({ expiresIn: 8 * 60 * 60, paths: ['horizontal/HZ-07/a1'] })
  })

  it('does not touch Storage at all when the ticket has no attachments', async () => {
    const calls = mockFetch([
      ...ISSUE_ROUTES,
      route('/rest/v1/attachments?issue_id=eq.HZ-07', []),
    ])
    const res = await onRequestGet(getCtx('HZ-07'))
    const body = await res.json() as any
    expect(body.attachments).toEqual([])
    expect(calls.some(c => c.url.includes('/storage/'))).toBe(false)
  })

  it('still returns the ticket when signing fails, minus the URLs', async () => {
    mockFetch([
      ...ISSUE_ROUTES,
      route('/rest/v1/attachments?issue_id=eq.HZ-07', [ATT_ROW]),
      route('/storage/v1/object/sign/attachments', { error: 'nope' },
        { method: 'POST', ok: false, status: 500 }),
    ])
    const res = await onRequestGet(getCtx('HZ-07'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.desc).toBe('nu intru')
    expect(body.attachments[0]).not.toHaveProperty('url')
  })

  it('surfaces a db_error when the attachments query fails', async () => {
    mockFetch([
      ...ISSUE_ROUTES,
      route('/rest/v1/attachments?issue_id=eq.HZ-07', null, { ok: false, status: 502 }),
    ])
    const res = await onRequestGet(getCtx('HZ-07'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'db_error' })
  })
})
