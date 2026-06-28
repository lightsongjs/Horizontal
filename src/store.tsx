// App store: loads projects/themes/waves and the selected project's issues
// through the repository, exposes mutations with optimistic updates, and
// memoizes derived data (layers, states, completion).

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
  themes: Theme[]
  waves: Wave[]
  project: Project | null
  issues: Issue[]
  activeWave: number

  selectProject(id: string | null): void
  setActiveWave(wave: number): void
  toggleDone(id: string): Promise<void>
  createIssue(input: NewIssue): Promise<Issue>
  updateIssue(id: string, patch: Partial<Issue>): Promise<void>
  createProject(input: NewProject): Promise<Project>
  createTheme(theme: Theme): Promise<Theme>

  // derived helpers
  byId: Record<string, Issue>
  layers: Layers
  stateOf(id: string): IssueState
  unblockedBy(id: string): Issue[]
  completion(projectId: string): number
}

const Ctx = createContext<DepFlowState | null>(null)

export function DepFlowProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [themes, setThemes] = useState<Theme[]>([])
  const [waves, setWaves] = useState<Wave[]>([])
  const [allIssues, setAllIssues] = useState<Issue[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [activeWave, setActiveWave] = useState(1)

  // Initial load: projects, themes, waves.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [p, t, w] = await Promise.all([
          repository.listProjects(),
          repository.listThemes(),
          repository.listWaves(),
        ])
        if (!alive) return
        setProjects(p)
        setThemes(t)
        setWaves(w)
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

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  )
  const issues = useMemo(
    () => allIssues.filter((i) => i.projectId === projectId),
    [allIssues, projectId],
  )

  const selectProject = useCallback(
    (id: string | null) => {
      setProjectId(id)
      if (!id) return
      const proj = projects.find((p) => p.id === id)
      setActiveWave(proj?.currentWave ?? 1)
      repository
        .listIssues(id)
        .then((loaded) =>
          setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...loaded]),
        )
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

  const toggleDone = useCallback(
    async (id: string) => {
      const current = allIssues.find((i) => i.id === id)
      if (!current) return
      const done = !current.done
      upsertIssue({ ...current, done }) // optimistic
      try {
        const saved = await repository.updateIssue(id, { done })
        upsertIssue(saved)
      } catch (e) {
        upsertIssue(current) // rollback
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

  const createProject = useCallback(async (input: NewProject) => {
    const created = await repository.createProject(input)
    setProjects((prev) => [...prev, created])
    return created
  }, [])

  const createTheme = useCallback(async (theme: Theme) => {
    const created = await repository.createTheme(theme)
    setThemes((prev) => (prev.some((t) => t.key === created.key) ? prev : [...prev, created]))
    return created
  }, [])

  const byId = useMemo(() => indexById(issues), [issues])
  const layers = useMemo(() => {
    try {
      return computeLayers(issues, activeWave)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return {}
    }
  }, [issues, activeWave])

  const stateOf = useCallback((id: string) => deriveState(byId[id], byId), [byId])
  const unblockedBy = useCallback((id: string) => unblocks(id, issues), [issues])
  const completion = useCallback(
    (pid: string) => projectCompletion(allIssues.filter((i) => i.projectId === pid)),
    [allIssues],
  )

  const value: DepFlowState = {
    loading,
    error,
    projects,
    themes,
    waves,
    project,
    issues,
    activeWave,
    selectProject,
    setActiveWave,
    toggleDone,
    createIssue,
    updateIssue,
    createProject,
    createTheme,
    byId,
    layers,
    stateOf,
    unblockedBy,
    completion,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDepFlow(): DepFlowState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDepFlow must be used within DepFlowProvider')
  return ctx
}
