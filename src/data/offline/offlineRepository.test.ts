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
