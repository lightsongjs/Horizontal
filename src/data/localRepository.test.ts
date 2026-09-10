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

  it('deleteIssues șterge toate tichetele date și curăță dependențele către ele', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const a = await repo.createIssue({ projectId: 'tst', title: 'A' })
    const b = await repo.createIssue({ projectId: 'tst', title: 'B' })
    const c = await repo.createIssue({ projectId: 'tst', title: 'C', deps: [a.id, b.id] })

    await repo.deleteIssues([a.id, b.id])

    const left = await repo.listIssues('tst')
    expect(left.map((i) => i.id)).not.toContain(a.id)
    expect(left.map((i) => i.id)).not.toContain(b.id)
    expect(left.find((i) => i.id === c.id)!.deps).toEqual([])
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

  it('creează obstacole cu id derivat din prefixul proiectului', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o1 = await repo.createObstacle({ projectId: p.id, title: 'Listare de facturi', owner: 'Echipa de API' })
    const o2 = await repo.createObstacle({ projectId: p.id, title: 'Care firmă?', owner: 'PM' })
    expect(o1.id).toBe('MCP-O01')
    expect(o2.id).toBe('MCP-O02')
    expect(o1.state).toBe('necunoscut')
    expect(o1.blocking).toBe(true)
    expect(o1.bypass).toBeNull()
    expect(o2.position).toBe(1)
  })

  it('leagă obstacolul la tichete și le întoarce ca muchii', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: '6 tool-uri' })
    const b = await repo.createIssue({ projectId: p.id, title: 'invoice_validate' })
    const o = await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id, b.id] })
    const links = await repo.listObstacleLinks(p.id)
    expect(links.filter((l) => l.obstacleId === o.id).map((l) => l.issueId).sort()).toEqual([a.id, b.id].sort())
  })

  it('pune resolvedAt la depășire și îl șterge la redeschidere', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o = await repo.createObstacle({ projectId: p.id, title: 'B2' })
    const closed = await repo.updateObstacle(o.id, { state: 'depasit' })
    expect(closed.resolvedAt).not.toBeNull()
    const reopened = await repo.updateObstacle(o.id, { state: 'asteptare' })
    expect(reopened.resolvedAt).toBeNull()
  })

  it('ștergerea unui tichet curăță legăturile lui de obstacole', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    await repo.deleteIssue(a.id)
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })

  it('ștergerea unui obstacol curăță legăturile și deps celorlalte', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    const root = await repo.createObstacle({ projectId: p.id, title: '#1' })
    const child = await repo.createObstacle({ projectId: p.id, title: '#19', deps: [root.id], issueIds: [a.id] })
    await repo.deleteObstacle(root.id)
    const left = await repo.listObstacles(p.id)
    expect(left.map((o) => o.id)).toEqual([child.id])
    expect(left[0].deps).toEqual([])
    expect((await repo.listObstacleLinks(p.id)).length).toBe(1)
    await repo.deleteObstacle(child.id)
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })

  it('setIssueObstacles înlocuiește complet setul tichetului', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    const o1 = await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    const o2 = await repo.createObstacle({ projectId: p.id, title: '#13' })
    await repo.setIssueObstacles(a.id, [o2.id])
    const links = await repo.listObstacleLinks(p.id)
    expect(links.map((l) => l.obstacleId)).toEqual([o2.id])
    expect(links.map((l) => l.obstacleId)).not.toContain(o1.id)
  })

  it('ștergerea proiectului șterge obstacolele și legăturile lui', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    await repo.deleteProject(p.id)
    expect(await repo.listObstacles(p.id)).toEqual([])
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })

  it('position e vârf de apă, nu un count viu: nu se ciocnește după o ștergere', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o1 = await repo.createObstacle({ projectId: p.id, title: '#1' })
    const o2 = await repo.createObstacle({ projectId: p.id, title: '#2' })
    const o3 = await repo.createObstacle({ projectId: p.id, title: '#3' })
    await repo.deleteObstacle(o2.id)
    const o4 = await repo.createObstacle({ projectId: p.id, title: '#4' })
    const left = await repo.listObstacles(p.id)
    expect(left.map((o) => o.id)).toEqual([o1.id, o3.id, o4.id])
    const positions = left.map((o) => o.position)
    expect(new Set(positions).size).toBe(positions.length)
    expect(left[left.length - 1].id).toBe(o4.id)
  })

  it('updateObstacle ignoră resolvedAt, id și projectId din patch', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o = await repo.createObstacle({ projectId: p.id, title: 'B1' })

    const withFakeResolved = await repo.updateObstacle(o.id, { resolvedAt: '2020-01-01T00:00:00.000Z' })
    expect(withFakeResolved.resolvedAt).toBeNull()

    const withFakeIds = await repo.updateObstacle(o.id, { id: 'ALTUL', projectId: 'x' })
    expect(withFakeIds.id).toBe(o.id)
    expect(withFakeIds.projectId).toBe(p.id)
  })
})
