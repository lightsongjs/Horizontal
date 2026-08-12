import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-in pentru clientul Supabase: acoperă lanțurile pe care le folosește
// modulul (.from().select().eq()/.in(), .insert().select().single(), .delete(),
// plus .storage.from().upload()/.remove()/.createSignedUrls()).
const { fake } = vi.hoisted(() => {
  type Row = Record<string, unknown>
  // Comutatoare de eșec, citite din `run()`. Preferate înlocuirii lui `fake.from`
  // pe durata unui test: aceea lăsa fake-ul într-o stare pe care testul următor
  // o moștenea dacă restaurarea nu se executa (o aserțiune care aruncă).
  const flags = { failInsert: false }
  class Query {
    op = 'select'
    filters: [string, unknown][] = []
    inFilters: [string, unknown[]][] = []
    payload: Row | null = null
    single_ = false
    constructor(private tables: Record<string, Row[]>, private table: string) {}
    select() { return this }
    insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
    delete() { this.op = 'delete'; return this }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
    in(col: string, vals: unknown[]) { this.inFilters.push([col, vals]); return this }
    order() { return this }
    single() { this.single_ = true; return this }
    private match(r: Row) {
      return this.filters.every(([c, v]) => r[c] === v) && this.inFilters.every(([c, vs]) => vs.includes(r[c]))
    }
    private run() {
      const t = this.tables[this.table]
      if (this.op === 'insert') {
        if (flags.failInsert) return { data: null, error: { message: 'rls' } }
        const row = { ...this.payload }
        t.push(row)
        return { data: this.single_ ? row : [row], error: null }
      }
      if (this.op === 'delete') {
        this.tables[this.table] = t.filter((r) => !this.match(r))
        return { data: null, error: null }
      }
      const rows = t.filter((r) => this.match(r))
      return { data: this.single_ ? (rows[0] ?? null) : rows, error: null }
    }
    then(resolve: (v: unknown) => void) { resolve(this.run()) }
  }
  class FakeStorage {
    objects = new Set<string>()
    removed: string[][] = []
    uploads: { path: string; options: Record<string, unknown> }[] = []
    failUpload = false
    failRemove = false
    from(_bucket: string) {
      return {
        upload: async (path: string, _body: unknown, options: Record<string, unknown>) => {
          if (this.failUpload) return { data: null, error: { message: 'upload a picat' } }
          this.objects.add(path)
          this.uploads.push({ path, options })
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          this.removed.push(paths)
          if (this.failRemove) return { data: null, error: { message: 'remove a picat' } }
          paths.forEach((p) => this.objects.delete(p))
          return { data: null, error: null }
        },
        createSignedUrls: async (paths: string[], _ttl: number) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://sb.test/${path}?token=abc`, error: null })),
          error: null,
        }),
        createSignedUrl: async (path: string, _ttl: number, opts?: Record<string, unknown>) => ({
          data: { signedUrl: `https://sb.test/${path}?dl=${String(opts?.download ?? '')}` },
          error: null,
        }),
      }
    }
    reset() {
      this.objects = new Set()
      this.removed = []
      this.uploads = []
      this.failUpload = false
      this.failRemove = false
    }
  }
  class Fake {
    tables: Record<string, Row[]> = { attachments: [] }
    storage = new FakeStorage()
    flags = flags
    from(table: string) { return new Query(this.tables, table) }
    reset() { this.tables = { attachments: [] }; this.storage.reset(); flags.failInsert = false }
  }
  return { fake: new Fake() }
})

vi.mock('../lib/supabase', () => ({ supabase: fake, requireSupabase: () => fake }))

import {
  buildAttachmentPath,
  isRenderableImage,
  chunk,
  cachedUrls,
  rememberUrls,
  resetUrlCache,
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  signedUrls,
  removeObjects,
  pathsForIssues,
  pathsForProject,
} from './attachments'

beforeEach(() => {
  fake.reset()
  resetUrlCache()
})

describe('buildAttachmentPath', () => {
  it('proiectul e primul segment — politica RLS citește exact segmentul ăsta', () => {
    expect(buildAttachmentPath('tur', 'TUR-01', 'abc-123')).toBe('tur/TUR-01/abc-123')
  })

  it('calea nu are extensie — content_type real trăiește în DB', () => {
    expect(buildAttachmentPath('tur', 'TUR-01', 'abc-123')).not.toMatch(/\.\w+$/)
  })
})

describe('isRenderableImage', () => {
  it('tipurile de imagine sigure se randează inline', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isRenderableImage(t)).toBe(true)
    }
  })

  it('SVG-ul NU se randează inline, nici HTML-ul', () => {
    expect(isRenderableImage('image/svg+xml')).toBe(false)
    expect(isRenderableImage('text/html')).toBe(false)
  })

  it('un tip necunoscut nu se randează', () => {
    expect(isRenderableImage('application/octet-stream')).toBe(false)
  })
})

describe('chunk', () => {
  it('împarte în tranșe de mărimea cerută', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('lista goală dă zero tranșe', () => {
    expect(chunk([], 2)).toEqual([])
  })
})

describe('memorarea URL-urilor semnate', () => {
  it('un URL memorat se refolosește — altfel fiecare deschidere redescarcă tot', () => {
    rememberUrls([{ path: 'p/i/a', url: 'https://x/a' }], 1_000_000)
    const r = cachedUrls(['p/i/a'], 1_000_000 + 60_000)
    expect(r.hits).toEqual({ 'p/i/a': 'https://x/a' })
    expect(r.misses).toEqual([])
  })

  it('un URL aproape expirat se reînnoiește, nu se folosește pe muchie', () => {
    rememberUrls([{ path: 'p/i/a', url: 'https://x/a' }], 0, 100)
    // 100s TTL, marja de siguranță e 60s → la t=50s mai rămân 50s, deci miss.
    const r = cachedUrls(['p/i/a'], 50_000)
    expect(r.hits).toEqual({})
    expect(r.misses).toEqual(['p/i/a'])
  })

  it('separă ce e în cache de ce lipsește, într-un singur apel', () => {
    rememberUrls([{ path: 'a', url: 'https://x/a' }], 0)
    const r = cachedUrls(['a', 'b'], 1000)
    expect(Object.keys(r.hits)).toEqual(['a'])
    expect(r.misses).toEqual(['b'])
  })

  it('resetUrlCache golește tot', () => {
    rememberUrls([{ path: 'a', url: 'https://x/a' }], 0)
    resetUrlCache()
    expect(cachedUrls(['a'], 1000).misses).toEqual(['a'])
  })
})

describe('listAttachments', () => {
  it('mapează coloanele în modelul aplicației', async () => {
    fake.tables.attachments.push({
      id: 'a1', issue_id: 'TUR-01', project_id: 'tur', path: 'tur/TUR-01/a1',
      filename: 'ecran.png', size: 1234, content_type: 'image/png',
      created_at: '2026-08-12T10:00:00Z',
    })
    const list = await listAttachments('TUR-01')
    expect(list).toEqual([{
      id: 'a1', issueId: 'TUR-01', projectId: 'tur', path: 'tur/TUR-01/a1',
      filename: 'ecran.png', size: 1234, contentType: 'image/png',
      createdAt: '2026-08-12T10:00:00Z',
    }])
  })

  it('un tichet fără fișiere dă listă goală', async () => {
    expect(await listAttachments('TUR-09')).toEqual([])
  })
})

describe('uploadAttachment', () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], 'ecran.png', { type: 'image/png' })

  it('urcă octeții și scrie rândul', async () => {
    const a = await uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' })
    expect(a.path).toBe(`tur/TUR-01/${a.id}`)
    expect(fake.storage.objects.has(a.path)).toBe(true)
    expect(fake.tables.attachments).toHaveLength(1)
    expect(fake.tables.attachments[0]).toMatchObject({
      issue_id: 'TUR-01', project_id: 'tur', filename: 'ecran.png', content_type: 'image/png', size: 3,
    })
  })

  it('urcă cu cache imuabil — obiectele nu se rescriu niciodată', async () => {
    await uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' })
    expect(fake.storage.uploads[0].options).toMatchObject({ cacheControl: '31536000', upsert: false, contentType: 'image/png' })
  })

  it('dacă rândul nu se poate scrie, octeții urcați se retrag', async () => {
    fake.flags.failInsert = true
    await expect(
      uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' }),
    ).rejects.toThrow()
    // Octeții nu au voie să rămână orfani: dacă rândul a picat, s-a chemat remove.
    expect(fake.storage.removed.flat()).toHaveLength(1)
    expect(fake.tables.attachments).toEqual([])
  })
})

describe('deleteAttachment', () => {
  it('șterge rândul întâi, apoi octeții', async () => {
    const a = await uploadAttachment({
      issueId: 'TUR-01', projectId: 'tur',
      file: new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }), filename: 'x.png',
    })
    await deleteAttachment(a)
    expect(fake.tables.attachments).toEqual([])
    expect(fake.storage.objects.has(a.path)).toBe(false)
  })
})

describe('removeObjects', () => {
  it('nu aruncă niciodată, nici când Storage întoarce eroare', async () => {
    fake.storage.failRemove = true
    await expect(removeObjects(['a', 'b'])).resolves.toBeUndefined()
  })

  it('lista goală nu lovește deloc rețeaua', async () => {
    await removeObjects([])
    expect(fake.storage.removed).toEqual([])
  })

  it('împarte în tranșe — clientul JS nu împarte singur, iar corpul are plafon', async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `p/i/${i}`)
    await removeObjects(paths)
    expect(fake.storage.removed.map((t) => t.length)).toEqual([100, 100, 50])
  })
})

describe('signedUrls', () => {
  it('cere într-un singur apel și memorează rezultatul', async () => {
    const first = await signedUrls(['tur/TUR-01/a1'])
    expect(first['tur/TUR-01/a1']).toContain('token=abc')
    // Al doilea apel vine din cache: URL identic, deci aceeași cheie de cache HTTP.
    const second = await signedUrls(['tur/TUR-01/a1'])
    expect(second).toEqual(first)
  })

  it('lista goală nu lovește rețeaua', async () => {
    expect(await signedUrls([])).toEqual({})
  })
})

describe('pathsForIssues / pathsForProject', () => {
  beforeEach(() => {
    fake.tables.attachments.push(
      { id: 'a1', issue_id: 'TUR-01', project_id: 'tur', path: 'tur/TUR-01/a1', filename: 'x', size: 1, content_type: 'image/png', created_at: 'z' },
      { id: 'a2', issue_id: 'TUR-02', project_id: 'tur', path: 'tur/TUR-02/a2', filename: 'y', size: 1, content_type: 'image/png', created_at: 'z' },
      { id: 'a3', issue_id: 'OTH-01', project_id: 'oth', path: 'oth/OTH-01/a3', filename: 'z', size: 1, content_type: 'image/png', created_at: 'z' },
    )
  })

  it('strânge căile mai multor tichete într-o singură interogare', async () => {
    expect((await pathsForIssues(['TUR-01', 'TUR-02'])).sort()).toEqual(['tur/TUR-01/a1', 'tur/TUR-02/a2'])
  })

  it('lista goală de tichete nu lovește rețeaua', async () => {
    expect(await pathsForIssues([])).toEqual([])
  })

  it('proiectul se rezolvă din project_id, nu prin plimbare în Storage', async () => {
    expect((await pathsForProject('tur')).sort()).toEqual(['tur/TUR-01/a1', 'tur/TUR-02/a2'])
  })
})
