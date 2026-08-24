import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHorizontal } from './store'
import { useUI } from './ui'
import { useAuth } from './auth'
import { getRelatedIds } from './lib/treeTraversal'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'
import type { Project } from './lib/types'

const HIDE_DONE_KEY = 'horizontal:hide-done'

/**
 * Whether the signed-in user may mutate a GIVEN project.
 * Admins can always write; a member can write only projects where their role
 * is 'write'. Read-only members (role 'read') see the project but cannot edit.
 *
 * Pe id, nu pe proiectul deschis: o sarcină din listele inteligente poate
 * aparține oricărui proiect, iar în listă nu e deschis niciunul — evaluat pe
 * proiectul curent, dreptul de scriere ar fi ieșit mereu fals.
 *
 * This is UX gating ONLY — the real boundary is Supabase RLS + the edge
 * function. Hiding a button never guarantees the mutation is refused server-side.
 */
export function useCanWriteIn(projectId: string | null): boolean {
  const { enabled, isAdmin, access } = useAuth()
  // Fără autentificare configurată nu există utilizator de restrâns: modul
  // local seeded, fără credențiale, e al tău în întregime. Altfel `isAdmin` e
  // fals și `access` gol, deci dezvoltarea locală ar fi read-only — adică
  // exact opusul a ce e modul ăla bun.
  if (!enabled) return true
  return isAdmin || (projectId ? access[projectId] === 'write' : false)
}

/** Dreptul de scriere în proiectul deschis. */
export function useCanWrite(): boolean {
  const { project } = useHorizontal()
  return useCanWriteIn(project?.id ?? null)
}

/**
 * Proiectele în care utilizatorul poate crea. Sursa selectorului din quick add:
 * fără Inbox, fiecare sarcină are un proiect, deci lista de acolo n-are voie să
 * ofere unul în care salvarea ar fi respinsă de RLS.
 */
export function useWritableProjects(): Project[] {
  const { enabled, isAdmin, access } = useAuth()
  const { projects } = useHorizontal()
  return useMemo(() => {
    if (!enabled || isAdmin) return projects
    return projects.filter((p) => access[p.id] === 'write')
  }, [enabled, isAdmin, access, projects])
}

/** True when a keyboard shortcut should be ignored: focus is in a text field,
 *  a modifier is held, or a sheet is open. Shared by the keyboard-driven hooks. */
function shouldIgnoreKey(e: KeyboardEvent, sheetKind: string): boolean {
  const target = e.target as HTMLElement
  if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return true
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  return sheetKind !== 'none'
}

/**
 * localStorage-backed "hide completed" toggle, shared across views.
 *
 * State is seeded from localStorage only on mount. This keeps the board and
 * list tabs in sync BECAUSE they are conditionally rendered (one mounted at a
 * time) — switching tabs remounts the other view, which re-reads the persisted
 * value. If both views were ever kept mounted (e.g. display:none tabs), the two
 * independent useState copies would drift; lift the state to context first.
 */
export function useHideDone(): [boolean, () => void] {
  const [hideDone, setHideDone] = useState(
    () => localStorage.getItem(HIDE_DONE_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0')
  }, [hideDone])
  const toggle = useCallback(() => setHideDone((h) => !h), [])
  return [hideDone, toggle]
}

/** Layer groups for the active wave, urgent-first, optionally hiding done. */
export function useOrderedLayers(hideDone: boolean): OrderedLayer[] {
  const { layers, byId } = useHorizontal()
  return useMemo(() => buildOrderedLayers(layers, byId, hideDone), [layers, byId, hideDone])
}

export interface WaveActions {
  selectMode: boolean
  selectedIds: Set<string>
  treeViewActive: boolean
  treeHighlightId: string | null
  confirmDel: boolean
  /** treeHighlightId + its related ids, or null when nothing is highlighted */
  highlightedIds: Set<string> | null
  enterSelectMode: () => void
  exitSelectMode: () => void
  toggleTree: () => void
  exitTreeView: () => void
  handleTreeSelect: (id: string) => void
  /** toggle one item's membership in the selection set */
  toggleSelected: (id: string) => void
  openConfirm: () => void
  cancelConfirm: () => void
  handleBulkMove: (targetWave: number) => Promise<void>
  handleBulkDelete: () => Promise<void>
}

/**
 * All interaction state shared by the Cards and List views: multi-select +
 * bulk actions, tree-highlight mode, and the T/Esc keyboard shortcuts. Extracted
 * so both views stay in lockstep instead of drifting.
 */
export function useWaveActions(): WaveActions {
  const { activeWave, deleteIssues, updateIssue, byId } = useHorizontal()
  const { sheet } = useUI()

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [treeViewActive, setTreeViewActive] = useState(false)
  const [treeHighlightId, setTreeHighlightId] = useState<string | null>(null)

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmDel(false)
  }, [])

  const enterSelectMode = useCallback(() => setSelectMode(true), [])

  const exitTreeView = useCallback(() => {
    setTreeViewActive(false)
    setTreeHighlightId(null)
  }, [])

  const toggleTree = useCallback(() => {
    setTreeViewActive((active) => {
      if (active) {
        setTreeHighlightId(null)
        return false
      }
      // entering tree — leave select mode
      setSelectMode(false)
      setSelectedIds(new Set())
      setConfirmDel(false)
      return true
    })
  }, [])

  const handleTreeSelect = useCallback((id: string) => {
    setTreeHighlightId((prev) => (prev === id ? null : id))
  }, [])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openConfirm = useCallback(() => setConfirmDel(true), [])
  const cancelConfirm = useCallback(() => setConfirmDel(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDel) { setConfirmDel(false); return }
        if (treeViewActive) { exitTreeView(); return }
        if (selectMode) exitSelectMode()
        return
      }

      if (shouldIgnoreKey(e, sheet.kind)) return

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        toggleTree()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, confirmDel, treeViewActive, exitSelectMode, exitTreeView, toggleTree, sheet.kind])

  // reset tree state when the active wave changes
  useEffect(() => { exitTreeView() }, [activeWave, exitTreeView])

  const handleBulkMove = useCallback(async (targetWave: number) => {
    await Promise.all([...selectedIds].map((id) => updateIssue(id, { wave: targetWave })))
    exitSelectMode()
  }, [selectedIds, updateIssue, exitSelectMode])

  const handleBulkDelete = useCallback(async () => {
    // Un singur apel, nu `Promise.all(map(deleteIssue))`: acela lansa 3N cereri
    // concurente și, la primul eșec, lăsa restul în zbor fără rollback —
    // ștergere parțială plus toast de eroare.
    await deleteIssues([...selectedIds])
    exitSelectMode()
  }, [selectedIds, deleteIssues, exitSelectMode])

  const highlightedIds: Set<string> | null = useMemo(
    () => (treeHighlightId ? new Set([treeHighlightId, ...getRelatedIds(treeHighlightId, byId)]) : null),
    [treeHighlightId, byId],
  )

  return {
    selectMode, selectedIds, treeViewActive, treeHighlightId, confirmDel, highlightedIds,
    enterSelectMode, exitSelectMode, toggleTree, exitTreeView, handleTreeSelect,
    toggleSelected, openConfirm, cancelConfirm, handleBulkMove, handleBulkDelete,
  }
}

export interface VimNav {
  focusedId: string | null
  setFocusedId: (id: string | null) => void
}

/**
 * Vim-style keyboard navigation over the layer grid. `flatLayers` is the array
 * of id-arrays (one per layer) currently rendered. Shared by Cards and List.
 */
export function useVimNav(flatLayers: string[][]): VimNav {
  const { activeWave } = useHorizontal()
  const { openEditIssue, sheet } = useUI()
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // reset focus when the wave changes
  useEffect(() => { setFocusedId(null) }, [activeWave])

  // scroll the focused item into view
  useEffect(() => {
    if (!focusedId) return
    document
      .querySelector(`[data-issue-id="${focusedId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e, sheet.kind)) return

      const key = e.key.toLowerCase()
      if (!['h', 'j', 'k', 'l', 'enter', 'escape'].includes(key)) return

      if (key === 'escape') {
        if (focusedId) { e.preventDefault(); setFocusedId(null) }
        return
      }

      if (key === 'enter' && focusedId) {
        e.preventDefault()
        openEditIssue(focusedId)
        return
      }

      e.preventDefault()

      // first press — enter nav mode on the first visible item
      if (!focusedId) {
        const firstId = flatLayers[0]?.[0]
        if (firstId) setFocusedId(firstId)
        return
      }

      let layerIdx = -1, posInLayer = -1
      for (let li = 0; li < flatLayers.length; li++) {
        const pi = flatLayers[li].indexOf(focusedId)
        if (pi !== -1) { layerIdx = li; posInLayer = pi; break }
      }
      if (layerIdx === -1) return

      if (key === 'j') {
        if (layerIdx + 1 < flatLayers.length) {
          const next = flatLayers[layerIdx + 1]
          setFocusedId(next[Math.min(posInLayer, next.length - 1)])
        }
      } else if (key === 'k') {
        if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[Math.min(posInLayer, prev.length - 1)])
        }
      } else if (key === 'l') {
        const layer = flatLayers[layerIdx]
        if (posInLayer + 1 < layer.length) {
          setFocusedId(layer[posInLayer + 1])
        } else if (layerIdx + 1 < flatLayers.length) {
          setFocusedId(flatLayers[layerIdx + 1][0])
        }
      } else if (key === 'h') {
        if (posInLayer > 0) {
          setFocusedId(flatLayers[layerIdx][posInLayer - 1])
        } else if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[prev.length - 1])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, flatLayers, sheet, openEditIssue])

  return { focusedId, setFocusedId }
}

/**
 * True când pointerul principal e grosier — un deget, nu un mouse.
 *
 * Decide dacă se arată cardul de cameră din AttachmentPicker: `capture` deschide
 * webcamul pe desktop, ceea ce nu e aproape niciodată ce vrei. Detecția e pe
 * capabilitate, nu pe user-agent, fiindcă șirul de user-agent minte și oricum
 * n-ar prinde un dispozitiv hibrid care câștigă sau pierde touchscreen-ul în
 * timpul sesiunii — media query-ul îl urmărește.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    // Se resincronizează la montare, nu doar la `change`: între citirea din
    // `useState` și abonare poate trece un detach de tastatură, iar evenimentul
    // acela s-ar pierde pentru totdeauna.
    setCoarse(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return coarse
}
