import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfflineRepository } from './offlineRepository'
import { openKv, type Kv } from './kv'
import { OfflineError } from './netError'
import type { Repository } from '../repository'
import type { Issue, Project } from '../../lib/types'

export const proj: Project = { id: 'p', name: 'P', description: '', prefix: 'HZ', currentWave: 1, accent: '#000', type: 'personal' }
export const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [],
  scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null, ...over,
})

export function fakeRemote() {
  const net = { down: false }
  const server = { issues: [mk('HZ-01'), mk('HZ-02')], next: 13 }
  const guard = <T>(f: () => T) => async () => {
    if (net.down) throw new TypeError('Failed to fetch')
    return f()
  }
  const remote = {
    listProjects: vi.fn(guard(() => [proj])),
    listAssignees: vi.fn(guard(() => [])),
    listWaves: vi.fn(guard(() => [])),
    listThemes: vi.fn(guard(() => [])),
    listIssues: vi.fn(async (pid: string) => guard(() => server.issues.filter((i) => i.projectId === pid))()),
    listObstacles: vi.fn(guard(() => [])),
    listObstacleLinks: vi.fn(guard(() => [])),
    listProjectMembers: vi.fn(guard(() => [])),
    listDueIssues: vi.fn(guard(() => server.issues.filter((i) => i.dueAt))),
    listInbox: vi.fn(guard(() => [])),
    listEvents: vi.fn(guard(() => [])),
    createProject: vi.fn(guard(() => proj)),
    createIssue: vi.fn(async (input: { projectId: string; title: string; deps?: string[] }) => guard(() => {
      const i = mk(`HZ-${server.next++}`, { title: input.title, deps: input.deps ?? [] })
      server.issues.push(i)
      return i
    })()),
    updateIssue: vi.fn(async (id: string, patch: Partial<Issue>) => guard(() => {
      const i = server.issues.find((x) => x.id === id)
      if (!i) throw { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }
      Object.assign(i, patch)
      return { ...i }
    })()),
    deleteIssues: vi.fn(async (ids: string[]) => guard(() => { server.issues = server.issues.filter((i) => !ids.includes(i.id)) })()),
    deleteIssue: vi.fn(async (id: string) => guard(() => { server.issues = server.issues.filter((i) => i.id !== id) })()),
    markSeen: vi.fn(guard(() => undefined)),
    postToThread: vi.fn(guard(() => ({}))),
  } as unknown as Repository
  return { remote, net, server }
}

let n = 0
let kv: Kv
beforeEach(async () => { kv = await openKv(`r-${++n}`) })
const make = (remote: Repository) =>
  createOfflineRepository(remote, Promise.resolve(kv), { now: () => new Date('2026-10-02T09:00:00Z'), userId: () => 'u1', readTimeoutMs: 1000, channel: null })

describe('citiri', () => {
  it('cu rețea: răspunde serverul și se scrie cache-ul', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect((await repo.cache!.project('p'))?.issues.map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
  })
  it('fără rețea: răspunde cache-ul și statusul devine offline', async () => {
    const { remote, net } = fakeRemote()
    const repo = make(remote)
    await repo.listProjects()
    await repo.listIssues('p')
    net.down = true
    expect(await repo.listProjects()).toEqual([proj])
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect(repo.sync!.status().offline).toBe(true)
  })
  it('fără rețea și fără cache: OfflineError, nu o eroare de rețea crudă', async () => {
    const { remote, net } = fakeRemote()
    net.down = true
    await expect(make(remote).listIssues('p')).rejects.toBeInstanceOf(OfflineError)
  })
  it('o eroare de server nu cade pe cache', async () => {
    const { remote } = fakeRemote()
    ;(remote.listIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ message: 'permission denied', code: '42501' })
    await expect(make(remote).listIssues('p')).rejects.toMatchObject({ code: '42501' })
  })
  it('cache.due derivă scadențele din toate proiectele din cache', async () => {
    const { remote, server } = fakeRemote()
    server.issues[0].dueAt = '2026-10-03T07:00:00.000Z'
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    const due = await repo.cache!.due({ to: '2026-10-09T21:00:00.000Z', doneFrom: '2026-10-01T21:00:00.000Z' })
    expect(due?.map((i) => i.id)).toEqual(['HZ-01'])
  })
  it('fără IndexedDB: trece direct la server, fără cache', async () => {
    const { remote } = fakeRemote()
    const repo = createOfflineRepository(remote, Promise.resolve(null), { channel: null })
    expect((await repo.listIssues('p')).length).toBe(2)
    expect(await repo.cache!.projects()).toBeNull()
  })
})

describe('citiri — robustețe', () => {
  it('o scriere eșuată în cache nu aruncă răspunsul serverului', async () => {
    const { remote } = fakeRemote()
    const broken = { ...kv, set: async () => { throw new DOMException('full', 'QuotaExceededError') } } as Kv
    const repo = createOfflineRepository(remote, Promise.resolve(broken), { channel: null })
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect(repo.sync!.status().offline).toBe(false)
  })
  it('prefetchAll: eroarea unui proiect nu lasă necache-uite celelalte', async () => {
    const { remote } = fakeRemote()
    const q: Project = { ...proj, id: 'q', name: 'Q' }
    ;(remote.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([proj, q])
    ;(remote.listWaves as ReturnType<typeof vi.fn>).mockImplementation(async (pid: string) => {
      if (pid === 'p') throw { message: 'permission denied', code: '42501' }
      return []
    })
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    expect(await repo.cache!.project('q')).not.toBeNull()
  })
  it('cache.due: lista completă a proiectului e autoritară; due doar pentru proiecte necache-uite', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    await repo.listIssues('p')
    const range = { to: '2026-10-09T21:00:00.000Z', doneFrom: '2026-10-01T21:00:00.000Z' }
    const due = '2026-10-03T07:00:00.000Z'
    await kv.set('due', [mk('HZ-09', { dueAt: due }), mk('Q-01', { projectId: 'q', dueAt: due })])
    expect((await repo.cache!.due(range))?.map((i) => i.id)).toEqual(['Q-01'])
  })
})

describe('scrieri', () => {
  async function offlineRepo() {
    const f = fakeRemote()
    const repo = make(f.remote)
    await repo.sync!.prefetchAll()
    f.net.down = true
    return { ...f, repo }
  }

  it('cu rețea: createIssue primește ID-ul real direct, fără coadă', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    const c = await repo.createIssue({ projectId: 'p', title: 'sună la bancă' })
    expect(c.id).toBe('HZ-13')
    expect(repo.sync!.status().pending).toBe(0)
  })

  it('offline: createIssue întoarce un ID provizoriu și tichetul se vede în citiri', async () => {
    const { repo } = await offlineRepo()
    const c = await repo.createIssue({ projectId: 'p', title: 'sună la bancă' })
    expect(c.id).toMatch(/^HZ-~/)
    expect(c.createdBy).toBe('u1')
    expect((await repo.listIssues('p')).map((i) => i.title)).toContain('sună la bancă')
    expect(repo.sync!.status().pending).toBe(1)
  })

  it('offline: updateIssue întoarce ecoul și citirile îl arată', async () => {
    const { repo } = await offlineRepo()
    const saved = await repo.updateIssue('HZ-02', { title: 'nou' })
    expect(saved.title).toBe('nou')
    expect((await repo.listIssues('p')).find((i) => i.id === 'HZ-02')?.title).toBe('nou')
  })

  it('o scriere nouă cu coada nevidă intră la coadă chiar dacă rețeaua a revenit (ordinea contează)', async () => {
    const { repo, net, remote } = await offlineRepo()
    await repo.updateIssue('HZ-01', { title: 'a' })
    net.down = false
    await repo.updateIssue('HZ-01', { title: 'b' })
    // Singurul apel e încercarea directă a lui „a", picată pe rețea; „b" n-a mai încercat.
    expect(remote.updateIssue).toHaveBeenCalledTimes(1)
    expect(remote.updateIssue).toHaveBeenNthCalledWith(1, 'HZ-01', { title: 'a' })
    expect(repo.sync!.status().pending).toBe(2)
  })

  it('ștergerea unui tichet creat offline nu trimite nimic și scoate dependențele spre el', async () => {
    const { repo, remote } = await offlineRepo()
    const c = await repo.createIssue({ projectId: 'p', title: 'efemer' })
    await repo.updateIssue('HZ-02', { deps: [c.id, 'HZ-01'] })
    await repo.deleteIssue(c.id)
    const issues = await repo.listIssues('p')
    expect(issues.map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect(issues.find((i) => i.id === 'HZ-02')?.deps).toEqual(['HZ-01'])
    expect(repo.sync!.status().pending).toBe(1)
    expect(remote.deleteIssues).not.toHaveBeenCalled()
    expect(remote.deleteIssue).not.toHaveBeenCalled()
  })

  it('offline: o acțiune care cere rețea aruncă OfflineError', async () => {
    const { repo } = await offlineRepo()
    await expect(repo.postToThread({ issueId: 'HZ-01', projectId: 'p', body: 'x' })).rejects.toBeInstanceOf(OfflineError)
  })

  it('o eroare de server la scrierea directă se aruncă, nu se pune la coadă', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    await expect(repo.updateIssue('NU-EXISTA', { title: 'x' })).rejects.toMatchObject({ code: 'PGRST116' })
    expect(repo.sync!.status().pending).toBe(0)
  })

  it('cache-ul stricat după o scriere acceptată de server nu o face eroare și nu o pune la coadă', async () => {
    const { remote } = fakeRemote()
    const broken = { ...kv, set: async () => { throw new DOMException('full', 'QuotaExceededError') } } as Kv
    const repo = createOfflineRepository(remote, Promise.resolve(broken), { userId: () => 'u1', channel: null })
    const seen: string[] = []
    repo.sync!.subscribe((e) => { if (e.type === 'issue') seen.push(e.issue.id) })
    const c = await repo.createIssue({ projectId: 'p', title: 'x' })
    expect(c.id).toBe('HZ-13')
    expect(repo.sync!.status().pending).toBe(0)
    expect(remote.createIssue).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['HZ-13'])
  })

  it('scrierile directe intră în bază: offline după ele, citirile arată valorile serverului', async () => {
    const { repo, net } = await (async () => {
      const f = fakeRemote()
      const repo = make(f.remote)
      await repo.sync!.prefetchAll()
      return { ...f, repo }
    })()
    const c = await repo.createIssue({ projectId: 'p', title: 'nou' })
    await repo.updateIssue('HZ-01', { title: 'schimbat' })
    net.down = true
    const issues = await repo.listIssues('p')
    expect(issues.map((i) => i.id)).toContain(c.id)
    expect(issues.find((i) => i.id === 'HZ-01')?.title).toBe('schimbat')
    expect(repo.sync!.status().pending).toBe(0)
  })

  it('ștergerea directă scoate tichetul și dependențele spre el din bază', async () => {
    const f = fakeRemote()
    f.server.issues[1].deps = ['HZ-01']
    const repo = make(f.remote)
    await repo.sync!.prefetchAll()
    await repo.deleteIssues(['HZ-01'])
    f.net.down = true
    const issues = await repo.listIssues('p')
    expect(issues.map((i) => i.id)).toEqual(['HZ-02'])
    expect(issues[0].deps).toEqual([])
  })

  it('scrierea directă nu inventează `due` când nu era în cache', async () => {
    const f = fakeRemote()
    const repo = make(f.remote)
    await repo.sync!.prefetchAll()
    await repo.updateIssue('HZ-01', { title: 'x' })
    expect(await kv.get('due')).toBeUndefined()
  })

  it('deleteIssues: dacă scrierea ID-urilor reale pică, ștergerea celor provizorii tot se anunță', async () => {
    const { remote, net } = fakeRemote()
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    net.down = true
    const t = await repo.createIssue({ projectId: 'p', title: 'efemer' })
    const removed: string[] = []
    repo.sync!.subscribe((e) => { if (e.type === 'removed') removed.push(...e.ids) })
    ;(remote.deleteIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ message: 'denied', code: '42501' })
    net.down = false
    await expect(repo.deleteIssues([t.id, 'HZ-01'])).rejects.toMatchObject({ code: '42501' })
    expect(removed).toEqual([t.id])
  })
})
