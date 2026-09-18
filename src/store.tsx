// App store: loads projects, and the selected project's waves + themes +
// issues through the repository. Exposes mutations with optimistic updates and
// memoized derived data (layers, states, completion).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { repository } from './data'
import { useAuth } from './auth'
import { applyOrder, loadOrder, saveOrder } from './lib/projectOrder'
import type { NewIssue, NewObstacle, NewProject } from './data/repository'
import {
  DependencyCycleError,
  computeLayers,
  deriveState,
  indexById,
  projectCompletion,
  unblocks,
} from './lib/engine'
import { buildSmartLists, smartListRange, type SmartLists } from './lib/schedule'
import { blockedBy, detectObstacleCycle } from './lib/obstacles'
import { groupInbox } from './lib/thread'
import type { Assignee, InboxRow, Issue, IssueState, Layers, Obstacle, ObstacleLink, Project, Theme, Wave } from './lib/types'
import { errorMessage } from './lib/errorMessage'
import { shouldRefreshOnVisible } from './lib/refreshGate'

interface HorizontalState {
  /**
   * Doar PORNIREA aplicației. `refresh()` nu îl mai ridică, iar asta e o
   * garanție, nu o optimizare: cât e true, `App` înlocuiește tot `<main>` cu
   * „Se încarcă…”, deci vizualizarea se demontează. O demontare la revenirea
   * în tab scotea `SplitView` din arbore, cleanup-ul lui `registerSplitHost`
   * ducea `dockedIssueId` la null, iar tichetul docat clipea ca modal peste
   * listă. Vezi `refreshing` pentru reîmprospătarea în fundal.
   */
  loading: boolean
  /** O reîmprospătare e în curs, dar datele vechi sunt pe ecran și rămân acolo. */
  refreshing: boolean
  error: string | null
  refresh(): Promise<void>
  projects: Project[]
  project: Project | null
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  /**
   * Id-ul proiectului pentru care listIssues() s-a încheiat. Issues se încarcă
   * lazy, per proiect, deci `issues.length === 0` nu poate distinge „încă nu
   * s-au încărcat” de „proiect fără tichete”; ăsta e semnalul explicit.
   */
  issuesLoadedFor: string | null
  /**
   * Id-ul proiectului pentru care încărcarea a eșuat. Complementul lui
   * `issuesLoadedFor`: fără el, un consumator care așteaptă datele (rezolvarea
   * unui deep link) ar aștepta la infinit după un eșec, iar o listă goală ar
   * părea „proiect fără tichete” în loc de „n-am putut încărca”.
   */
  issuesLoadFailedFor: string | null
  activeWave: number
  /**
   * Tichetele cu scadență din TOATE proiectele, tăiate în liste inteligente.
   * Derivat, nu stocat separat — vezi `dueIssues` în implementare.
   */
  smartLists: SmartLists
  /** Fereastra de scadențe a fost adusă cel puțin o dată. */
  dueLoaded: boolean
  assignees: Assignee[]
  /** Obstacolele proiectului activ, ordonate după `position`. */
  obstacles: Obstacle[]
  /** Muchiile obstacol → tichet ale proiectului activ. */
  obstacleLinks: ObstacleLink[]
  myAssigneeId: string | null
  /**
   * Cutia de pase, tăiată în „Necitite"/„Mai devreme" (`groupInbox`).
   * Transversal pe proiecte, ca `smartLists` — vezi `loadInbox`.
   */
  inbox: { fresh: InboxRow[]; rest: InboxRow[] }
  /** Fereastra de inbox a fost adusă cel puțin o dată. */
  inboxLoaded: boolean
  /**
   * Marchează firul unui tichet ca văzut — stinge bulina de necitit. Scrie și
   * pe server (`repository.markSeen`) și local, ca lista să nu aștepte un
   * refresh întreg ca să reflecte atingerea.
   */
  markInboxSeen(issueId: string): Promise<void>
  /**
   * Reîncarcă doar cutia de pase — tiparul lui `refreshing`, nu al lui
   * `loading`: o scriere în fir (`Thread.send`) schimbă `inboxRaw` pe server,
   * dar `upsertIssue` nu-l atinge, deci fără asta rândul pasat rămâne vizibil
   * și badge-ul din bara de jos continuă să-l numere până la un refresh întreg.
   * Nu ridică `loading` — ar demonta `<main>` (deci `SplitView`) sub tichetul
   * tocmai scris. Vezi `loadInbox`.
   */
  refreshInbox(): Promise<void>

  selectProject(id: string | null): void
  setActiveWave(wave: number): void
  createProject(input: NewProject): Promise<Project>
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'accent' | 'type'>>): Promise<void>
  deleteProject(id: string): Promise<void>
  reorderProjects(ids: string[]): void
  createAssignee(name: string): Promise<Assignee>

  createWave(name: string, label?: string): Promise<void>
  renameWave(number: number, name: string, label: string): Promise<void>
  deleteWave(number: number): Promise<void>

  createTheme(name: string, color: string): Promise<Theme | null>
  updateTheme(key: string, patch: Partial<Pick<Theme, 'name' | 'color'>>): Promise<void>
  deleteTheme(key: string): Promise<void>

  toggleDone(id: string): Promise<void>
  createIssue(input: NewIssue): Promise<Issue>
  updateIssue(id: string, patch: Partial<Issue>): Promise<void>
  deleteIssue(id: string): Promise<void>
  deleteIssues(ids: string[]): Promise<void>
  /**
   * Scrie un tichet deja mutat de altundeva (nu de `repository.updateIssue`)
   * direct în stare — folosit de `Thread.tsx` după `postToThread`, al cărui
   * răspuns NU poartă `deps` (vezi comentariul din `supabaseRepository.ts`).
   * Apelantul răspunde să păstreze `deps` din tichetul vechi.
   */
  upsertIssue(issue: Issue): void

  createObstacle(input: Omit<NewObstacle, 'projectId'>): Promise<Obstacle | null>
  updateObstacle(id: string, patch: Partial<Obstacle>): Promise<void>
  deleteObstacle(id: string): Promise<void>
  setObstacleIssues(obstacleId: string, issueIds: string[]): Promise<void>
  setIssueObstacles(issueId: string, obstacleIds: string[]): Promise<void>

  // derived helpers
  byId: Record<string, Issue>
  layers: Layers
  stateOf(id: string): IssueState
  unblockedBy(id: string): Issue[]
  completion(projectId: string): number
  themeOf(key: string): Theme | undefined
  /**
   * issueId → obstacolele deschise ȘI blocante care îl ating. Singura sursă:
   * nicio componentă nu recalculează asta. Vezi src/lib/obstacles.ts.
   */
  blockedByObstacle: Record<string, string[]>
  obstaclesOf(issueId: string): Obstacle[]
  issuesOf(obstacleId: string): Issue[]
}

const Ctx = createContext<HorizontalState | null>(null)

export function HorizontalProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Când s-a încheiat ultima încărcare completă. Ref, nu state: îl citește doar
   * ascultătorul de `visibilitychange`, iar ca state ar fi recreat `refresh` la
   * fiecare rulare și ar fi reatașat ascultătorul degeaba.
   */
  const lastRefreshAt = useRef<number | null>(null)
  const [projectOrder, setProjectOrder] = useState<string[]>(loadOrder)
  const [rawProjects, setRawProjects] = useState<Project[]>([])
  const [allWaves, setAllWaves] = useState<Wave[]>([])
  const [allThemes, setAllThemes] = useState<Theme[]>([])
  const [allIssues, setAllIssues] = useState<Issue[]>([])
  const [allObstacles, setAllObstacles] = useState<Obstacle[]>([])
  const [allObstacleLinks, setAllObstacleLinks] = useState<ObstacleLink[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [issuesLoadedFor, setIssuesLoadedFor] = useState<string | null>(null)
  const [issuesLoadFailedFor, setIssuesLoadFailedFor] = useState<string | null>(null)
  const [activeWave, setActiveWave] = useState(1)
  // Rezultatul brut al lui listDueIssues. NU e sursa de adevăr: `dueIssues` mai
  // jos preferă versiunea din `allIssues` pentru tichetele unui proiect
  // încărcat, ca o bifă dată într-o listă inteligentă să nu trebuiască scrisă
  // în două locuri (și deci să nu se poată desincroniza).
  const [dueRaw, setDueRaw] = useState<Issue[]>([])
  const [dueLoaded, setDueLoaded] = useState(false)
  // Cutia de pase. Transversal pe proiecte, ca `dueRaw` — vezi `loadInbox`.
  const [inboxRaw, setInboxRaw] = useState<InboxRow[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  /**
   * Proiectele pentru care listIssues() a adus TOATE tichetele. Doar pentru
   * ele se poate calcula un procent de completare: listele inteligente aduc
   * tichete izolate din proiecte neîncărcate, iar un „1 din 1 bifat" dintr-un
   * proiect de 40 de tichete ar arăta 100%.
   */
  const [loadedProjects, setLoadedProjects] = useState<Set<string>>(() => new Set())
  const [assignees, setAssignees] = useState<Assignee[]>([])
  // Cine sunt, ca assignee. Vine din sesiune, nu dintr-un „eu sunt X" salvat
  // local: creatorul unui tichet și autorul unui comentariu sunt fapte, iar un
  // `localStorage` se poate minți. `null` = contul nu e legat de niciun nume.
  const myAssigneeId = useMemo(
    () => assignees.find((a) => a.userId === session?.user.id)?.id ?? null,
    [assignees, session],
  )

  /**
   * Aduce fereastra de scadențe. Eșecul e tăcut în afară de `error`: listele
   * inteligente sunt o secțiune a aplicației, nu o condiție de pornire, deci un
   * Supabase indisponibil nu are voie să blocheze deschiderea unui proiect.
   */
  const loadDue = useCallback(async () => {
    try {
      const rows = await repository.listDueIssues(smartListRange(new Date()))
      setDueRaw(rows)
      setDueLoaded(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  /**
   * Aduce cutia de pase. Transversal pe proiecte, ca `loadDue` — NU intră în
   * Promise.all-ul per-proiect din `refresh`/`selectProject`: acolo ar fi
   * refăcută la fiecare comutare de proiect și ar lipsi exact când nu e niciun
   * proiect deschis, adică fix pe ecranul „Pe mine". Eșecul e tăcut în afară
   * de `error`, ca `loadDue`: un Supabase indisponibil nu blochează pornirea.
   */
  const loadInbox = useCallback(async () => {
    try {
      setInboxRaw(await repository.listInbox())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setInboxLoaded(true)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setIssuesLoadFailedFor(null)
    void loadDue()
    void loadInbox()
    try {
      const p = await repository.listProjects()
      setRawProjects(p)
      if (projectId) {
        // Obstacolele vin în ACELAȘI Promise.all cu tichetele: dacă ajungeau o
        // randare mai târziu, poarta valului apărea goală și apoi sărea la
        // patru, iar cardurile clipeau din „liber” în „blocat”.
        const [w, t, loaded, o, ol] = await Promise.all([
          repository.listWaves(projectId),
          repository.listThemes(projectId),
          repository.listIssues(projectId),
          repository.listObstacles(projectId),
          repository.listObstacleLinks(projectId),
        ])
        setAllWaves((prev) => [...prev.filter((x) => x.projectId !== projectId), ...w])
        setAllThemes((prev) => [...prev.filter((x) => x.projectId !== projectId), ...t])
        setAllIssues((prev) => [...prev.filter((i) => i.projectId !== projectId), ...loaded])
        // `ObstacleLink` n-are `projectId` direct, deci legăturile stale ale
        // acestui proiect (inclusiv ale unui obstacol între timp șters) se scot
        // pe baza obstacolelor lui VECHI, nu doar completate peste — altfel un
        // refresh repetat ar duplica aceleași legături la infinit.
        //
        // Setul de id-uri „vechi” se citește din `prev`, în interiorul
        // actualizatorului funcțional al lui `setAllObstacles`, NU dintr-un
        // `allObstacles` închis peste clojura lui `refresh`: acela ar fi o poză
        // dinaintea acestui load, iar filtrarea pe o poză veche ar lăsa
        // legătura orfană a unui obstacol șters chiar în timpul lui Promise.all.
        // Actualizatorul rămâne pur — fără await, fără citiri din alt state —
        // fiindcă rulează în faza de randare a lui React.
        setAllObstacles((prev) => {
          const staleObstacleIds = new Set(
            prev.filter((x) => x.projectId === projectId).map((x) => x.id),
          )
          setAllObstacleLinks((links) => [
            ...links.filter((l) => !staleObstacleIds.has(l.obstacleId)),
            ...ol,
          ])
          return [...prev.filter((x) => x.projectId !== projectId), ...o]
        })
        setIssuesLoadedFor(projectId)
        setLoadedProjects((prev) => new Set(prev).add(projectId))
      }
    } catch (e) {
      setError(errorMessage(e))
      // Același tratament ca în selectProject: marcăm eșecul, ca oricine
      // așteaptă datele proiectului să nu aștepte la infinit. `issuesLoadedFor`
      // rămâne cum era — datele vechi sunt încă în memorie și încă valide.
      if (projectId) setIssuesLoadFailedFor(projectId)
    } finally {
      // Și după un eșec: pragul măsoară „de când n-am mai încercat”, nu „de
      // când n-am mai reușit”. Altfel un Supabase căzut ar fi însemnat o
      // cerere la fiecare comutare de tab.
      lastRefreshAt.current = Date.now()
      setRefreshing(false)
    }
  }, [projectId, loadDue, loadInbox])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [p, a] = await Promise.all([repository.listProjects(), repository.listAssignees()])
        if (alive) { setRawProjects(p); setAssignees(a) }
        // Listele inteligente se cer în paralel cu proiectele: sunt prima
        // secțiune din sidebar și trebuie să aibă numere de la primul cadru.
        // La fel cutia de pase — ecranul „Pe mine" trebuie să aibă badge-ul
        // corect de la primul cadru, fără să aștepte deschiderea unui proiect.
        if (alive) { void loadDue(); void loadInbox() }
      } catch (e) {
        if (alive) setError(errorMessage(e))
      } finally {
        if (alive) {
          lastRefreshAt.current = Date.now()
          setLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [loadDue, loadInbox])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!shouldRefreshOnVisible(lastRefreshAt.current, Date.now())) return
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const projects = useMemo(() => applyOrder(rawProjects, projectOrder), [rawProjects, projectOrder])
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId])
  const issues = useMemo(() => allIssues.filter((i) => i.projectId === projectId), [allIssues, projectId])
  const waves = useMemo(
    () => allWaves.filter((w) => w.projectId === projectId).sort((a, b) => a.position - b.position),
    [allWaves, projectId],
  )
  const themes = useMemo(() => allThemes.filter((t) => t.projectId === projectId), [allThemes, projectId])
  const obstacles = useMemo(
    () => allObstacles.filter((o) => o.projectId === projectId),
    [allObstacles, projectId],
  )
  const obstacleLinks = useMemo(() => {
    const mine = new Set(obstacles.map((o) => o.id))
    return allObstacleLinks.filter((l) => mine.has(l.obstacleId))
  }, [allObstacleLinks, obstacles])

  /**
   * Tichetele cu scadență, cu O SINGURĂ sursă de adevăr pentru fiecare.
   *
   * `allIssues` e mai proaspăt pentru proiectele deschise (acolo ajung toate
   * mutațiile prin `upsertIssue`), deci versiunea de acolo câștigă. Iar un
   * tichet care a primit scadență chiar acum, într-un proiect deschis, apare
   * imediat în liste fără să reinterogăm serverul. Rezultatul e derivat, deci
   * nu există al doilea loc de scris și nimic nu se poate desincroniza.
   */
  const dueIssues = useMemo(() => {
    const fresh = new Map(allIssues.map((i) => [i.id, i]))
    const known = new Set(dueRaw.map((i) => i.id))
    const merged = dueRaw.map((i) => fresh.get(i.id) ?? i)
    for (const i of allIssues) if (i.dueAt && !known.has(i.id)) merged.push(i)
    return merged.filter((i) => i.dueAt)
  }, [dueRaw, allIssues])

  const smartLists = useMemo(() => buildSmartLists(dueIssues, new Date()), [dueIssues])

  const inbox = useMemo(() => groupInbox(inboxRaw), [inboxRaw])

  /**
   * Vezi contractul din interfață: scrie și pe server, și local — local ca
   * bulina să se stingă fără să aștepte un `refresh()` întreg.
   */
  const markInboxSeen = useCallback(async (issueId: string) => {
    try {
      await repository.markSeen(issueId)
      setInboxRaw((prev) =>
        prev.map((r) => (r.issueId === issueId ? { ...r, seenAt: new Date().toISOString() } : r)),
      )
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  const selectProject = useCallback(
    (id: string | null) => {
      // Reselectarea proiectului DEJA deschis nu e o navigare, deci nu resetează
      // nimic. Contează fiindcă închiderea unui ticket trece prin `history.back()`
      // → `popstate` → `onPop` (App.tsx), care aterizează pe `/project/<slug>`-ul
      // proiectului curent și chema selectProject cu același id: valul activ
      // sărea de pe II pe `currentWave` (mereu 1), plus o reîncărcare inutilă.
      if (id === projectId) return
      setProjectId(id)
      // La schimbarea proiectului, „încărcat” redevine fals până sosesc datele,
      // ca un consumator să nu citească snapshot-ul altui proiect.
      setIssuesLoadedFor((cur) => (cur === id ? cur : null))
      setIssuesLoadFailedFor(null)
      if (!id) return
      const proj = projects.find((p) => p.id === id)
      setActiveWave(proj?.currentWave ?? 1)
      // Obstacolele în ACELAȘI Promise.all cu tichetele — vezi motivul din
      // `refresh`: un `await` separat ar face poarta valului să apară goală și
      // apoi să sară la patru, cu cardurile clipind din „liber" în „blocat".
      Promise.all([
        repository.listWaves(id),
        repository.listThemes(id),
        repository.listIssues(id),
        repository.listObstacles(id),
        repository.listObstacleLinks(id),
      ])
        .then(([w, t, loaded, o, ol]) => {
          setAllWaves((prev) => [...prev.filter((x) => x.projectId !== id), ...w])
          setAllThemes((prev) => [...prev.filter((x) => x.projectId !== id), ...t])
          setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...loaded])
          // Ca în `refresh`: `ObstacleLink` n-are `projectId`, deci legăturile
          // stale ale acestui proiect (revizitat după o încărcare anterioară)
          // se scot pe baza obstacolelor lui VECHI, nu doar completate peste.
          // Id-urile „vechi” vin din `prev`, în interiorul actualizatorului
          // funcțional al lui `setAllObstacles`, nu dintr-un `allObstacles`
          // închis peste clojura lui `selectProject` — acela ar fi o poză
          // dinaintea acestui load, iar un obstacol șters chiar în timpul lui
          // `Promise.all` ar rămâne cu legătura orfană. Actualizatorul rămâne
          // pur — fără await, fără citiri din alt state.
          setAllObstacles((prev) => {
            const staleObstacleIds = new Set(prev.filter((x) => x.projectId === id).map((x) => x.id))
            setAllObstacleLinks((links) => [
              ...links.filter((l) => !staleObstacleIds.has(l.obstacleId)),
              ...ol,
            ])
            return [...prev.filter((x) => x.projectId !== id), ...o]
          })
          setIssuesLoadedFor(id)
          setLoadedProjects((prev) => new Set(prev).add(id))
          if (w.length && !w.some((x) => x.number === (proj?.currentWave ?? 1))) {
            setActiveWave(w[0].number)
          }
        })
        .catch((e) => {
          setError(errorMessage(e))
          // `issuesLoadedFor` rămâne null (n-avem date), dar semnalăm explicit
          // eșecul: altfel cine așteaptă încărcarea (deep link în curs de
          // rezolvare) rămâne blocat pe vecie.
          setIssuesLoadFailedFor(id)
        })
    },
    [projects, projectId],
  )

  const upsertIssue = useCallback((issue: Issue) => {
    setAllIssues((prev) => {
      const i = prev.findIndex((x) => x.id === issue.id)
      if (i === -1) return [...prev, issue]
      const next = prev.slice()
      next[i] = issue
      return next
    })
  }, [])

  const reorderProjects = useCallback((ids: string[]) => {
    setProjectOrder(ids)
    saveOrder(ids)
  }, [])

  const createProject = useCallback(async (input: NewProject) => {
    const created = await repository.createProject(input)
    setRawProjects((prev) => [...prev, created])
    const w = await repository.listWaves(created.id)
    setAllWaves((prev) => [...prev, ...w])
    return created
  }, [])

  const updateProject = useCallback(async (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'accent' | 'type'>>) => {
    const updated = await repository.updateProject(id, patch)
    setRawProjects((prev) => prev.map((p) => (p.id === id ? updated : p)))
  }, [])

  const createAssignee = useCallback(async (name: string) => {
    const assignee = await repository.createAssignee(name)
    setAssignees((prev) => [...prev, assignee].sort((a, b) => a.name.localeCompare(b.name)))
    return assignee
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await repository.deleteProject(id)
    setRawProjects((prev) => prev.filter((p) => p.id !== id))
    setAllWaves((prev) => prev.filter((w) => w.projectId !== id))
    setAllThemes((prev) => prev.filter((t) => t.projectId !== id))
    setAllIssues((prev) => prev.filter((i) => i.projectId !== id))
    // Cascadează și pe backend (vezi deleteProject din localRepository /
    // supabaseRepository): obstacolele proiectului dispar, deci și legăturile lor.
    setAllObstacles((prev) => {
      const gone = new Set(prev.filter((o) => o.projectId === id).map((o) => o.id))
      setAllObstacleLinks((links) => links.filter((l) => !gone.has(l.obstacleId)))
      return prev.filter((o) => o.projectId !== id)
    })
    setDueRaw((prev) => prev.filter((i) => i.projectId !== id))
    setLoadedProjects((prev) => { const n = new Set(prev); n.delete(id); return n })
    setProjectId((cur) => (cur === id ? null : cur))
    setIssuesLoadedFor((cur) => (cur === id ? null : cur))
  }, [])

  const createWave = useCallback(
    async (name: string, label = '') => {
      if (!projectId) return
      const wave = await repository.createWave(projectId, name, label)
      setAllWaves((prev) => [...prev, wave])
    },
    [projectId],
  )

  const renameWave = useCallback(
    async (number: number, name: string, label: string) => {
      if (!projectId) return
      const updated = await repository.updateWave(projectId, number, { name, label })
      setAllWaves((prev) => prev.map((w) => (w.projectId === projectId && w.number === number ? updated : w)))
    },
    [projectId],
  )

  const deleteWave = useCallback(
    async (number: number) => {
      if (!projectId) return
      await repository.deleteWave(projectId, number)
      setAllWaves((prev) => prev.filter((w) => !(w.projectId === projectId && w.number === number)))
      setActiveWave((cur) => {
        if (cur !== number) return cur
        const remaining = allWaves.filter((w) => w.projectId === projectId && w.number !== number)
        return remaining.length ? remaining.sort((a, b) => a.position - b.position)[0].number : 1
      })
    },
    [projectId, allWaves],
  )

  const createTheme = useCallback(
    async (name: string, color: string) => {
      if (!projectId) return null
      const theme = await repository.createTheme(projectId, name, color)
      setAllThemes((prev) => [...prev, theme])
      return theme
    },
    [projectId],
  )

  const updateTheme = useCallback(
    async (key: string, patch: Partial<Pick<Theme, 'name' | 'color'>>) => {
      if (!projectId) return
      const updated = await repository.updateTheme(projectId, key, patch)
      setAllThemes((prev) => prev.map((t) => (t.projectId === projectId && t.key === key ? updated : t)))
    },
    [projectId],
  )

  const deleteTheme = useCallback(
    async (key: string) => {
      if (!projectId) return
      await repository.deleteTheme(projectId, key)
      setAllThemes((prev) => prev.filter((t) => !(t.projectId === projectId && t.key === key)))
      setAllIssues((prev) =>
        prev.map((i) => (i.projectId === projectId && i.theme === key ? { ...i, theme: '' } : i)),
      )
    },
    [projectId],
  )

  const toggleDone = useCallback(
    async (id: string) => {
      // Și în `dueIssues`: o sarcină dintr-o listă inteligentă poate aparține
      // unui proiect care nu a fost deschis niciodată, deci nu e în `allIssues`.
      const current = allIssues.find((i) => i.id === id) ?? dueIssues.find((i) => i.id === id)
      if (!current) return
      const done = !current.done
      upsertIssue({ ...current, done })
      try {
        const saved = await repository.updateIssue(id, { done })
        upsertIssue(saved)
      } catch (e) {
        upsertIssue(current)
        setError(errorMessage(e))
      }
    },
    [allIssues, dueIssues, upsertIssue],
  )

  const createIssue = useCallback(
    async (input: NewIssue) => {
      const created = await repository.createIssue(input)
      upsertIssue(created)
      return created
    },
    [upsertIssue],
  )

  const updateIssue = useCallback(
    async (id: string, patch: Partial<Issue>) => {
      const saved = await repository.updateIssue(id, patch)
      upsertIssue(saved)
    },
    [upsertIssue],
  )

  const deleteIssue = useCallback(async (id: string) => {
    await repository.deleteIssue(id)
    // `dueRaw` nu trece prin upsertIssue, deci ștergerea trebuie curățată și
    // aici — altfel sarcina ar rămâne în listele inteligente până la refresh.
    setDueRaw((prev) => prev.filter((i) => i.id !== id))
    setAllIssues((prev) =>
      prev
        .filter((i) => i.id !== id)
        .map((i) => (i.deps?.includes(id) ? { ...i, deps: i.deps.filter((d) => d !== id) } : i)),
    )
  }, [])

  const deleteIssues = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await repository.deleteIssues(ids)
    const gone = new Set(ids)
    setDueRaw((prev) => prev.filter((i) => !gone.has(i.id)))
    setAllIssues((prev) =>
      prev
        .filter((i) => !gone.has(i.id))
        .map((i) => (i.deps?.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i)),
    )
  }, [])

  const createObstacle = useCallback(
    async (input: Omit<NewObstacle, 'projectId'>) => {
      if (!projectId) return null
      const created = await repository.createObstacle({ ...input, projectId })
      setAllObstacles((prev) => [...prev, created])
      // `issueIds` de la creare nu se întorc în `created` (nu fac parte din
      // formatul `Obstacle`) — legătura locală se adaugă separat, ca UI-ul
      // să nu aștepte un refresh ca să vadă tichetele deja blocate.
      if (input.issueIds?.length) {
        const links = input.issueIds
        setAllObstacleLinks((prev) => [...prev, ...links.map((issueId) => ({ obstacleId: created.id, issueId }))])
      }
      return created
    },
    [projectId],
  )

  const updateObstacle = useCallback(
    async (id: string, patch: Partial<Obstacle>) => {
      if (patch.deps) {
        // Ciclul se refuză aici, nu în motor: openObstacles e chemat la fiecare
        // randare și n-are voie să arunce pe date deja salvate.
        const prospective = obstacles.map((o) => (o.id === id ? { ...o, deps: patch.deps! } : o))
        const cycle = detectObstacleCycle(prospective)
        if (cycle) throw new Error(`Dependență circulară între obstacole: ${cycle.join(' → ')}`)
      }
      const updated = await repository.updateObstacle(id, patch)
      setAllObstacles((prev) => prev.map((o) => (o.id === id ? updated : o)))
    },
    [obstacles],
  )

  const deleteObstacle = useCallback(async (id: string) => {
    await repository.deleteObstacle(id)
    // La fel ca `deleteIssue`: obstacolul dispare, legăturile lui la tichete
    // dispar, și se scoate din `deps`-urile celorlalte obstacole — serverul
    // face toate trei, starea locală trebuie să oglindească toate trei.
    setAllObstacles((prev) =>
      prev
        .filter((o) => o.id !== id)
        .map((o) => (o.deps.includes(id) ? { ...o, deps: o.deps.filter((d) => d !== id) } : o)),
    )
    setAllObstacleLinks((prev) => prev.filter((l) => l.obstacleId !== id))
  }, [])

  const setObstacleIssues = useCallback(async (obstacleId: string, issueIds: string[]) => {
    await repository.setObstacleIssues(obstacleId, issueIds)
    setAllObstacleLinks((prev) => [
      ...prev.filter((l) => l.obstacleId !== obstacleId),
      ...issueIds.map((issueId) => ({ obstacleId, issueId })),
    ])
  }, [])

  const setIssueObstacles = useCallback(async (issueId: string, obstacleIds: string[]) => {
    await repository.setIssueObstacles(issueId, obstacleIds)
    setAllObstacleLinks((prev) => [
      ...prev.filter((l) => l.issueId !== issueId),
      ...obstacleIds.map((obstacleId) => ({ obstacleId, issueId })),
    ])
  }, [])

  const byId = useMemo(() => indexById(issues), [issues])
  const layers = useMemo(() => {
    try {
      return computeLayers(issues, activeWave)
    } catch (e) {
      if (e instanceof DependencyCycleError) {
        setError(`Ciclu de dependențe: ${e.cycle.join(' → ')}. Scoate una dintre legături.`)
      } else {
        setError(errorMessage(e))
      }
      return {}
    }
  }, [issues, activeWave])

  const blockedByObstacle = useMemo(
    () => blockedBy(issues, obstacles, obstacleLinks),
    [issues, obstacles, obstacleLinks],
  )

  const obstaclesOf = useCallback(
    (issueId: string) => {
      const ids = new Set(obstacleLinks.filter((l) => l.issueId === issueId).map((l) => l.obstacleId))
      return obstacles.filter((o) => ids.has(o.id))
    },
    [obstacles, obstacleLinks],
  )

  const issuesOf = useCallback(
    (obstacleId: string) => {
      const ids = new Set(obstacleLinks.filter((l) => l.obstacleId === obstacleId).map((l) => l.issueId))
      return issues.filter((i) => ids.has(i.id))
    },
    [issues, obstacleLinks],
  )

  const stateOf = useCallback((id: string) => deriveState(byId[id], byId), [byId])
  const unblockedBy = useCallback((id: string) => unblocks(id, issues), [issues])
  // Doar proiectele încărcate integral au un procent care înseamnă ceva; vezi
  // `loadedProjects`. Pentru restul, 0 e onest (și e ce arăta și înainte, când
  // `allIssues` conținea numai proiecte încărcate complet).
  const completion = useCallback(
    (pid: string) =>
      loadedProjects.has(pid) ? projectCompletion(allIssues.filter((i) => i.projectId === pid)) : 0,
    [allIssues, loadedProjects],
  )
  const themeOf = useCallback((key: string) => themes.find((t) => t.key === key), [themes])

  const value: HorizontalState = {
    loading,
    refreshing,
    error,
    refresh,
    projects,
    project,
    waves,
    themes,
    issues,
    issuesLoadedFor,
    issuesLoadFailedFor,
    activeWave,
    smartLists,
    dueLoaded,
    assignees,
    obstacles,
    obstacleLinks,
    myAssigneeId,
    inbox,
    inboxLoaded,
    markInboxSeen,
    refreshInbox: loadInbox,
    selectProject,
    setActiveWave,
    createProject,
    updateProject,
    deleteProject,
    reorderProjects,
    createAssignee,
    createWave,
    renameWave,
    deleteWave,
    createTheme,
    updateTheme,
    deleteTheme,
    toggleDone,
    createIssue,
    updateIssue,
    deleteIssue,
    deleteIssues,
    upsertIssue,
    createObstacle,
    updateObstacle,
    deleteObstacle,
    setObstacleIssues,
    setIssueObstacles,
    byId,
    layers,
    stateOf,
    unblockedBy,
    completion,
    themeOf,
    blockedByObstacle,
    obstaclesOf,
    issuesOf,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHorizontal(): HorizontalState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHorizontal must be used within HorizontalProvider')
  return ctx
}
