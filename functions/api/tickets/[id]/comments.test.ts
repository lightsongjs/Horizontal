import { describe, it, expect, afterEach } from 'vitest'
import { onRequestGet, onRequestPost } from './comments'

const SB = 'https://db.test'
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Call { url: string; method: string; body: any }
type Responder = (call: Call) => { status?: number; body: unknown } | undefined

/** Primul responder care întoarce ceva câștigă. */
function mockFetch(responders: Responder[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const call: Call = {
      url: String(input),
      method: String(init.method ?? 'GET').toUpperCase(),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    }
    calls.push(call)
    for (const r of responders) {
      const hit = r(call)
      if (hit) {
        const status = hit.status ?? 200
        return { ok: status < 400, status, json: async () => hit.body } as any
      }
    }
    throw new Error(`unmocked fetch: ${call.method} ${call.url}`)
  }) as any
  return calls
}

const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key', TICKETS_API_KEY: 'api-key' }
const getCtx = (id: string): any => ({ params: { id }, env, request: new Request(`https://app.test/api/tickets/${id}/comments`) })
const postCtx = (id: string, body: unknown): any => ({
  params: { id },
  env,
  request: new Request(`https://app.test/api/tickets/${id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }),
})

const on = (method: string, needle: string, body: unknown, status = 200): Responder => (c) =>
  c.method === method && c.url.includes(needle) ? { status, body } : undefined

const PEOPLE = [{ id: 'a-ion', name: 'Ionut', user_id: 'u-ion' }, { id: 'a-ana', name: 'Ana', user_id: null }]
const people = on('GET', '/rest/v1/assignees?', PEOPLE)
const ATT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const signEcho: Responder = (c) =>
  c.url.includes('/storage/v1/object/sign/attachments')
    ? { body: c.body.paths.map((p: string) => ({ path: p, signedURL: `/object/sign/attachments/${p}?token=t` })) }
    : undefined

describe('GET /api/tickets/:id/comments', () => {
  it('firul cronologic: autor, pasă, fișierele fiecărui comentariu', async () => {
    const calls = mockFetch([
      on('GET', '/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }]),
      on('GET', '/rest/v1/issue_events?', [
        { id: 'e1', kind: 'comment', author_id: null, body: 'nota veche', handoff_from: null, handoff_to: null, created_at: '2026-01-01T00:00:00Z', edited_at: null },
        { id: 'e2', kind: 'comment', author_id: 'u-ion', body: 'uite', handoff_from: null, handoff_to: null, created_at: '2026-10-27T10:00:00Z', edited_at: '2026-10-27T10:05:00Z' },
        { id: 'e3', kind: 'handoff', author_id: 'u-ion', body: '', handoff_from: 'a-ion', handoff_to: 'a-ana', created_at: '2026-10-27T11:00:00Z', edited_at: null },
      ]),
      people,
      on('GET', '/rest/v1/attachments?', [
        { id: ATT, path: 'horizontal/HZ-07/x', filename: 'a.png', size: 3, content_type: 'image/png', created_at: '2026-10-27T10:00:00Z', event_id: 'e2' },
      ]),
      signEcho,
    ])
    const res = await onRequestGet(getCtx('HZ-07'))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.comments.map((c: any) => [c.id, c.author])).toEqual([
      ['e1', 'notă mutată'], ['e2', 'Ionut'], ['e3', 'Ionut'],
    ])
    expect(out.comments[1].editedAt).toBe('2026-10-27T10:05:00Z')
    expect(out.comments[1].attachments[0]).toMatchObject({ id: ATT, filename: 'a.png' })
    expect(out.comments[1].attachments[0].url).toContain('token=t')
    expect(out.comments[2].handoff).toEqual({ from: { id: 'a-ion', name: 'Ionut' }, to: { id: 'a-ana', name: 'Ana' } })

    const evCall = calls.find((c) => c.url.includes('/issue_events?'))!
    expect(evCall.url).toContain('select=*')
    expect(evCall.url).toContain('order=created_at.asc')
  })

  it('tichet inexistent → 404', async () => {
    mockFetch([on('GET', '/rest/v1/issues?', [])])
    const res = await onRequestGet(getCtx('HZ-99'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('fir gol → listă goală, fără Storage', async () => {
    const calls = mockFetch([on('GET', '/rest/v1/issues?', [{ id: 'HZ-07' }]), on('GET', '/rest/v1/issue_events?', []), people])
    const out = await (await onRequestGet(getCtx('HZ-07'))).json() as any
    expect(out).toEqual({ id: 'HZ-07', comments: [] })
    expect(calls.some((c) => c.url.includes('/storage/') || c.url.includes('/attachments?'))).toBe(false)
  })
})

describe('POST /api/tickets/:id/comments', () => {
  const issue = on('GET', '/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07', assignee_id: null }])
  // Autorul: Ionut, cu cont. Răspunde doar la căutarea de autor (select cu user_id).
  const me: Responder = (c) =>
    c.url.includes('/rest/v1/assignees?name=ilike.Ionut&select=id,name,user_id')
      ? { body: [{ id: 'a-ion', name: 'Ionut', user_id: 'u-ion' }] } : undefined

  it('comentariu + pasă = UN apel la post_to_thread_api, cu persoana rezolvată din nume', async () => {
    const calls = mockFetch([
      issue,
      me,
      on('GET', '/rest/v1/assignees?name=ilike.Ana', [{ id: 'a-ana', name: 'Ana' }]),
      on('POST', '/rest/v1/rpc/post_to_thread_api', {
        events: [
          { id: 'e1', kind: 'comment', author_id: 'u-ion', body: 'ia-l tu', handoff_from: null, handoff_to: null, created_at: 't', edited_at: null },
          { id: 'e2', kind: 'handoff', author_id: 'u-ion', body: '', handoff_from: null, handoff_to: 'a-ana', created_at: 't', edited_at: null },
        ],
        assignee_id: 'a-ana',
      }),
      people,
    ])
    const res = await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: 'ia-l tu', to: 'Ana' }))
    expect(res.status).toBe(201)
    const out = await res.json() as any
    expect(out.assigneeId).toBe('a-ana')
    // Comentariul e al omului, nu al unei „unelte”.
    expect(out.comments.map((c: any) => [c.kind, c.author])).toEqual([['comment', 'Ionut'], ['handoff', 'Ionut']])

    const rpc = calls.filter((c) => c.url.includes('/rpc/'))
    expect(rpc).toHaveLength(1)
    expect(rpc[0].body).toEqual({ p_issue_id: 'HZ-07', p_author: 'u-ion', p_body: 'ia-l tu', p_handoff: true, p_to: 'a-ana', p_attachment_ids: [] })
    // Nimic scris pe lângă funcție: atomicitatea e a ei.
    expect(calls.filter((c) => c.method !== 'GET' && !c.url.includes('/rpc/'))).toEqual([])
  })

  it('fără to = doar comentariu (p_handoff false)', async () => {
    const calls = mockFetch([
      issue,
      me,
      on('POST', '/rest/v1/rpc/post_to_thread_api', { events: [], assignee_id: null }),
      people,
    ])
    await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: 'notă' }))
    expect(calls.find((c) => c.url.includes('/rpc/'))!.body).toMatchObject({ p_handoff: false, p_to: null })
  })

  it('to: null = înapoi la creator (pasă spre nimeni)', async () => {
    const calls = mockFetch([
      on('GET', '/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07', assignee_id: 'a-ana' }]),
      me,
      on('POST', '/rest/v1/rpc/post_to_thread_api', { events: [], assignee_id: null }),
      people,
    ])
    const res = await onRequestPost(postCtx('HZ-07', { author: 'Ionut', to: null }))
    expect(res.status).toBe(201)
    expect(calls.find((c) => c.url.includes('/rpc/'))!.body).toMatchObject({ p_handoff: true, p_to: null, p_body: '' })
  })

  it('pasă către cine îl are deja, fără text → nimic de scris', async () => {
    const calls = mockFetch([
      on('GET', '/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07', assignee_id: 'a-ana' }]),
      me,
      on('GET', '/rest/v1/assignees?name=ilike.Ana', [{ id: 'a-ana', name: 'Ana' }]),
    ])
    const out = await (await onRequestPost(postCtx('HZ-07', { author: 'Ionut', to: 'Ana' }))).json() as any
    expect(out).toMatchObject({ unchanged: true, comments: [] })
    expect(calls.some((c) => c.url.includes('/rpc/'))).toBe(false)
  })

  it('fișierele: trebuie să fie ale tichetului și nelegate; altfel 422 cu lista', async () => {
    const other = '1f8fad5b-d9cb-469f-a165-70867728950e'
    const calls = mockFetch([issue, me, on('GET', '/rest/v1/attachments?id=in.', [{ id: ATT }])])
    const res = await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: 'x', attachmentIds: [ATT, other] }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'invalid_attachments', unknown: [other] })
    const q = calls.find((c) => c.url.includes('/attachments?'))!.url
    expect(q).toContain('issue_id=eq.HZ-07')
    expect(q).toContain('event_id=is.null')
  })

  it('refuzuri: fără autor 400, corp gol 400, tichet inexistent 404, persoană necunoscută 422, ID provizoriu 400', async () => {
    mockFetch([])
    expect(await (await onRequestPost(postCtx('HZ-07', { body: 'x' }))).json()).toEqual({ error: 'author_required' })
    expect((await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: '  ' }))).status).toBe(400)
    expect((await onRequestPost(postCtx('HZ-07', 'nu-e-json'))).status).toBe(400)
    expect(await (await onRequestPost(postCtx('HZ-~abc', { author: 'Ionut', body: 'x' }))).json()).toEqual({ error: 'temp_id' })

    mockFetch([on('GET', '/rest/v1/issues?', [])])
    expect((await onRequestPost(postCtx('HZ-99', { author: 'Ionut', body: 'x' }))).status).toBe(404)

    mockFetch([issue, me, on('GET', '/rest/v1/assignees?', [])])
    const res = await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: 'x', to: 'Nimeni' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'assignee_not_found' })
  })

  it('autorul trebuie să fie un om cu cont: necunoscut / fără cont → 422, nimic scris', async () => {
    let calls = mockFetch([issue, on('GET', '/rest/v1/assignees?', [])])
    let res = await onRequestPost(postCtx('HZ-07', { author: 'Nimeni', body: 'x' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'author_not_found', author: 'Nimeni' })
    expect(calls.some((c) => c.url.includes('/rpc/'))).toBe(false)

    calls = mockFetch([issue, on('GET', '/rest/v1/assignees?', [{ id: 'a-ana', name: 'Ana', user_id: null }])])
    res = await onRequestPost(postCtx('HZ-07', { author: 'Ana', body: 'x' }))
    expect(await res.json()).toEqual({ error: 'author_not_linked', author: 'Ana' })
    expect(calls.some((c) => c.url.includes('/rpc/'))).toBe(false)
  })

  it('funcția lipsă pe bază → 501 migration_missing', async () => {
    mockFetch([issue, me, on('POST', '/rest/v1/rpc/', { code: 'PGRST202', message: 'Could not find the function' }, 404)])
    const res = await onRequestPost(postCtx('HZ-07', { author: 'Ionut', body: 'x' }))
    expect(res.status).toBe(501)
    expect((await res.json() as any).error).toBe('migration_missing')
  })
})
