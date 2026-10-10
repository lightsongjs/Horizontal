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
import type { Pin } from '../../lib/pins'
import type { Kv } from './kv'
import { errorMessage } from '../../lib/errorMessage'
import { OfflineError, isAuthError, isNetworkError, withTimeout } from './netError'
import { applyIssuePatch } from '../../lib/issuePatch'
import { isTempIssueId, makeTempIssueId } from '../../lib/issueId'
import { cancelTempIssues, deriveDue, echoIssue, opIssueIds, overlay, remapOp, type OutboxOp, type QueuedOp } from './ops'
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
  /**
   * Golirea pornește doar când e cine s-o semneze. Fără sesiune, supabase-js
   * trimite cu cheia anonimă: RLS respinge totul, iar golirea ar fi luat
   * fiecare respingere drept refuz și ar fi aruncat coada întreagă.
   */
  canFlush?: () => boolean
  /** Cât așteaptă o captură răspunsul serverului înainte să întoarcă ecoul provizoriu. */
  createWaitMs?: number
  /** Pașii reîncercării cât coada are elemente; ultimul se repetă. */
  retryDelaysMs?: number[]
}

type CreateOutcome = { issue: Issue } | { error: unknown }

const K = {
  projects: 'projects',
  assignees: 'assignees',
  inbox: 'inbox',
  due: 'due',
  /** Tichetele nebifate din toate proiectele (`listOpenIssues`) — sertarul și filtrele. */
  open: 'open',
  pins: 'pins',
  remaps: 'remaps',
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

/** Ca `localLock`, dar întoarce valoarea — pentru secțiuni scurte care citesc și scriu coada. */
function mutex() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }
}

export function createOfflineRepository(remote: Repository, kvReady: Promise<Kv | null>, opts: OfflineOptions = {}): Repository {
  const now = opts.now ?? (() => new Date())
  const readTimeoutMs = opts.readTimeoutMs ?? 10_000
  const createWaitMs = opts.createWaitMs ?? 3000
  const lock = opts.lock ?? localLock()
  // Lacăt scurt pentru MODIFICAREA cozii (adăugare, anulare, remapare), separat
  // de `lock`-ul golirii: acela se ține cât durează o rundă către server, iar
  // ecoul local al unei scrieri nu are voie să aștepte după ea. Fără el, golirea
  // lucra pe o poză a cozii luată înainte de apelul de rețea: o editare a
  // tichetului provizoriu adăugată între timp rămânea cu ID-ul provizoriu
  // (refuzată, editare pierdută), iar o ștergere care anulase scrierile le
  // vedea readuse de poza veche.
  const queueLock = mutex()
  const listeners = new Set<(e: SyncEvent) => void>()
  /** Capturile care încă își așteaptă răspunsul (după ID-ul provizoriu) — vezi `createIssue`. */
  const createWaiters = new Map<string, (r: CreateOutcome) => void>()
  let status: SyncStatus = { offline: false, pending: 0, syncing: false }

  const emitLocal = (e: SyncEvent) => { for (const fn of listeners) fn(e) }
  const emit = (e: SyncEvent) => {
    emitLocal(e)
    // Statusul e al fiecărei file (fiecare își numără singură coada); restul
    // evenimentelor se trimit și celorlalte file, ca o captură din bara de
    // pe desktop să apară în fereastra principală fără reîncărcare.
    if (e.type !== 'status') opts.channel?.post(e)
  }
  opts.channel?.onMessage((e) => {
    if (e.type === 'remap') void recordRemap(e.from, e.to)
    emitLocal(e)
    void refreshPending()
  })

  /**
   * ID provizoriu → ID real, pentru tot ce s-a remapat vreodată pe dispozitivul
   * ăsta. Un formular deschis ține ID-urile capturate la montare, iar cheia lui
   * rămâne stabilă peste remapare (ca să nu piardă ce e nesalvat) — deci
   * salvarea lui poate purta încă `HZ-~…`, după ce coada l-a trimis deja. Fără
   * traducere, serverul n-ar găsi tichetul. Ținută în bază (`remaps`), ca o
   * repornire sau altă filă să traducă la fel; scrierea e best-effort — o bază
   * care pică lasă traducerea doar în memorie, nu strică scrierea.
   */
  const remaps = new Map<string, string>()
  let remapsLoaded: Promise<void> | null = null
  function loadRemaps(): Promise<void> {
    remapsLoaded ??= (async () => {
      const kv = await kvReady
      const saved = kv ? await kv.get<Record<string, string>>(K.remaps).catch(() => undefined) : undefined
      for (const [from, to] of Object.entries(saved ?? {})) if (!remaps.has(from)) remaps.set(from, to)
    })()
    return remapsLoaded
  }
  async function recordRemap(from: string, to: string) {
    // În memorie ÎNTÂI, sincron: `resolveId` trebuie să știe imediat.
    remaps.set(from, to)
    await persistRemaps()
  }
  async function persistRemaps() {
    // Încărcarea nu suprascrie chei existente; o așteptăm doar ca scrierea de
    // mai jos să nu calce peste ce era salvat.
    await loadRemaps()
    const kv = await kvReady
    await kv?.set(K.remaps, Object.fromEntries(remaps)).catch(() => {})
  }
  const resolveId = (id: string) => remaps.get(id) ?? id
  const resolveDeps = <T extends { deps?: string[] }>(x: T): T => (x.deps ? { ...x, deps: x.deps.map(resolveId) } : x)

  /**
   * Câte scrieri a încheiat golirea. O citire care a plecat înainte ca o
   * scriere să intre pe server, dar se întoarce după ce golirea a scos-o din
   * coadă, ar pune în bază lista VECHE — fără niciun element rămas care s-o
   * rejoace deasupra: modificarea abia sincronizată ar dispărea până la
   * următorul refresh. Citirea compară generația de la plecare cu cea de la
   * sosire și, dacă s-a mișcat, nu scrie baza (pe care `settle` a pus-o deja
   * la zi) și răspunde din ea.
   */
  let generation = 0
  /**
   * PORNIREA ultimei citiri de REȚEA reușite a scadențelor (0 = niciuna).
   * Cutia de Android compară lista paginii cu a ei după vârsta datelor, nu
   * după ora trimiterii: o listă venită din cache (primul cadru, sau o citire
   * căzută pe cache) poate fi mai veche decât ce a citit cutia singură, iar
   * cu `readAt = acum` ar fi bătut-o — un memento mutat pe laptop ar fi sunat
   * la ora veche. Pornirea, nu sosirea: o scriere intrată pe server în timpul
   * cererii poate lipsi din răspuns.
   */
  let dueFetchedAt = 0

  const setStatus = (next: Partial<SyncStatus>) => {
    const s = { ...status, ...next }
    if (s.offline === status.offline && s.pending === status.pending && s.syncing === status.syncing) return
    const back = status.offline && !s.offline
    status = s
    emit({ type: 'status', status })
    // Rețeaua s-a dovedit prezentă (a răspuns o citire sau o scriere): coada
    // rămasă de la o sincopă pleacă acum, nu abia la următoarea scriere.
    if (back) void flush()
  }
  async function refreshPending() {
    const kv = await kvReady
    setStatus({ pending: kv ? (await kv.ops()).length : 0 })
    scheduleRetry()
  }

  /**
   * Plasa pentru o coadă care a rămas cu elemente și nimic n-o mai împinge: pe
   * semnal slab `navigator.onLine` nu se schimbă, deci nici `online` nu vine,
   * iar o sincopă nu e urmată neapărat de o citire. Reîncercăm în pași tot mai
   * rari; coada goală oprește ceasul. Nu și cu `navigator.onLine === false`:
   * acolo `online` anunță singur revenirea, iar fiecare încercare ar pica sigur.
   * Încercarea pornește și cu „offline" aprins: tocmai el e starea în care
   * a rămas coada după sincopă.
   */
  const retryDelays = opts.retryDelaysMs ?? [5_000, 15_000, 60_000]
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryStep = 0
  function scheduleRetry() {
    if (status.pending === 0) {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      retryStep = 0
      return
    }
    if (retryTimer || !retryDelays.length) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const delay = retryDelays[Math.min(retryStep++, retryDelays.length - 1)]
    retryTimer = setTimeout(() => { retryTimer = null; void flush() }, delay)
    // În Node (teste) un ceas rămas n-are voie să țină procesul în viață.
    ;(retryTimer as { unref?: () => void }).unref?.()
  }

  async function pendingOps(): Promise<OutboxOp[]> {
    const kv = await kvReady
    return kv ? (await kv.ops()).map((q) => q.op) : []
  }

  /**
   * Server întâi; la eșec de rețea, cache-ul. O eroare de server NU cade pe cache.
   * `racesFlush`: cheia e o listă de tichete, pe care golirea o scrie și ea
   * (vezi `generation`).
   */
  async function read<T>(key: string, fetch: () => Promise<T>, racesFlush = false): Promise<T> {
    const kv = await kvReady
    const gen = generation
    try {
      const v = await withTimeout(fetch(), readTimeoutMs)
      setStatus({ offline: false })
      if (racesFlush && gen !== generation) {
        const fresher = kv ? await kv.get<T>(key).catch(() => undefined) : undefined
        if (fresher !== undefined) return fresher
        return v
      }
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
    // La fel `open`, cu `due` câștigător la dublură (cele două liste se
    // suprapun pe tichetele nebifate cu scadență).
    const partial = new Set<string>()
    for (const i of (await kv.get<Issue[]>(K.due)) ?? []) {
      if (!full.has(i.projectId)) { out.push(i); partial.add(i.id) }
    }
    for (const i of (await kv.get<Issue[]>(K.open)) ?? []) {
      if (!full.has(i.projectId) && !partial.has(i.id)) out.push(i)
    }
    // Iar lista de proiecte e autoritară peste toate: un proiect pe care
    // serverul nu-l mai întoarce (șters, acces pierdut) nu are voie să-și
    // arate tichetele offline. Fără listă încă, nu se filtrează nimic.
    const known = await kv.get<Project[]>(K.projects)
    if (!known) return out
    const ids = new Set(known.map((p) => p.id))
    return out.filter((i) => ids.has(i.projectId))
  }

  /** Lista de proiecte; cea venită de la server șterge de pe disc proiectele dispărute. */
  async function readProjects(): Promise<Project[]> {
    let fresh: Project[] | null = null
    const projects = await read(K.projects, async () => (fresh = await remote.listProjects()))
    const kv = await kvReady
    if (fresh && kv) {
      const ids = new Set((fresh as Project[]).map((p) => p.id))
      const stale = (await kv.keys('p:').catch(() => [] as string[])).filter((k) => !ids.has(k.slice(2, k.lastIndexOf(':'))))
      if (stale.length) await kv.remove(stale).catch(() => {}) // igienă: citirile filtrează oricum
    }
    return projects
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
    async open() {
      const kv = await kvReady
      if (!kv) return null
      if ((await kv.get(K.open)) === undefined && !(await kv.keys('p:')).some((k) => k.endsWith(':issues'))) return null
      return overlay(await allCachedIssues(kv), await pendingOps(), now()).filter((i) => !i.done)
    },
    async pins() { const kv = await kvReady; return (kv && ((await kv.get(K.pins)) as Pin[] | undefined)) ?? null },
  }

  async function prefetchAll() {
    let projects: Project[]
    try {
      projects = await readProjects()
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
          read(K.p(p.id, 'issues'), () => remote.listIssues(p.id), true),
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
    const open = await kv.get<Issue[]>(K.open) // idem
    if (open) writes.push([K.open, issue.done ? open.filter((i) => i.id !== issue.id) : [...open.filter((i) => i.id !== issue.id), issue]])
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
    const open = await kv.get<Issue[]>(K.open)
    if (open) writes.push([K.open, strip(open)])
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
        r = await queueLock(() => enqueue(kv))
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
    const r = await queueLock(() => enqueue(kv))
    await refreshPending()
    if (!status.offline) void flush() // coada nevidă cu rețea prezentă se golește singură
    return r
  }

  interface Settled { ok: boolean; /** crearea a fost anulată cât era în zbor */ cancelled: boolean; rest: QueuedOp[] }

  /**
   * Elementul trimis și acceptat de server iese din coadă — ACUM, orice ar face
   * baza locală. Un element rămas în coadă după un răspuns reușit se retrimite
   * la următoarea golire: un `createIssue` retrimis e un tichet duplicat. De
   * aceea, dacă `completeOp` (scrierea bazei + scoaterea) pică, încercăm măcar
   * scoaterea simplă; cache-ul stricat se vindecă la următorul refresh, un
   * duplicat nu. `ok` e false doar dacă elementul n-a putut fi scos deloc.
   *
   * Coada se RECITEȘTE aici, sub `queueLock`: cât a durat apelul către server,
   * omul a putut edita sau șterge tichetul provizoriu. Pentru o creare:
   * scrierile rămase se remapează pe ID-ul real; iar dacă elementul însuși a
   * dispărut din coadă (ștergere în zbor), tichetul s-a creat totuși pe server,
   * deci punem la coadă ștergerea lui reală — ștergerea omului câștigă.
   */
  async function settle(kv: Kv, q: QueuedOp, rest: QueuedOp[], writes: () => Promise<[string, unknown][]>, remap?: { from: string; to: string }): Promise<Settled> {
    return queueLock(async () => {
      const done = await settleLocked(kv, q, rest, writes, remap)
      // Remaparea se ține minte ÎNAINTE ca lacătul să se elibereze: o salvare
      // care aștepta lacătul (formular deschis pe `HZ-~…`) trebuie să găsească
      // traducerea gata. Ținută după eliberare, salvarea vedea coada goală și
      // ID-ul încă netradus — pleca direct cu cel provizoriu și se pierdea.
      if (remap && !done.cancelled) await persistRemaps()
      return done
    })
  }

  async function settleLocked(kv: Kv, q: QueuedOp, rest: QueuedOp[], writes: () => Promise<[string, unknown][]>, remap?: { from: string; to: string }): Promise<Settled> {
    try {
      const all = await kv.ops()
      const cancelled = !!remap && !all.some((o) => o.seq === q.seq)
      // Sincron, înainte de orice scriere: din clipa în care elementul iese
      // din coadă, cine o vede goală trebuie să știe deja ID-ul real.
      if (remap && !cancelled) remaps.set(remap.from, remap.to)
      let others = all.filter((o) => o.seq !== q.seq)
      if (remap) {
        others = others.map((o) => ({ ...o, op: remapOp(o.op, remap.from, remap.to) }))
        if (others.length) await kv.replaceOps(others, [])
      }
      await kv.completeOp(q.seq, cancelled ? [] : await writes())
      generation++ // baza are acum răspunsul serverului — citirile în zbor sunt depășite
      if (cancelled && remap) await kv.append({ kind: 'deleteIssues', ids: [remap.to] })
      return { ok: true, cancelled, rest: others }
    } catch {
      // Serverul a creat tichetul oricum: traducerea e adevărată și aici.
      if (remap) remaps.set(remap.from, remap.to)
      const ok = await kv.replaceOps([], [q.seq]).then(() => true, () => false)
      return { ok, cancelled: false, rest }
    }
  }

  /**
   * Trimite UN element. Doar eroarea apelului `remote.*` iese mai departe —
   * decizia rețea/server e în `flush`. Tot ce vine după un răspuns reușit e
   * local și nu poate fi tratat ca refuz al serverului. Întoarce dacă
   * elementul a ieșit din coadă.
   */
  async function runOp(kv: Kv, q: QueuedOp, rest: QueuedOp[]): Promise<boolean> {
    const op = q.op
    if (op.kind === 'createIssue') {
      const created = await remote.createIssue(op.input)
      const done = await settle(kv, q, rest, () => baseWritesUpsert(kv, created), { from: op.tempId, to: created.id })
      if (!done.cancelled) {
        emit({ type: 'remap', from: op.tempId, to: created.id })
        const shown = overlay([created], done.rest.map((r) => r.op), now())[0] ?? created
        emit({ type: 'issue', issue: shown })
        createWaiters.get(op.tempId)?.({ issue: shown })
      }
      return done.ok
    }
    if (op.kind === 'updateIssue') {
      const saved = await remote.updateIssue(op.id, op.patch)
      const done = await settle(kv, q, rest, () => baseWritesUpsert(kv, saved))
      // Varianta serverului, cu scrierile încă netrimise rejucate peste ea —
      // altfel ecranul ar „anula" pentru o clipă o modificare care urmează.
      const shown = overlay([saved], done.rest.map((r) => r.op), now())[0]
      if (shown) emit({ type: 'issue', issue: shown })
      return done.ok
    }
    if (op.kind === 'deleteIssues') {
      await remote.deleteIssues(op.ids)
      return (await settle(kv, q, rest, () => baseWritesRemove(kv, op.ids))).ok
    }
    await remote.markSeen(op.issueId)
    return (await settle(kv, q, rest, async () => [])).ok
  }

  async function flush() {
    if (opts.canFlush && !opts.canFlush()) return
    const kv = await kvReady
    if (!kv) return
    // Golirea e best-effort: ea e pornită cu `void` (la creare, la `online`, după
    // fiecare scriere), deci o eroare locală scăpată de aici ar fi o respingere
    // neprinsă. Ce rămâne în coadă se reia la următoarea golire.
    await lock(async () => {
      try {
        await drain(kv)
      } finally {
        // Numărul întâi, apoi stingerea: altfel indicatorul ar trece o clipă
        // prin „N în așteptare" cu numărul de dinainte de golire.
        await refreshPending().catch(() => {})
        setStatus({ syncing: false })
      }
    }).catch(() => {})
  }

  async function drain(kv: Kv) {
    for (;;) {
      const all = await kv.ops()
      if (!all.length) break
      // Aprins abia când chiar e ceva de trimis: o golire care găsește coada
      // goală (după fiecare captură) n-are de ce să miște indicatorul.
      setStatus({ syncing: true })
      const [q, ...rest] = all
      try {
        const removed = await runOp(kv, q, rest)
        setStatus({ offline: false })
        if (!removed) break // n-are rost să-l retrimitem în buclă
      } catch (e) {
        if (isNetworkError(e)) { setStatus({ offline: true }); break }
        // Sesiune lipsă sau expirată: nu e refuz (elementul rămâne) și nici
        // rețea: serverul a răspuns, deci „offline" se stinge. Se reia când
        // revine sesiunea.
        if (isAuthError(e, q.op.kind)) { setStatus({ offline: false }); break }
        // Refuz de server: nu blocăm coada la infinit. Elementul se scoate,
        // iar cine afișează tichetul primește valoarea serverului (sau află
        // că nu mai există). O creare refuzată își ia după ea și scrierile
        // care-i foloseau ID-ul provizoriu — n-ar avea ce să trimită.
        let title: string | null = null
        const removedOk = await queueLock(async () => {
          if (q.op.kind === 'createIssue') {
            const queued = await kv.ops()
            const tempId = q.op.tempId
            // Titlul de ACUM (cu redenumirile din coadă), citit înainte de
            // anulare: după ea sarcina dispare din ecran, iar mesajul e
            // singurul loc care mai spune ce s-a pierdut.
            title = overlay([], queued.map((o) => o.op), now()).find((i) => i.id === tempId)?.title ?? q.op.input.title
            const { remove, rewrite } = cancelTempIssues(queued, [tempId])
            await kv.replaceOps(rewrite, remove)
          } else {
            await kv.replaceOps([], [q.seq])
          }
        }).then(() => true, () => false)
        if (!removedOk) break // coada nu poate fi modificată: nu anunțăm un eșec care se va repeta
        const [issueId] = opIssueIds(q.op)
        let revert: Issue | null = null
        if (q.op.kind === 'updateIssue') revert = await currentIssue(kv, q.op.id).catch(() => null)
        // O captură care încă își așteaptă răspunsul primește refuzul direct,
        // ca o scriere directă de altădată: omul vede eroarea unde a scris,
        // iar un `failed` în plus ar dubla mesajul.
        const waiter = q.op.kind === 'createIssue' ? createWaiters.get(q.op.tempId) : undefined
        const message = title === null ? errorMessage(e) : `Sarcina „${title}” n-a putut fi salvată: ${errorMessage(e)}`
        if (waiter) waiter({ error: e })
        else emit({ type: 'failed', message, issueId: issueId ?? null, revert })
        if (q.op.kind === 'createIssue') emit({ type: 'removed', ids: [q.op.tempId] })
      }
    }
  }

  /**
   * Drumul de dinainte de captura-în-coadă: direct la server cu coada goală,
   * la coadă altfel. Rămâne pentru când captura nu se poate pune întâi pe disc
   * — proiect necache-uit încă (prima pornire), sau o bază care refuză scrierea.
   */
  function createDirect(raw: Parameters<Repository['createIssue']>[0]): Promise<Issue> {
    return write(
      () => remote.createIssue(resolveDeps(raw)),
      async (kv, created) => { emit({ type: 'issue', issue: created }); await applyWrites(kv, await baseWritesUpsert(kv, created)) },
      async (kv) => {
        const input = resolveDeps(raw)
        const projects = (await kv.get<Project[]>(K.projects)) ?? []
        const project = projects.find((p) => p.id === input.projectId)
        if (!project) throw new OfflineError()
        const tempId = makeTempIssueId(project.prefix)
        const echo = echoIssue(input, tempId, project, opts.userId?.() ?? null, now())
        await kv.append({ kind: 'createIssue', tempId, input, echo })
        emit({ type: 'issue', issue: echo })
        return echo
      },
    )
  }

  const sync: SyncControl = {
    status: () => status,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    flush,
    prefetchAll,
    resolveId,
    async heldIds() { return [...new Set((await pendingOps()).flatMap(opIssueIds))] },
    async clear() { const kv = await kvReady; await kv?.clear(); remaps.clear(); dueFetchedAt = 0; setStatus({ pending: 0 }); scheduleRetry() },
    dueFetchedAt: () => dueFetchedAt,
  }

  const repo: Repository = {
    cache,
    sync,

    listProjects: () => readProjects(),
    listAssignees: () => read(K.assignees, () => remote.listAssignees()),
    listWaves: (pid) => read(K.p(pid, 'waves'), () => remote.listWaves(pid)),
    listThemes: (pid) => read(K.p(pid, 'themes'), () => remote.listThemes(pid)),
    listObstacles: (pid) => read(K.p(pid, 'obstacles'), () => remote.listObstacles(pid)),
    listObstacleLinks: (pid) => read(K.p(pid, 'obstacleLinks'), () => remote.listObstacleLinks(pid)),
    listProjectMembers: (pid) => read(K.p(pid, 'members'), () => remote.listProjectMembers(pid)),
    listInbox: () => read(K.inbox, () => remote.listInbox()),
    listPins: () => read(K.pins, () => remote.listPins()),
    async listOpenIssues() {
      // Ca `listDueIssues`: serverul întâi, iar o golire care a apucat să
      // scrie între timp în bază face răspunsul vechi — atunci baza câștigă.
      const gen = generation
      try {
        const base = await withTimeout(remote.listOpenIssues(), readTimeoutMs)
        setStatus({ offline: false })
        if (gen !== generation) {
          const local = await cache.open().catch(() => null)
          if (local !== null) return local
        }
        const kv = await kvReady
        await kv?.set(K.open, base).catch(() => {})
        return overlay(base, await pendingOps(), now()).filter((i) => !i.done)
      } catch (e) {
        if (!isNetworkError(e)) throw e
        setStatus({ offline: true })
        const local = await cache.open()
        if (local === null) throw new OfflineError()
        return local
      }
    },
    async listIssues(pid) {
      const base = await read(K.p(pid, 'issues'), () => remote.listIssues(pid), true)
      return overlay(base, await pendingOps(), now()).filter((i) => i.projectId === pid)
    },
    async listDueIssues(range) {
      const gen = generation
      const startedAt = now().getTime()
      try {
        const base = await withTimeout(remote.listDueIssues(range), readTimeoutMs)
        setStatus({ offline: false })
        // Și când răspunde mai jos baza pusă la zi de golire: ea e cel puțin
        // la fel de proaspătă ca răspunsul.
        dueFetchedAt = Math.max(dueFetchedAt, startedAt)
        if (gen !== generation) {
          // Ca în `read`: răspunsul e mai vechi decât baza pusă la zi de golire.
          const local = await cache.due(range).catch(() => null)
          if (local !== null) return local
        }
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
    // Fixările: rețea pentru scriere (ca proiectele), iar baza se ține la zi
    // doar ca primul cadru de după să le arate — nu e o coadă.
    async addPin(kind, ref) {
      const pin = await net(() => remote.addPin(kind, ref))
      const kv = await kvReady
      const cur = (await kv?.get<Pin[]>(K.pins).catch(() => undefined)) ?? null
      if (kv && cur) await kv.set(K.pins, [...cur.filter((p) => !(p.kind === kind && p.ref === ref)), pin]).catch(() => {})
      return pin
    },
    async removePin(kind, ref) {
      await net(() => remote.removePin(kind, ref))
      const kv = await kvReady
      const cur = (await kv?.get<Pin[]>(K.pins).catch(() => undefined)) ?? null
      if (kv && cur) await kv.set(K.pins, cur.filter((p) => !(p.kind === kind && p.ref === ref))).catch(() => {})
    },

    // ── Merg offline ─────────────────────────────────────────────────────────
    /**
     * Captura intră ÎNTÂI în coadă, apoi pornește golirea și așteaptă puțin
     * (`createWaitMs`) numărul real. Pe semnal slab `navigator.onLine` rămâne
     * true, iar un fetch direct putea atârna minute întregi: adăugarea rapidă
     * stătea în „se salvează…", iar o aplicație închisă între timp pierdea
     * sarcina. Așa sarcina e pe disc înainte de orice rundă către server; după
     * prag primești ecoul provizoriu, iar golirea continuă în fundal și
     * remaparea îl redenumește când sosește.
     *
     * Pragul NU taie cererea: ea poate încă ajunge la server, iar o a doua
     * trimitere ar dubla tichetul. Doar încetăm s-o așteptăm.
     */
    async createIssue(raw) {
      await loadRemaps()
      const kv = await kvReady
      const projects = kv ? ((await kv.get<Project[]>(K.projects).catch(() => undefined)) ?? []) : []
      const project = projects.find((p) => p.id === raw.projectId)
      if (!kv || !project) return createDirect(raw)
      let queued: { tempId: string; echo: Issue }
      try {
        queued = await queueLock(async () => {
          const input = resolveDeps(raw) // sub lacăt, ca la `updateIssue`
          const tempId = makeTempIssueId(project.prefix)
          const echo = echoIssue(input, tempId, project, opts.userId?.() ?? null, now())
          await kv.append({ kind: 'createIssue', tempId, input, echo })
          return { tempId, echo }
        })
      } catch {
        // Baza locală nu primește scrierea: rămâne drumul de dinainte, direct.
        return createDirect(raw)
      }
      const { tempId, echo } = queued
      let answer!: (r: CreateOutcome) => void
      const outcome = new Promise<CreateOutcome>((res) => { answer = res })
      createWaiters.set(tempId, answer)
      let timer: ReturnType<typeof setTimeout> | undefined
      const bound = new Promise<null>((res) => { timer = setTimeout(() => res(null), createWaitMs) })
      // Golirea se poate încheia fără răspuns pentru noi (rețea căzută, fără
      // sesiune): atunci n-are rost să așteptăm până la prag.
      const r = await Promise.race([outcome, flush().then(() => null), bound])
      clearTimeout(timer)
      createWaiters.delete(tempId)
      if (r && 'error' in r) throw r.error
      if (r) return r.issue
      // Altă filă poate să fi golit coada pentru noi (Web Locks): remaparea a
      // venit pe canal, iar ecoul provizoriu ar fi deja un nume vechi.
      const real = remaps.get(tempId)
      if (real) return (await currentIssue(kv, real).catch(() => null)) ?? { ...echo, id: real }
      await refreshPending()
      emit({ type: 'issue', issue: echo })
      return echo
    },

    async updateIssue(rawId, rawPatch) {
      await loadRemaps()
      // Traducerea se face în ultima clipă, în fiecare ramură, nu o dată la
      // intrare: o creare în zbor își poate înregistra remaparea între intrare
      // și lacătul cozii, iar o traducere veche ar pune la coadă ID-ul provizoriu.
      const tr = () => ({ id: resolveId(rawId), patch: resolveDeps(rawPatch) })
      return write(
        () => { const { id, patch } = tr(); return remote.updateIssue(id, patch) },
        async (kv, saved) => { emit({ type: 'issue', issue: saved }); await applyWrites(kv, await baseWritesUpsert(kv, saved)) },
        async (kv) => {
          const { id, patch } = tr()
          const cur = await currentIssue(kv, id)
          if (!cur) throw new OfflineError()
          await kv.append({ kind: 'updateIssue', id, patch })
          const echo = applyIssuePatch(cur, patch, now())
          emit({ type: 'issue', issue: echo })
          return echo
        },
      )
    },

    deleteIssue: (id) => repo.deleteIssues([id]),

    async deleteIssues(rawIds) {
      // Tradus ÎNAINTE de împărțire: un provizoriu deja remapat e un tichet
      // real pe server — tratat ca anulare de creare, n-ar șterge nimic.
      await loadRemaps()
      const ids = rawIds.map(resolveId)
      const kv = await kvReady
      const temp = ids.filter(isTempIssueId)
      let real = ids.filter((id) => !isTempIssueId(id))
      if (kv && temp.length) {
        // Sub lacăt se traduce încă o dată: o creare în zbor poate să se fi
        // încheiat cât am așteptat lacătul. Aceea e acum un tichet real pe
        // server — anularea n-ar găsi nimic de scos, și tichetul ar rămâne.
        const stillTemp = await queueLock(async () => {
          const t = temp.filter((id) => isTempIssueId(resolveId(id)))
          const { remove, rewrite } = cancelTempIssues(await kv.ops(), t)
          await kv.replaceOps(rewrite, remove)
          return t
        })
        real = [...real, ...temp.filter((id) => !stillTemp.includes(id)).map(resolveId)]
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

    async markSeen(rawId) {
      await loadRemaps()
      if (isTempIssueId(resolveId(rawId))) return
      // Ca la `updateIssue`: tradus în fiecare ramură, sub lacăt la coadă.
      await write(() => remote.markSeen(resolveId(rawId)), async () => {}, async (kv) => {
        const iid = resolveId(rawId)
        if (!isTempIssueId(iid)) await kv.append({ kind: 'markSeen', issueId: iid })
      })
    },
  }

  void refreshPending()
  void loadRemaps() // ca `resolveId`, sincron, să știe și ce s-a remapat înainte de repornire
  // Golirea pornește singură: la deschidere (coada poate fi plină de ieri) și
  // la revenirea rețelei. Revenirea în tab o cere store-ul, prin `refresh`.
  void flush()
  if (typeof window !== 'undefined') window.addEventListener('online', () => void flush())
  return repo
}
