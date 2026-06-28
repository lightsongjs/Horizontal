import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalRepository } from './localRepository'

// Minimal in-memory localStorage for the node test environment.
class MemStorage {
  store = new Map<string, string>()
  getItem(k: string) {
    return this.store.has(k) ? this.store.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.store.set(k, String(v))
  }
  removeItem(k: string) {
    this.store.delete(k)
  }
  clear() {
    this.store.clear()
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = new MemStorage()
})

describe('localRepository', () => {
  it('seeds the demo project on first use', async () => {
    const repo = createLocalRepository()
    const projects = await repo.listProjects()
    expect(projects.map((p) => p.id)).toContain('demo')
  })

  it('createProject adds the project and an initial Val 1 wave', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'Test', description: '', prefix: 'TST' })
    expect(p.id).toBe('tst')
    expect(await repo.listWaves('tst')).toEqual([
      { projectId: 'tst', number: 1, name: 'Val 1', label: 'MVP', position: 0 },
    ])
  })

  it('wave CRUD: create increments number/position, update renames, delete removes', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })

    const w2 = await repo.createWave('tst', 'Val 2', 'Next')
    expect(w2).toMatchObject({ number: 2, position: 1, name: 'Val 2', label: 'Next' })

    await repo.updateWave('tst', 2, { name: 'Sprint 2' })
    expect((await repo.listWaves('tst')).find((w) => w.number === 2)!.name).toBe('Sprint 2')

    await repo.deleteWave('tst', 2)
    expect((await repo.listWaves('tst')).some((w) => w.number === 2)).toBe(false)
  })

  it('createIssue generates sequential prefixed ids and defaults the wave', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const a = await repo.createIssue({ projectId: 'tst', title: 'A' })
    const b = await repo.createIssue({ projectId: 'tst', title: 'B', deps: [a.id] })
    expect([a.id, b.id]).toEqual(['TST-01', 'TST-02'])
    expect(a.wave).toBe(1)
    expect(b.deps).toEqual(['TST-01'])
  })

  it('updateIssue patches fields', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const a = await repo.createIssue({ projectId: 'tst', title: 'A' })
    const saved = await repo.updateIssue(a.id, { title: 'A2', done: true, wave: 2 })
    expect(saved).toMatchObject({ title: 'A2', done: true, wave: 2 })
  })

  it('deleteIssue removes it and strips it from other issues deps', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const a = await repo.createIssue({ projectId: 'tst', title: 'A' })
    const b = await repo.createIssue({ projectId: 'tst', title: 'B', deps: [a.id] })

    await repo.deleteIssue(a.id)
    const issues = await repo.listIssues('tst')
    expect(issues.map((i) => i.id)).toEqual([b.id])
    expect(issues[0].deps).toEqual([])
  })
})
