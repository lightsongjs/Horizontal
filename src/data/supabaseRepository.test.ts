import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny in-memory stand-in for the Supabase client: faithful enough to run the
// repository's real query chains (.from().select().eq().order().single(),
// .insert(), .update(), .delete()) against arrays, so we can verify column
// mapping and CRUD without a live database.
const { fakeDb } = vi.hoisted(() => {
  type Row = Record<string, unknown>
  class Query {
    op = 'select'
    filters: [string, unknown][] = []
    inFilters: [string, unknown[]][] = []
    payload: Row | Row[] | null = null
    single_ = false
    constructor(
      private tables: Record<string, Row[]>,
      private table: string,
    ) {}
    select() {
      return this
    }
    insert(rows: Row | Row[]) {
      this.op = 'insert'
      this.payload = rows
      return this
    }
    update(row: Row) {
      this.op = 'update'
      this.payload = row
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    eq(col: string, val: unknown) {
      this.filters.push([col, val])
      return this
    }
    in(col: string, vals: unknown[]) {
      this.inFilters.push([col, vals])
      return this
    }
    order() {
      return this
    }
    single() {
      this.single_ = true
      return this
    }
    private match(r: Row) {
      return this.filters.every(([c, v]) => r[c] === v) &&
        this.inFilters.every(([c, vals]) => vals.includes(r[c]))
    }
    private run() {
      const t = this.tables[this.table]
      if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload!]
        t.push(...rows.map((r) => ({ ...r })))
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        const matched = t.filter((r) => this.match(r))
        matched.forEach((r) => Object.assign(r, this.payload))
        return { data: this.single_ ? (matched[0] ?? null) : matched, error: null }
      }
      if (this.op === 'delete') {
        this.tables[this.table] = t.filter((r) => !this.match(r))
        return { data: null, error: null }
      }
      const rows = t.filter((r) => this.match(r))
      return { data: this.single_ ? (rows[0] ?? null) : rows, error: null }
    }
    then(resolve: (v: unknown) => void) {
      resolve(this.run())
    }
  }
  class FakeDB {
    tables: Record<string, Row[]> = { projects: [], waves: [], themes: [], issues: [], dependencies: [] }
    from(table: string) {
      return new Query(this.tables, table)
    }
    reset() {
      this.tables = { projects: [], waves: [], themes: [], issues: [], dependencies: [] }
    }
  }
  return { fakeDb: new FakeDB() }
})

vi.mock('../lib/supabase', () => ({ supabase: fakeDb, requireSupabase: () => fakeDb }))

import { createSupabaseRepository } from './supabaseRepository'

beforeEach(() => fakeDb.reset())

describe('supabaseRepository', () => {
  it('listIssues maps the `details` column to desc and assembles deps', async () => {
    fakeDb.tables.issues.push(
      { id: 'P-01', project_id: 'p', title: 'A', details: 'note', wave: 1, done: true },
      { id: 'P-02', project_id: 'p', title: 'B', details: '', wave: 2, done: false },
    )
    fakeDb.tables.dependencies.push({ issue_id: 'P-02', depends_on_id: 'P-01' })

    const repo = createSupabaseRepository()
    const issues = await repo.listIssues('p')

    expect(issues.find((i) => i.id === 'P-01')).toMatchObject({ desc: 'note', done: true })
    expect(issues.find((i) => i.id === 'P-02')!.deps).toEqual(['P-01'])
  })

  it('createProject inserts the project and a Val 1 wave', async () => {
    const repo = createSupabaseRepository()
    const p = await repo.createProject({ name: 'Turism', description: 'd', prefix: 'TUR' })

    expect(p.id).toBe('tur')
    expect(fakeDb.tables.projects[0]).toMatchObject({ id: 'tur', prefix: 'TUR', current_wave: 1 })
    expect(fakeDb.tables.waves).toEqual([
      { project_id: 'tur', number: 1, name: 'Val 1', label: 'MVP', position: 0 },
    ])
  })

  it('createIssue writes the `details` column (not `desc`) and dependency rows', async () => {
    fakeDb.tables.projects.push({ id: 'p', prefix: 'P', current_wave: 1, name: 'x', description: '', accent: '#fff' })
    fakeDb.tables.issues.push({ id: 'P-01', project_id: 'p', title: 'A', details: '', wave: 1, done: false })

    const repo = createSupabaseRepository()
    const issue = await repo.createIssue({ projectId: 'p', title: 'B', desc: 'hello', deps: ['P-01'] })

    expect(issue.id).toBe('P-02')
    const row = fakeDb.tables.issues.find((r) => r.id === 'P-02')!
    expect(row).toMatchObject({ title: 'B', details: 'hello', project_id: 'p', wave: 1 })
    expect('desc' in row).toBe(false) // must use the real column name
    expect(fakeDb.tables.dependencies).toContainEqual({ issue_id: 'P-02', depends_on_id: 'P-01' })
  })

  it('updateIssue replaces the full dependency set', async () => {
    fakeDb.tables.issues.push({ id: 'P-02', project_id: 'p', title: 'B', details: '', wave: 1, done: false })
    fakeDb.tables.dependencies.push({ issue_id: 'P-02', depends_on_id: 'P-01' })

    const repo = createSupabaseRepository()
    await repo.updateIssue('P-02', { deps: ['P-03'] })

    expect(fakeDb.tables.dependencies.filter((d) => d.issue_id === 'P-02')).toEqual([
      { issue_id: 'P-02', depends_on_id: 'P-03' },
    ])
  })

  it('createTheme inserts a slugged key and listThemes maps project_id', async () => {
    fakeDb.tables.projects.push({ id: 'p', prefix: 'P', current_wave: 1, name: 'x', description: '', accent: '#fff' })
    const repo = createSupabaseRepository()
    const t = await repo.createTheme('p', 'Auth Stuff', '#6e7bff')
    expect(t).toEqual({ projectId: 'p', key: 'auth-stuff', name: 'Auth Stuff', color: '#6e7bff' })
    expect(fakeDb.tables.themes[0]).toMatchObject({ project_id: 'p', key: 'auth-stuff', name: 'Auth Stuff' })
    expect(await repo.listThemes('p')).toEqual([{ projectId: 'p', key: 'auth-stuff', name: 'Auth Stuff', color: '#6e7bff' }])
  })

  it('deleteTheme clears the theme from issues, then removes the theme row', async () => {
    fakeDb.tables.themes.push({ project_id: 'p', key: 'auth', name: 'Auth', color: '#6e7bff' })
    fakeDb.tables.issues.push({ id: 'P-01', project_id: 'p', title: 'A', details: '', theme: 'auth', wave: 1, done: false })
    const repo = createSupabaseRepository()
    await repo.deleteTheme('p', 'auth')
    expect(fakeDb.tables.themes).toHaveLength(0)
    expect(fakeDb.tables.issues[0].theme).toBeNull()
  })

  it('listIssues maps the theme column', async () => {
    fakeDb.tables.issues.push({ id: 'P-01', project_id: 'p', title: 'A', details: '', theme: 'auth', wave: 1, done: false })
    const repo = createSupabaseRepository()
    const issues = await repo.listIssues('p')
    expect(issues[0].theme).toBe('auth')
  })

  it('deleteIssue removes the issue row', async () => {
    fakeDb.tables.issues.push({ id: 'P-01', project_id: 'p', title: 'A', details: '', wave: 1, done: false })
    const repo = createSupabaseRepository()
    await repo.deleteIssue('P-01')
    expect(fakeDb.tables.issues).toHaveLength(0)
  })
})
