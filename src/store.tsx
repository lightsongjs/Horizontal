// App store: loads projects, and the selected project's waves + themes +
// issues through the repository. Exposes mutations with optimistic updates and
// memoized derived data (layers, states, completion).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { repository } from './data'
import { applyOrder, loadOrder, saveOrder } from './lib/projectOrder'
import type { NewIssue, NewProject } from './data/repository'
import {
  DependencyCycleError,
  computeLayers,
  deriveState,
  indexById,
  projectCompletion,
  unblocks,
} from './lib/engine'
import { buildSmartLists, smartListRange, type SmartLists } from './lib/schedule'
import type { Assignee, Issue, IssueState, Layers, Project, Theme, Wave } from './lib/types'

interface HorizontalState {
  loading: boolean
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
  myAssigneeId: string | null
  setMyAssigneeId(id: string | null): void

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

  // derived helpers
  byId: Record<string, Issue>
  layers: Layers
  stateOf(id: string): IssueState
  unblockedBy(id: string): Issue[]
  completion(projectId: string): number
  themeOf(key: string): Theme | undefined
}

const Ctx = createContext<HorizontalState | null>(null)

export function HorizontalProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectOrder, setProjectOrder] = useState<string[]>(loadOrder)
  const [rawProjects, setRawProjects] = useState<Project[]>([])
  const [allWaves, setAllWaves] = useState<Wave[]>([])
  const [allThemes, setAllThemes] = useState<Theme[]>([])
  const [allIssues, setAllIssues] = useState<Issue[]>([])
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
  /**
   * Proiectele pentru care listIssues() a adus TOATE tichetele. Doar pentru
   * ele se poate calcula un procent de completare: listele inteligente aduc
   * tichete izolate din proiecte neîncărcate, iar un „1 din 1 bifat" dintr-un
   * proiect de 40 de tichete ar arăta 100%.
   */
  const [loadedProjects, setLoadedProjects] = useState<Set<string>>(() => new Set())
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [myAssigneeId, setMyAssigneeIdState] = useState<string | null>(
    () => localStorage.getItem('horizontal-my-assignee-id')
  )

  const setMyAssigneeId = useCallback((id: string | null) => {
    setMyAssigneeIdState(id)
    if (id) localStorage.setItem('horizontal-my-assignee-id', id)
    else localStorage.removeItem('horizontal-my-assignee-id')
  }, [])

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
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setIssuesLoadFailedFor(null)
    void loadDue()
    try {
      const p = await repository.listProjects()
      setRawProjects(p)
      if (projectId) {
        const [w, t, loaded] = await Promise.all([
          repository.listWaves(projectId),
          repository.listThemes(projectId),
          repository.listIssues(projectId),
        ])
        setAllWaves((prev) => [...prev.filter((x) => x.projectId !== projectId), ...w])
        setAllThemes((prev) => [...prev.filter((x) => x.projectId !== projectId), ...t])
        setAllIssues((prev) => [...prev.filter((i) => i.projectId !== projectId), ...loaded])
        setIssuesLoadedFor(projectId)
        setLoadedProjects((prev) => new Set(prev).add(projectId))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Același tratament ca în selectProject: marcăm eșecul, ca oricine
      // așteaptă datele proiectului să nu aștepte la infinit. `issuesLoadedFor`
      // rămâne cum era — datele vechi sunt încă în memorie și încă valide.
      if (projectId) setIssuesLoadFailedFor(projectId)
    } finally {
      setLoading(false)
    }
  }, [projectId, loadDue])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [p, a] = await Promise.all([repository.listProjects(), repository.listAssignees()])
        if (alive) { setRawProjects(p); setAssignees(a) }
        // Listele inteligente se cer în paralel cu proiectele: sunt prima
        // secțiune din sidebar și trebuie să aibă numere de la primul cadru.
        if (alive) void loadDue()
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [loadDue])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
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


  const selectProject = useCallback(
    (id: string | null) => {
      setProjectId(id)
      // La schimbarea proiectului, „încărcat” redevine fals până sosesc datele,
      // ca un consumator să nu citească snapshot-ul altui proiect.
      setIssuesLoadedFor((cur) => (cur === id ? cur : null))
      setIssuesLoadFailedFor(null)
      if (!id) return
      const proj = projects.find((p) => p.id === id)
      setActiveWave(proj?.currentWave ?? 1)
      Promise.all([repository.listWaves(id), repository.listThemes(id), repository.listIssues(id)])
        .then(([w, t, loaded]) => {
          setAllWaves((prev) => [...prev.filter((x) => x.projectId !== id), ...w])
          setAllThemes((prev) => [...prev.filter((x) => x.projectId !== id), ...t])
          setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...loaded])
          setIssuesLoadedFor(id)
          setLoadedProjects((prev) => new Set(prev).add(id))
          if (w.length && !w.some((x) => x.number === (proj?.currentWave ?? 1))) {
            setActiveWave(w[0].number)
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          // `issuesLoadedFor` rămâne null (n-avem date), dar semnalăm explicit
          // eșecul: altfel cine așteaptă încărcarea (deep link în curs de
          // rezolvare) rămâne blocat pe vecie.
          setIssuesLoadFailedFor(id)
        })
    },
    [projects],
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
        setError(e instanceof Error ? e.message : String(e))
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

  const byId = useMemo(() => indexById(issues), [issues])
  const layers = useMemo(() => {
    try {
      return computeLayers(issues, activeWave)
    } catch (e) {
      if (e instanceof DependencyCycleError) {
        setError(`Ciclu de dependențe: ${e.cycle.join(' → ')}. Scoate una dintre legături.`)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
      return {}
    }
  }, [issues, activeWave])

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
    myAssigneeId,
    setMyAssigneeId,
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
    byId,
    layers,
    stateOf,
    unblockedBy,
    completion,
    themeOf,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHorizontal(): HorizontalState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHorizontal must be used within HorizontalProvider')
  return ctx
}
