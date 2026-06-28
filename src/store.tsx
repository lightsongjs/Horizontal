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
import type { NewIssue, NewProject } from './data/repository'
import {
  DependencyCycleError,
  computeLayers,
  deriveState,
  indexById,
  projectCompletion,
  unblocks,
} from './lib/engine'
import type { Issue, IssueState, Layers, Project, Theme, Wave } from './lib/types'

interface DepFlowState {
  loading: boolean
  error: string | null
  projects: Project[]
  project: Project | null
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  activeWave: number

  selectProject(id: string | null): void
  setActiveWave(wave: number): void
  createProject(input: NewProject): Promise<Project>

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

  // derived helpers
  byId: Record<string, Issue>
  layers: Layers
  stateOf(id: string): IssueState
  unblockedBy(id: string): Issue[]
  completion(projectId: string): number
  themeOf(key: string): Theme | undefined
}

const Ctx = createContext<DepFlowState | null>(null)

export function DepFlowProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [allWaves, setAllWaves] = useState<Wave[]>([])
  const [allThemes, setAllThemes] = useState<Theme[]>([])
  const [allIssues, setAllIssues] = useState<Issue[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [activeWave, setActiveWave] = useState(1)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const p = await repository.listProjects()
        if (alive) setProjects(p)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId])
  const issues = useMemo(() => allIssues.filter((i) => i.projectId === projectId), [allIssues, projectId])
  const waves = useMemo(
    () => allWaves.filter((w) => w.projectId === projectId).sort((a, b) => a.position - b.position),
    [allWaves, projectId],
  )
  const themes = useMemo(() => allThemes.filter((t) => t.projectId === projectId), [allThemes, projectId])

  const selectProject = useCallback(
    (id: string | null) => {
      setProjectId(id)
      if (!id) return
      const proj = projects.find((p) => p.id === id)
      setActiveWave(proj?.currentWave ?? 1)
      Promise.all([repository.listWaves(id), repository.listThemes(id), repository.listIssues(id)])
        .then(([w, t, loaded]) => {
          setAllWaves((prev) => [...prev.filter((x) => x.projectId !== id), ...w])
          setAllThemes((prev) => [...prev.filter((x) => x.projectId !== id), ...t])
          setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...loaded])
          if (w.length && !w.some((x) => x.number === (proj?.currentWave ?? 1))) {
            setActiveWave(w[0].number)
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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

  const createProject = useCallback(async (input: NewProject) => {
    const created = await repository.createProject(input)
    setProjects((prev) => [...prev, created])
    const w = await repository.listWaves(created.id)
    setAllWaves((prev) => [...prev, ...w])
    return created
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
      const current = allIssues.find((i) => i.id === id)
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
    [allIssues, upsertIssue],
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
    setAllIssues((prev) =>
      prev
        .filter((i) => i.id !== id)
        .map((i) => (i.deps?.includes(id) ? { ...i, deps: i.deps.filter((d) => d !== id) } : i)),
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
  const completion = useCallback(
    (pid: string) => projectCompletion(allIssues.filter((i) => i.projectId === pid)),
    [allIssues],
  )
  const themeOf = useCallback((key: string) => themes.find((t) => t.key === key), [themes])

  const value: DepFlowState = {
    loading,
    error,
    projects,
    project,
    waves,
    themes,
    issues,
    activeWave,
    selectProject,
    setActiveWave,
    createProject,
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
    byId,
    layers,
    stateOf,
    unblockedBy,
    completion,
    themeOf,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDepFlow(): DepFlowState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDepFlow must be used within DepFlowProvider')
  return ctx
}
