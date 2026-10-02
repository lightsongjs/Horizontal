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
import { applyIssuePatch } from '../../lib/issuePatch'
import { isTempIssueId, makeTempIssueId } from '../../lib/issueId'
import { cancelTempIssues, deriveDue, echoIssue, overlay, type OutboxOp } from './ops'
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

  /** Varianta de acum a unui tichet: baza din cache + coada rejucată. */
  async function currentIssue(kv: Kv, id: string): Promise<Issue | null> {
    const all = overlay(await allCachedIssues(kv), await pendingOps(), now())
    return all.find((i) => i.id === id) ?? null
  }

  /** Răspunsul serverului intră în bază: în lista proiectului și în `due`. */
  async function baseWritesUpsert(kv: Kv, issue: Issue): Promise<[string, unknown][]> {
    const writes: [string, unknown][] = []
    const key = K.p(issue.projectId, 'issues')
    const list = await kv.get<Issue[]>(key)
    if (list) writes.push([key, [...list.filter((i) => i.id !== issue.id), issue]])
    // `due` necache-uit înseamnă „nu știu" (cache.due întoarce null); o listă
    // parțială l-ar face să pară cunoscut și gol.
    const due = await kv.get<Issue[]>(K.due)
    if (due) writes.push([K.due, issue.dueAt ? [...due.filter((i) => i.id !== issue.id), issue] : due.filter((i) => i.id !== issue.id)])
    return writes
  }

  async function baseWritesRemove(kv: Kv, ids: string[]): Promise<[string, unknown][]> {
    const gone = new Set(ids)
    const strip = (xs: Issue[]) => xs.filter((i) => !gone.has(i.id)).map((i) => (i.deps.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
    const writes: [string, unknown][] = []
    for (const key of await kv.keys('p:')) {
      if (!key.endsWith(':issues')) continue
      writes.push([key, strip((await kv.get<Issue[]>(key)) ?? [])])
    }
    const due = await kv.get<Issue[]>(K.due) // ca mai sus: necache-uit rămâne necache-uit
    if (due) writes.push([K.due, strip(due)])
    return writes
  }

  async function applyWrites(kv: Kv, writes: [string, unknown][]) {
    for (const [k, v] of writes) await kv.set(k, v)
  }

  /**
   * Coada goală → direct la server (ID real, ca azi). Eroare de rețea sau coadă
   * nevidă → la coadă: o scriere care ar trece PE LÂNGĂ coadă ar ajunge la
   * server înaintea celor mai vechi și ar inversa ordinea cerută de om.
   * Eroarea de server se aruncă — nu e treaba cozii s-o ascundă.
   */
  async function write<T>(direct: () => Promise<T>, afterDirect: (kv: Kv, r: T) => Promise<void>, enqueue: (kv: Kv) => Promise<T>): Promise<T> {
    const kv = await kvReady
    if (!kv) return net(direct)
    if ((await kv.ops()).length === 0) {
      let r: T
      try {
        r = await direct()
      } catch (e) {
        if (!isNetworkError(e)) throw e
        setStatus({ offline: true })
        r = await enqueue(kv)
        await refreshPending()
        return r
      }
      setStatus({ offline: false })
      // Serverul a acceptat deja scrierea: o bază locală care pică (cotă plină,
      // bază închisă) nu o poate face eroare — omul ar reîncerca și ar crea un
      // duplicat, sau scrierea ar intra și la coadă și ar pleca a doua oară.
      await afterDirect(kv, r).catch(() => {})
      return r
    }
    const r = await enqueue(kv)
    await refreshPending()
    return r
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

    // ── Merg offline ─────────────────────────────────────────────────────────
    createIssue: (input) =>
      write(
        () => remote.createIssue(input),
        async (kv, created) => { emit({ type: 'issue', issue: created }); await applyWrites(kv, await baseWritesUpsert(kv, created)) },
        async (kv) => {
          const projects = (await kv.get<Project[]>(K.projects)) ?? []
          const project = projects.find((p) => p.id === input.projectId)
          if (!project) throw new OfflineError()
          const tempId = makeTempIssueId(project.prefix)
          const echo = echoIssue(input, tempId, project, opts.userId?.() ?? null, now())
          await kv.append({ kind: 'createIssue', tempId, input, echo })
          emit({ type: 'issue', issue: echo })
          return echo
        },
      ),

    updateIssue: (id, patch) =>
      write(
        () => remote.updateIssue(id, patch),
        async (kv, saved) => { emit({ type: 'issue', issue: saved }); await applyWrites(kv, await baseWritesUpsert(kv, saved)) },
        async (kv) => {
          const cur = await currentIssue(kv, id)
          if (!cur) throw new OfflineError()
          await kv.append({ kind: 'updateIssue', id, patch })
          const echo = applyIssuePatch(cur, patch, now())
          emit({ type: 'issue', issue: echo })
          return echo
        },
      ),

    deleteIssue: (id) => repo.deleteIssues([id]),

    async deleteIssues(ids) {
      const kv = await kvReady
      const temp = ids.filter(isTempIssueId)
      const real = ids.filter((id) => !isTempIssueId(id))
      if (kv && temp.length) {
        const { remove, rewrite } = cancelTempIssues(await kv.ops(), temp)
        await kv.replaceOps(rewrite, remove)
        await refreshPending()
        // Anunțat acum: dacă scrierea ID-urilor reale aruncă, cele provizorii
        // sunt deja scoase din coadă și interfața trebuie să afle.
        emit({ type: 'removed', ids: temp })
      }
      if (real.length) {
        await write(
          () => remote.deleteIssues(real),
          async (k) => { await applyWrites(k, await baseWritesRemove(k, real)) },
          async (k) => { await k.append({ kind: 'deleteIssues', ids: real }) },
        )
        emit({ type: 'removed', ids: real })
      }
    },

    markSeen: (iid) =>
      isTempIssueId(iid)
        ? Promise.resolve()
        : write(() => remote.markSeen(iid), async () => {}, async (kv) => { await kv.append({ kind: 'markSeen', issueId: iid }) }),
  }

  void refreshPending()
  return repo
}
