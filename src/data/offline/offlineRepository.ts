// A treia implementare de `Repository`: învelește repository-ul de Supabase cu
// o bază locală și o coadă de scrieri. Nicio componentă nu știe că există —
// în afară de indicatorul din header (`sync.status`) și de puntea care
// redenumește un tichet provizoriu (`sync.subscribe`).
//
// Citirile: întâi serverul (cu prag de timp), iar la eșec de REȚEA, cache-ul.
// Primul cadru nu așteaptă nici atât: store-ul citește `cache` direct.
// Ce vede aplicația din tichete = baza + coada rejucată (`overlay`, ops.ts).

import type { Repository } from '../repository'
import type { Assignee, InboxRow, Issue, Project } from '../../lib/types'
import type { Kv } from './kv'
import { OfflineError, isNetworkError, withTimeout } from './netError'
import { deriveDue, overlay, type OutboxOp } from './ops'
import type { CacheReader, ProjectBundle, SyncControl, SyncEvent, SyncStatus } from './types'

export interface SyncChannel {
  post(e: SyncEvent): void
  onMessage(fn: (e: SyncEvent) => void): void
}

export interface OfflineOptions {
  now?: () => Date
  userId?: () => string | null
  readTimeoutMs?: number
  channel?: SyncChannel | null
  lock?: (fn: () => Promise<void>) => Promise<void>
}

const K = {
  projects: 'projects',
  assignees: 'assignees',
  inbox: 'inbox',
  due: 'due',
  p: (pid: string, what: keyof ProjectBundle) => `p:${pid}:${what}`,
}

/** Un mutex în proces, pentru unde Web Locks nu există (teste, Node). */
function localLock() {
  let tail = Promise.resolve()
  return (fn: () => Promise<void>) => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }
}

export function createOfflineRepository(remote: Repository, kvReady: Promise<Kv | null>, opts: OfflineOptions = {}): Repository {
  const now = opts.now ?? (() => new Date())
  const readTimeoutMs = opts.readTimeoutMs ?? 10_000
  const lock = opts.lock ?? localLock()
  void lock // folosit de scrieri și de flush, în Task 7 și 8
  const listeners = new Set<(e: SyncEvent) => void>()
  let status: SyncStatus = { offline: false, pending: 0 }

  const emitLocal = (e: SyncEvent) => { for (const fn of listeners) fn(e) }
  const emit = (e: SyncEvent) => {
    emitLocal(e)
    // Statusul e al fiecărei file (fiecare își numără singură coada); restul
    // evenimentelor se trimit și celorlalte file, ca o captură din bara de
    // pe desktop să apară în fereastra principală fără reîncărcare.
    if (e.type !== 'status') opts.channel?.post(e)
  }
  opts.channel?.onMessage((e) => {
    emitLocal(e)
    void refreshPending()
  })

  const setStatus = (next: Partial<SyncStatus>) => {
    const s = { ...status, ...next }
    if (s.offline === status.offline && s.pending === status.pending) return
    status = s
    emit({ type: 'status', status })
  }
  async function refreshPending() {
    const kv = await kvReady
    setStatus({ pending: kv ? (await kv.ops()).length : 0 })
  }

  async function pendingOps(): Promise<OutboxOp[]> {
    const kv = await kvReady
    return kv ? (await kv.ops()).map((q) => q.op) : []
  }

  /** Server întâi; la eșec de rețea, cache-ul. O eroare de server NU cade pe cache. */
  async function read<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    const kv = await kvReady
    try {
      const v = await withTimeout(fetch(), readTimeoutMs)
      setStatus({ offline: false })
      // Cache-ul e bonus: o scriere care pică (cotă plină, bază închisă) nu
      // trebuie să arunce un răspuns de server deja primit.
      await kv?.set(key, v).catch(() => {})
      return v
    } catch (e) {
      if (!isNetworkError(e)) throw e
      setStatus({ offline: true })
      const cached = kv ? await kv.get<T>(key) : undefined
      if (cached === undefined) throw new OfflineError()
      return cached
    }
  }

  /** Pentru ce NU merge offline: eroarea de rețea devine `OfflineError`. */
  async function net<T>(f: () => Promise<T>): Promise<T> {
    try {
      const v = await f()
      setStatus({ offline: false })
      return v
    } catch (e) {
      if (!isNetworkError(e)) throw e
      setStatus({ offline: true })
      throw new OfflineError()
    }
  }

  async function allCachedIssues(kv: Kv): Promise<Issue[]> {
    const out: Issue[] = []
    const full = new Set<string>()
    for (const key of await kv.keys('p:')) {
      if (!key.endsWith(':issues')) continue
      full.add(key.slice(2, -':issues'.length))
      out.push(...((await kv.get<Issue[]>(key)) ?? []))
    }
    // Lista completă a unui proiect e autoritară pentru el: un tichet șters pe
    // server dispare din ea, dar `due` nu se curăță niciodată și l-ar readuce
    // ca fantomă. `due` contează doar pentru proiectele fără listă completă.
    for (const i of (await kv.get<Issue[]>(K.due)) ?? []) {
      if (!full.has(i.projectId)) out.push(i)
    }
    return out
  }

  const cache: CacheReader = {
    async projects() { const kv = await kvReady; return (kv && ((await kv.get(K.projects)) as Project[] | undefined)) ?? null },
    async assignees() { const kv = await kvReady; return (kv && ((await kv.get(K.assignees)) as Assignee[] | undefined)) ?? null },
    async inbox() { const kv = await kvReady; return (kv && ((await kv.get(K.inbox)) as InboxRow[] | undefined)) ?? null },
    async project(pid) {
      const kv = await kvReady
      if (!kv) return null
      const issues = await kv.get<Issue[]>(K.p(pid, 'issues'))
      if (!issues) return null
      return {
        waves: ((await kv.get(K.p(pid, 'waves'))) ?? []) as ProjectBundle['waves'],
        themes: ((await kv.get(K.p(pid, 'themes'))) ?? []) as ProjectBundle['themes'],
        issues: overlay(issues, await pendingOps(), now()).filter((i) => i.projectId === pid),
        obstacles: ((await kv.get(K.p(pid, 'obstacles'))) ?? []) as ProjectBundle['obstacles'],
        obstacleLinks: ((await kv.get(K.p(pid, 'obstacleLinks'))) ?? []) as ProjectBundle['obstacleLinks'],
        members: ((await kv.get(K.p(pid, 'members'))) ?? []) as ProjectBundle['members'],
      }
    },
    async due(range) {
      const kv = await kvReady
      if (!kv) return null
      const all = await allCachedIssues(kv)
      if (!all.length && (await kv.get(K.due)) === undefined) return null
      return deriveDue(overlay(all, await pendingOps(), now()), range)
    },
  }

  async function prefetchAll() {
    let projects: Project[]
    try {
      projects = await read(K.projects, () => remote.listProjects())
    } catch {
      // Best-effort: un prefetch eșuat lasă cache-ul cum era. Nu e o eroare de
      // arătat — omul n-a cerut nimic.
      return
    }
    for (const p of projects) {
      // Fiecare proiect pe cont propriu: o eroare de server la unul (permisiuni)
      // nu trebuie să lase necache-uite toate cele de după el.
      try {
        await Promise.all([
          read(K.p(p.id, 'waves'), () => remote.listWaves(p.id)),
          read(K.p(p.id, 'themes'), () => remote.listThemes(p.id)),
          read(K.p(p.id, 'issues'), () => remote.listIssues(p.id)),
          read(K.p(p.id, 'obstacles'), () => remote.listObstacles(p.id)),
          read(K.p(p.id, 'obstacleLinks'), () => remote.listObstacleLinks(p.id)),
          read(K.p(p.id, 'members'), () => remote.listProjectMembers(p.id)).catch(() => []),
        ])
      } catch {
        // Același motiv ca mai sus: se trece la următorul proiect.
      }
    }
  }

  const sync: SyncControl = {
    status: () => status,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    flush: async () => {},
    prefetchAll,
    async clear() { const kv = await kvReady; await kv?.clear(); setStatus({ pending: 0 }) },
  }

  const repo: Repository = {
    cache,
    sync,

    listProjects: () => read(K.projects, () => remote.listProjects()),
    listAssignees: () => read(K.assignees, () => remote.listAssignees()),
    listWaves: (pid) => read(K.p(pid, 'waves'), () => remote.listWaves(pid)),
    listThemes: (pid) => read(K.p(pid, 'themes'), () => remote.listThemes(pid)),
    listObstacles: (pid) => read(K.p(pid, 'obstacles'), () => remote.listObstacles(pid)),
    listObstacleLinks: (pid) => read(K.p(pid, 'obstacleLinks'), () => remote.listObstacleLinks(pid)),
    listProjectMembers: (pid) => read(K.p(pid, 'members'), () => remote.listProjectMembers(pid)),
    listInbox: () => read(K.inbox, () => remote.listInbox()),
    async listIssues(pid) {
      const base = await read(K.p(pid, 'issues'), () => remote.listIssues(pid))
      return overlay(base, await pendingOps(), now()).filter((i) => i.projectId === pid)
    },
    async listDueIssues(range) {
      try {
        const base = await withTimeout(remote.listDueIssues(range), readTimeoutMs)
        setStatus({ offline: false })
        const kv = await kvReady
        await kv?.set(K.due, base).catch(() => {}) // best-effort, ca în `read`
        return deriveDue(overlay(base, await pendingOps(), now()), range)
      } catch (e) {
        if (!isNetworkError(e)) throw e
        setStatus({ offline: true })
        const local = await cache.due(range)
        if (local === null) throw new OfflineError()
        return local
      }
    },

    // ── Cer rețea ────────────────────────────────────────────────────────────
    createProject: (input) => net(() => remote.createProject(input)),
    updateProject: (id, patch) => net(() => remote.updateProject(id, patch)),
    deleteProject: (id) => net(() => remote.deleteProject(id)),
    createWave: (pid, name, label) => net(() => remote.createWave(pid, name, label)),
    updateWave: (pid, num, patch) => net(() => remote.updateWave(pid, num, patch)),
    deleteWave: (pid, num) => net(() => remote.deleteWave(pid, num)),
    createTheme: (pid, name, color) => net(() => remote.createTheme(pid, name, color)),
    updateTheme: (pid, key, patch) => net(() => remote.updateTheme(pid, key, patch)),
    deleteTheme: (pid, key) => net(() => remote.deleteTheme(pid, key)),
    createObstacle: (input) => net(() => remote.createObstacle(input)),
    updateObstacle: (id, patch) => net(() => remote.updateObstacle(id, patch)),
    deleteObstacle: (id) => net(() => remote.deleteObstacle(id)),
    setObstacleIssues: (oid, ids) => net(() => remote.setObstacleIssues(oid, ids)),
    setIssueObstacles: (iid, ids) => net(() => remote.setIssueObstacles(iid, ids)),
    createAssignee: (name) => net(() => remote.createAssignee(name)),
    ensureAssigneeForMember: (pid, uid) => net(() => remote.ensureAssigneeForMember(pid, uid)),
    listEvents: (iid) => net(() => remote.listEvents(iid)),
    postToThread: (input) => net(() => remote.postToThread(input)),

    // ── Merg offline — înlocuite în Task 7 ───────────────────────────────────
    createIssue: (input) => net(() => remote.createIssue(input)),
    updateIssue: (id, patch) => net(() => remote.updateIssue(id, patch)),
    deleteIssue: (id) => net(() => remote.deleteIssue(id)),
    deleteIssues: (ids) => net(() => remote.deleteIssues(ids)),
    markSeen: (iid) => net(() => remote.markSeen(iid)),
  }

  void refreshPending()
  return repo
}
