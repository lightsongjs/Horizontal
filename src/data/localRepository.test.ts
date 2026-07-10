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

  it('createProject adds the project with a Scratchpad + Val 1 wave', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'Test', description: '', prefix: 'TST' })
    expect(p.id).toBe('tst')
    expect(p.currentWave).toBe(1)
    expect(await repo.listWaves('tst')).toEqual([
      { projectId: 'tst', number: 0, name: 'Scratchpad', label: '', position: 0 },
      { projectId: 'tst', number: 1, name: 'Val 1', label: 'MVP', position: 1 },
    ])
  })

  it('wave CRUD: create increments number/position, update renames, delete removes', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })

    const w2 = await repo.createWave('tst', 'Val 2', 'Next')
    expect(w2).toMatchObject({ number: 2, position: 2, name: 'Val 2', label: 'Next' })

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

  it('theme CRUD: create slugs the key, assign to an issue, delete clears it', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })

    const theme = await repo.createTheme('tst', 'Auth Stuff', '#6e7bff')
    expect(theme.key).toBe('auth-stuff')
    expect(await repo.listThemes('tst')).toEqual([theme])

    await repo.updateTheme('tst', 'auth-stuff', { name: 'Auth', color: '#fff' })
    expect((await repo.listThemes('tst'))[0]).toMatchObject({ name: 'Auth', color: '#fff' })

    const issue = await repo.createIssue({ projectId: 'tst', title: 'A', theme: 'auth-stuff' })
    expect(issue.theme).toBe('auth-stuff')

    await repo.deleteTheme('tst', 'auth-stuff')
    expect(await repo.listThemes('tst')).toEqual([])
    expect((await repo.listIssues('tst'))[0].theme).toBe('') // cleared from the issue
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

  it('createIssue defaults urgent to false; updateIssue toggles it', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const created = await repo.createIssue({ projectId: 'tst', title: 'Task' })
    expect(created.urgent).toBe(false)

    const updated = await repo.updateIssue(created.id, { urgent: true })
    expect(updated.urgent).toBe(true)

    const reloaded = (await repo.listIssues('tst')).find((i) => i.id === created.id)!
    expect(reloaded.urgent).toBe(true)
  })

  it('deleteWave refuses to delete the Scratchpad (wave 0)', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    await expect(repo.deleteWave('tst', 0)).rejects.toThrow(/scratchpad/i)
    expect((await repo.listWaves('tst')).some((w) => w.number === 0)).toBe(true)
  })

  it('backfills urgent=false for legacy issues persisted without the field', async () => {
    // Seed localStorage with a DB whose issue predates the urgent field.
    const legacy = {
      projects: [
        { id: 'leg', name: 'L', description: '', prefix: 'LEG', currentWave: 1, accent: '#0EA5E9', type: 'personal' },
      ],
      waves: [{ projectId: 'leg', number: 1, name: 'Val 1', label: 'MVP', position: 0 }],
      themes: [],
      issues: [
        { id: 'LEG-01', projectId: 'leg', title: 'Old', desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null },
      ] as unknown[],
      assignees: [],
    }
    localStorage.setItem('horizontal:v2', JSON.stringify(legacy))

    const repo = createLocalRepository()
    const issue = (await repo.listIssues('leg')).find((i) => i.id === 'LEG-01')!
    expect(issue.urgent).toBe(false)
  })
})
