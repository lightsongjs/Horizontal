import { describe, it, expect, afterEach } from 'vitest'
import { onRequestGet, onRequestPost } from './attachments'
import { MAX_REQUEST_BYTES } from '../../_attachments-lib'

const SB = 'https://db.test'
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
type Responder = (call: Call) => { status?: number; body: unknown } | undefined

/** Primul responder care întoarce ceva câștigă. */
function mockFetch(responders: Responder[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const raw = init.body
    const call: Call = {
      url: String(input),
      method: String(init.method ?? 'GET').toUpperCase(),
      headers: { ...(init.headers ?? {}) },
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
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
const ctx = (id: string, request: Request): any => ({ params: { id }, env, request })

const issueFound: Responder = c =>
  c.method === 'GET' && c.url.includes('/rest/v1/issues?id=eq.HZ-07')
    ? { body: [{ id: 'HZ-07', project_id: 'horizontal' }] } : undefined
const uploadOk: Responder = c =>
  c.method === 'POST' && c.url.includes('/storage/v1/object/attachments/') ? { body: { Key: 'x' } } : undefined
const insertEcho: Responder = c =>
  c.method === 'POST' && c.url.includes('/rest/v1/attachments')
    ? { status: 201, body: [{ ...(c.body as object), created_at: '2026-10-26T10:00:00.000Z' }] } : undefined
const signEcho: Responder = c =>
  c.url.includes('/storage/v1/object/sign/attachments')
    ? { body: (c.body as { paths: string[] }).paths.map(p => ({ path: p, signedURL: `/object/sign/attachments/${p}?token=t` })) }
    : undefined

function multipart(id: string, files: Array<[string, string, string]>): Request {
  const form = new FormData()
  for (const [name, type, text] of files) form.append('file', new File([text], name, { type }))
  return new Request(`https://app.test/api/tickets/${id}/attachments`, { method: 'POST', body: form })
}

function jsonReq(id: string, body: unknown): Request {
  return new Request(`https://app.test/api/tickets/${id}/attachments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/tickets/:id/attachments', () => {
  it('uploads to <project>/<issue>/<uuid> and writes the row like the app (event_id left null)', async () => {
    const calls = mockFetch([issueFound, uploadOk, insertEcho, signEcho])
    const res = await onRequestPost(ctx('HZ-07', multipart('HZ-07', [['C:\\poze\\eroare.png', 'image/png', 'abc']])))
    expect(res.status).toBe(201)
    const out = await res.json() as any

    const up = calls.find(c => c.url.includes('/storage/v1/object/attachments/'))!
    expect(up.url).toMatch(/\/storage\/v1\/object\/attachments\/horizontal\/HZ-07\/[0-9a-f-]{36}$/)
    expect(up.headers['Content-Type']).toBe('image/png')
    expect(up.headers['x-upsert']).toBe('false')

    const ins = calls.find(c => c.url.includes('/rest/v1/attachments'))!.body as any
    expect(ins).toMatchObject({ issue_id: 'HZ-07', project_id: 'horizontal', filename: 'eroare.png', size: 3, content_type: 'image/png' })
    expect(ins).not.toHaveProperty('event_id')
    expect(up.url.endsWith(`/${ins.id}`)).toBe(true)
    expect(ins.path).toBe(`horizontal/HZ-07/${ins.id}`)

    expect(out.id).toBe('HZ-07')
    expect(out.attachments).toEqual([{
      id: ins.id, filename: 'eroare.png', contentType: 'image/png', size: 3,
      createdAt: '2026-10-26T10:00:00.000Z',
      url: `${SB}/storage/v1/object/sign/attachments/horizontal/HZ-07/${ins.id}?token=t`,
    }])
  })

  it('takes several `file` fields and guesses the type of an octet-stream upload', async () => {
    const calls = mockFetch([issueFound, uploadOk, insertEcho, signEcho])
    const res = await onRequestPost(ctx('HZ-07', multipart('HZ-07', [
      ['a.jpg', 'application/octet-stream', 'x'],
      ['b.pdf', '', 'yy'],
    ])))
    expect(res.status).toBe(201)
    const rows = calls.filter(c => c.url.includes('/rest/v1/attachments')).map(c => c.body as any)
    expect(rows.map(r => r.content_type)).toEqual(['image/jpeg', 'application/pdf'])
    expect((await res.json() as any).attachments).toHaveLength(2)
  })

  it('accepts JSON with base64', async () => {
    const calls = mockFetch([issueFound, uploadOk, insertEcho, signEcho])
    const res = await onRequestPost(ctx('HZ-07', jsonReq('HZ-07', { filename: 'n.txt', data: 'aGk=' })))
    expect(res.status).toBe(201)
    const up = calls.find(c => c.url.includes('/storage/v1/object/attachments/'))!
    expect(Array.from(up.body as Uint8Array)).toEqual([104, 105])
    expect(up.headers['Content-Type']).toBe('text/plain')
  })

  it('refuses a temporary id before touching the network', async () => {
    const calls = mockFetch([])
    const res = await onRequestPost(ctx('HZ-~abc123', jsonReq('HZ-~abc123', { filename: 'a.png', data: 'AQID' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'temp_id' })
    expect(calls).toHaveLength(0)
  })

  it('404s an unknown ticket without uploading anything', async () => {
    const calls = mockFetch([c => c.url.includes('/rest/v1/issues') ? { body: [] } : undefined])
    const res = await onRequestPost(ctx('HZ-99', jsonReq('HZ-99', { filename: 'a.png', data: 'AQID' })))
    expect(res.status).toBe(404)
    expect(calls.some(c => c.url.includes('/storage/'))).toBe(false)
  })

  it('413s a declared body over the cap before reading it', async () => {
    const calls = mockFetch([])
    const req = new Request('https://app.test/api/tickets/HZ-07/attachments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_REQUEST_BYTES + 1) }, body: '{}',
    })
    const res = await onRequestPost(ctx('HZ-07', req))
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('400s an empty upload and an unsupported content type', async () => {
    mockFetch([])
    expect((await onRequestPost(ctx('HZ-07', multipart('HZ-07', [])))).status).toBe(400)
    const res = await onRequestPost(ctx('HZ-07', new Request('https://app.test/x', {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'abc',
    })))
    expect(res.status).toBe(415)
  })

  it('withdraws the bytes when the row cannot be written, and reports what already landed', async () => {
    let inserts = 0
    const calls = mockFetch([
      issueFound, uploadOk, signEcho,
      c => c.method === 'DELETE' && c.url.endsWith('/storage/v1/object/attachments') ? { body: [] } : undefined,
      c => {
        if (!(c.method === 'POST' && c.url.includes('/rest/v1/attachments'))) return undefined
        inserts++
        return inserts === 1
          ? { status: 201, body: [{ ...(c.body as object), created_at: '2026-10-26T10:00:00.000Z' }] }
          : { status: 409, body: { code: '23503' } }
      },
    ])
    const res = await onRequestPost(ctx('HZ-07', multipart('HZ-07', [['a.png', 'image/png', 'a'], ['b.png', 'image/png', 'b']])))
    expect(res.status).toBe(502)
    const out = await res.json() as any
    expect(out.error).toBe('db_error')
    expect(out.filename).toBe('b.png')
    expect(out.attachments.map((a: any) => a.filename)).toEqual(['a.png'])
    const del = calls.find(c => c.method === 'DELETE')!
    const secondPath = (calls.filter(c => c.url.includes('/rest/v1/attachments'))[1].body as any).path
    expect(del.body).toEqual({ prefixes: [secondPath] })
  })

  it('stops at a failed upload without writing its row', async () => {
    const calls = mockFetch([
      issueFound, signEcho,
      c => c.url.includes('/storage/v1/object/attachments/') ? { status: 413, body: { message: 'too big' } } : undefined,
    ])
    const res = await onRequestPost(ctx('HZ-07', multipart('HZ-07', [['a.png', 'image/png', 'a']])))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'upload_failed', filename: 'a.png', attachments: [] })
    expect(calls.some(c => c.url.includes('/rest/v1/attachments'))).toBe(false)
  })
})

describe('GET /api/tickets/:id/attachments', () => {
  it('lists with signed urls', async () => {
    mockFetch([
      c => c.url.includes('/rest/v1/issues?id=eq.HZ-07') ? { body: [{ id: 'HZ-07' }] } : undefined,
      c => c.url.includes('/rest/v1/attachments?issue_id=eq.HZ-07')
        ? { body: [{ id: 'a1', path: 'horizontal/HZ-07/a1', filename: 'x.png', size: 1, content_type: 'image/png', created_at: 't' }] }
        : undefined,
      signEcho,
    ])
    const res = await onRequestGet(ctx('HZ-07', new Request('https://app.test/api/tickets/HZ-07/attachments')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'HZ-07',
      attachments: [{
        id: 'a1', filename: 'x.png', contentType: 'image/png', size: 1, createdAt: 't',
        url: `${SB}/storage/v1/object/sign/attachments/horizontal/HZ-07/a1?token=t`,
      }],
    })
  })

  it('404s an unknown ticket', async () => {
    mockFetch([c => c.url.includes('/rest/v1/issues') ? { body: [] } : undefined])
    const res = await onRequestGet(ctx('HZ-99', new Request('https://app.test/api/tickets/HZ-99/attachments')))
    expect(res.status).toBe(404)
  })
})
