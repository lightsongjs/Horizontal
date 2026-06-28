// App store: loads projects, and the selected project's waves + issues through
// the repository. Exposes mutations with optimistic updates and memoized
// derived data (layers, states, completion).

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
import { computeLayers, deriveState, indexById, projectCompletion, unblocks } from './lib/engine'
import type { Issue, IssueState, Layers, Project, Wave } from './lib/types'

interface DepFlowState {
  loading: boolean
  error: string | null
  projects: Project[]
  project: Project | null
  waves: Wave[]
  issues: Issue[]
  activeWave: number

  selectProject(id: string | null): void
  setActiveWave(wave: number): void
  createProject(input: NewProject): Promise<Project>

  createWave(name: string, label?: string): Promise<void>
  renameWave(number: number, name: string, label: string): Promise<void>
  deleteWave(number: number): Promise<void>

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
}

const Ctx = createContext<DepFlowState | null>(null)

export function DepFlowProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [allWaves, setAllWaves] = useState<Wave[]>([])
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

  const selectProject = useCallback(
    (id: string | null) => {
      setProjectId(id)
      if (!id) return
      const proj = projects.find((p) => p.id === id)
      setActiveWave(proj?.currentWave ?? 1)
      Promise.all([repository.listWaves(id), repository.listIssues(id)])
        .then(([w, loaded]) => {
          setAllWaves((prev) => [...prev.filter((x) => x.projectId !== id), ...w])
          setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...loaded])
          // Snap active wave to the first existing wave if currentWave is gone.
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
    project,
    waves,
    issues,
    activeWave,
    selectProject,
    setActiveWave,
    createProject,
    createWave,
    renameWave,
    deleteWave,
    toggleDone,
    createIssue,
    updateIssue,
    deleteIssue,
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
