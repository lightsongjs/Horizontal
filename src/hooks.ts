import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useHorizontal } from './store'
import { useUI } from './ui'
import { useAuth } from './auth'
import { getRelatedIds } from './lib/treeTraversal'
import { liveRejections, maskRejected, parseDue, stripSpans, type ParsedDue } from './lib/parseDue'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'
import type { Issue, Project } from './lib/types'
import { parseCaptureTokens, type CaptureTokens } from './lib/captureTokens'
import { Autosaver, type AutosaveStatus, type Fields, type Normalize } from './lib/autosave'
import { captureDefaultProjectId, computeDraft, keyboardInset, type DraftError, type DraftSchedule, type ManualPick, type QuickCtx } from './lib/quickDraft'
import type { NewIssue } from './data/repository'

const HIDE_DONE_KEY = 'horizontal:hide-done'
const SIDEBAR_KEY = 'horizontal:sidebar-collapsed'

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

/**
 * `useCanWriteIn` ca funcție, pentru o listă de sarcini din proiecte diferite
 * (bara de selecție): un hook nu se poate chema într-o buclă. Aceeași regulă.
 */
export function useCanWriteFn(): (projectId: string) => boolean {
  const { enabled, isAdmin, access } = useAuth()
  return useCallback(
    (projectId: string) => !enabled || isAdmin || access[projectId] === 'write',
    [enabled, isAdmin, access],
  )
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
 *  a modifier is held, or a MODAL is open. Shared by the keyboard-driven hooks.
 *
 *  Formularul din panoul lateral nu se pune: acolo lista rămâne pe ecran, deci
 *  trebuie să rămână și navigabilă de la tastatură — altfel jumătate din
 *  ecranul pe care tocmai l-am câștigat ar fi devenit inertă. Cât timp scrii
 *  în panou nu se ciocnesc oricum: prima condiție prinde orice câmp de text.
 */
function shouldIgnoreKey(e: KeyboardEvent, modalOpen: boolean): boolean {
  const target = e.target as HTMLElement
  if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return true
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  return modalOpen
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

/**
 * Sidebar-ul colapsat, pe desktop. Persistat, fiindcă e o preferință de
 * suprafață de lucru, nu o stare de navigare: cine îl închide ca să aibă
 * lățime nu vrea să-l regăsească deschis la următoarea pornire.
 *
 * Starea trăiește în App, nu în Sidebar: clasa se pune pe `#app`, fiindcă
 * gridul de două coloane e definit acolo, iar butonul care o comută stă în
 * header — altă ramură a arborelui. Sub 900px CSS-ul ignoră clasa complet;
 * pe telefon sidebar-ul nu există, deci nici colapsarea lui.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
  }, [collapsed])
  const toggle = useCallback(() => setCollapsed((c) => !c), [])
  return [collapsed, toggle]
}

/** Layer groups for the active wave, urgent-first, optionally hiding done. */
export function useOrderedLayers(hideDone: boolean): OrderedLayer[] {
  const { layers, byId, blockedByObstacle } = useHorizontal()
  const blockedIds = useMemo(() => new Set(Object.keys(blockedByObstacle)), [blockedByObstacle])
  return useMemo(
    () => buildOrderedLayers(layers, byId, hideDone, blockedIds),
    [layers, byId, hideDone, blockedIds],
  )
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
export interface Selection {
  selectMode: boolean
  selectedIds: Set<string>
  /** Intră în selecție, opțional cu câteva rânduri deja alese (apăsarea lungă). */
  enterSelectMode: (ids?: string[]) => void
  exitSelectMode: () => void
  toggleSelected: (id: string) => void
  /** Un grup întreg: îl alege, sau îl scoate dacă era deja ales tot. */
  toggleMany: (ids: string[]) => void
  setSelected: (ids: string[]) => void
}

/**
 * Selecția multiplă, fără nimic legat de valuri: aceeași stare pentru bara de
 * pe desktop (`useWaveActions`, „Cards"/„Listă") și pentru modul de selecție
 * de pe telefon din listele inteligente — un singur sistem, nu două.
 */
export function useSelection(): Selection {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])
  const enterSelectMode = useCallback((ids?: string[]) => {
    setSelectMode(true)
    if (ids) setSelectedIds(new Set(ids))
  }, [])
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const all = ids.length > 0 && ids.every((id) => prev.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])
  const setSelected = useCallback((ids: string[]) => setSelectedIds(new Set(ids)), [])

  return { selectMode, selectedIds, enterSelectMode, exitSelectMode, toggleSelected, toggleMany, setSelected }
}

export function useWaveActions(): WaveActions {
  const { activeWave, deleteIssues, updateIssue, byId } = useHorizontal()
  const { sheet, dockedIssueId } = useUI()
  const modalOpen = sheet.kind !== 'none' && !dockedIssueId

  const sel = useSelection()
  const { selectMode, selectedIds, toggleSelected } = sel
  const [confirmDel, setConfirmDel] = useState(false)
  const [treeViewActive, setTreeViewActive] = useState(false)
  const [treeHighlightId, setTreeHighlightId] = useState<string | null>(null)

  const exitSelect = sel.exitSelectMode
  const exitSelectMode = useCallback(() => {
    exitSelect()
    setConfirmDel(false)
  }, [exitSelect])

  const enterSelect = sel.enterSelectMode
  const enterSelectMode = useCallback(() => enterSelect(), [enterSelect])

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
      exitSelectMode()
      return true
    })
  }, [exitSelectMode])

  const handleTreeSelect = useCallback((id: string) => {
    setTreeHighlightId((prev) => (prev === id ? null : id))
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

      if (shouldIgnoreKey(e, modalOpen)) return

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        toggleTree()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, confirmDel, treeViewActive, exitSelectMode, exitTreeView, toggleTree, modalOpen])

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
  const { openEditIssue, sheet, dockedIssueId } = useUI()
  const modalOpen = sheet.kind !== 'none' && !dockedIssueId
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
      if (shouldIgnoreKey(e, modalOpen)) return

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
  }, [focusedId, flatLayers, modalOpen, openEditIssue])

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

/**
 * O interogare media ca stare React, resincronizată la montare din același
 * motiv ca `useCoarsePointer`: între citirea inițială și abonare poate trece o
 * redimensionare, iar evenimentul acela s-ar pierde.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * Recunoașterea datei din text, cu refuz pe fragment.
 *
 * Un singur loc pentru cele două inputuri care o folosesc — adăugarea rapidă și
 * titlul tichetului — fiindcă partea grea nu e parsarea, ci refuzul: el trebuie
 * să se lipească de FRAGMENT, nu de starea „am zis nu o dată". Un refuz global
 * se stinge la următoarea tastă, iar fragmentul respins se reaprinde singur.
 *
 * Refuzatele se ascund de parser (`maskRejected`), deci parserul e liber să
 * recunoască altă dată din același text: refuzi „la 11", scrii „la 12", se
 * evidențiază „la 12".
 */
export interface TitleDate {
  /** Ce a înțeles parserul, cu fragmentele refuzate ascunse. */
  parsed: ParsedDue
  /** Textul fără fragmentele recunoscute — ce se salvează ca titlu. */
  title: string
  /** Există o dată recunoscută și nerefuzată. */
  active: boolean
  /** Bucățile pentru stratul-oglindă care desenează evidențierea. */
  pieces: { text: string; mark: boolean }[]
  mirrorRef: React.RefObject<HTMLSpanElement>
  /** Mausul stă peste un fragment evidențiat (pentru cursor și culoare). */
  onDate: boolean
  /** Legăturile inputului transparent de deasupra oglinzii. */
  inputProps: {
    // Uniunea, nu doar `HTMLInputElement`: titlul din formular e un
    // `<textarea>` (se rupe pe mai multe rânduri), adăugarea rapidă a rămas
    // `<input>`. Tot ce atinge handlerul — `value`, `focus`,
    // `setSelectionRange` — există pe amândouă.
    onPointerDown(e: React.PointerEvent<HTMLInputElement | HTMLTextAreaElement>): void
    onPointerMove(e: React.PointerEvent<HTMLInputElement | HTMLTextAreaElement>): void
    onPointerLeave(): void
  }
  /** „Nu e o dată" pentru tot ce e evidențiat acum. */
  rejectAll(): void
  /** Uită refuzurile — la golirea inputului sau după salvare. */
  reset(): void
  /** Cheie stabilă a refuzurilor, pentru listele de dependențe ale efectelor. */
  rejectedKey: string
  /** Refuzurile încă prezente în text — intrarea lui `computeDraft`. */
  live: string[]
}

/**
 * Înghite click-ul care urmează gestului curent. Click-ul vine imediat după
 * ridicarea degetului, deci termenul pornește de acolo, nu de la apăsare (o
 * atingere ținută ar fi trecut de el): dacă nu vine, nu fură următorul click.
 */
function swallowNextClick() {
  let t = setTimeout(() => done(), 5000)
  const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); done() }
  const up = () => { clearTimeout(t); t = setTimeout(() => done(), 400) }
  const done = () => {
    clearTimeout(t)
    window.removeEventListener('click', stop, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', done, true)
  }
  window.addEventListener('click', stop, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', done, true)
}

export function useTitleDate(
  text: string,
  { enabled = true, onChange, initialRejected }: {
    enabled?: boolean
    onChange?(next: string): void
    /**
     * Fragmente refuzate din start. Foaia de tichet le dă pe cele aflate deja
     * în titlu la deschidere (`dateFragments`): „Ședință la 17", scris cândva,
     * e text de-acum, nu o cerere de a muta scadența azi.
     */
    initialRejected?: () => string[]
  } = {},
): TitleDate {
  const [rejected, setRejected] = useState<string[]>(() => initialRejected?.() ?? [])
  const [onDate, setOnDate] = useState(false)
  const mirrorRef = useRef<HTMLSpanElement>(null)

  /**
   * Refuzul ține cât ține fragmentul în text. Ștergi „la 10", refuzul lui se
   * uită; îl scrii din nou, se recunoaște din nou.
   *
   * Fără uitare, refuzul ar fi o pedeapsă pe viață pentru un șir de caractere:
   * ai refuzat o dată „la 10" într-un titlu, și nu mai poți pune niciodată o
   * scadență la 10 în ACELAȘI titlu fără să golești tot.
   */
  const live = liveRejections(text, rejected)
  const liveKey = live.join('\u0001')
  useEffect(() => {
    // Identic ca lungime înseamnă identic: `live` e filtrat chiar din `prev`.
    setRejected((prev) => (prev.length === live.length ? prev : live))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, rejected.length])

  const parsed = parseDue(maskRejected(text, live))
  const active = enabled && parsed.dueAt !== null
  const spans = active ? parsed.spans : []
  // Titlul se taie din textul ORIGINAL, nu din cel mascat: masca are aceeași
  // lungime, deci indicii se potrivesc, dar conținutul ei nu e text de-al omului.
  const title = active ? stripSpans(text, spans) : text.trim()

  const pieces: { text: string; mark: boolean }[] = []
  let at = 0
  for (const [s, e] of spans) {
    if (s > at) pieces.push({ text: text.slice(at, s), mark: false })
    pieces.push({ text: text.slice(s, e), mark: true })
    at = e
  }
  if (at < text.length) pieces.push({ text: text.slice(at), mark: false })

  /**
   * Al câtelea fragment evidențiat cade sub punctul atins, sau −1.
   *
   * Se măsoară dreptunghiurile REALE ale marcajelor din oglindă, nu poziția
   * cursorului din input: un click pe marginea fragmentului dă același indice
   * pentru „înainte" și „după", iar geometria nu are ambiguitatea asta.
   */
  const markAt = (x: number, y: number): number => {
    const marks = mirrorRef.current?.querySelectorAll('mark')
    if (!marks) return -1
    return Array.from(marks).findIndex((el) => {
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    })
  }

  const reject = (frags: string[]) => {
    const fresh = frags.filter((f) => f && !live.includes(f))
    if (fresh.length) setRejected([...live, ...fresh])
    setOnDate(false)
    // Un spațiu la coadă, ca scrisul să continue de unde s-a oprit. Refuzul
    // vine aproape întotdeauna în mijlocul unei propoziții neterminate, iar
    // fără el primul lucru de făcut după refuz ar fi o apăsare de spațiu.
    if (fresh.length && onChange && !/\s$/.test(text)) onChange(text + ' ')
  }

  return {
    parsed,
    title,
    active,
    pieces,
    mirrorRef,
    onDate,
    inputProps: {
      // `pointerdown`, nu `click`: pe telefon degetul ridicat mai la stânga ar
      // rata marcajul pe care a apăsat.
      onPointerDown(e) {
        if (!active) return
        const i = markAt(e.clientX, e.clientY)
        if (i < 0 || !spans[i]) return
        const el = e.currentTarget
        // Atingerea a fost o COMANDĂ, nu o poziționare de cursor. Fără
        // `preventDefault`, cursorul rămâne unde a nimerit degetul — între „1"
        // și „0" din „la 10" — adică în mijlocul textului tocmai eliberat.
        // Sfârșitul rândului e locul din care se scrie mai departe.
        e.preventDefault()
        // …dar pe atingere `preventDefault` nu oprește click-ul de după
        // ridicarea degetului. Refuzul scoate indiciul și jetonul, foaia
        // lipită de jos scade sub deget, iar click-ul cădea pe fundal și o
        // închidea. Click-ul gestului ăstuia e înghițit, oriunde ar cădea.
        swallowNextClick()
        reject([text.slice(spans[i][0], spans[i][1])])
        el.focus()
        // După randare: textul tocmai a crescut cu spațiul de mai sus, iar o
        // poziționare pe valoarea veche ar cădea înaintea lui.
        requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
      },
      // Numai maus: pe atingere n-are ce să însemne „stau deasupra".
      onPointerMove(e) {
        if (e.pointerType !== 'mouse') return
        const over = active && markAt(e.clientX, e.clientY) >= 0
        if (over !== onDate) setOnDate(over)
      },
      onPointerLeave() { if (onDate) setOnDate(false) },
    },
    rejectAll: () => reject(spans.map(([s, e]) => text.slice(s, e))),
    reset: () => { setRejected([]); setOnDate(false) },
    rejectedKey: liveKey,
    live,
  }
}

export interface QuickDraftOptions {
  ctx: QuickCtx
  /** Citește `#proiect @om !` din text și trimite omul și urgența (bara, foaia). */
  tokens?: boolean
}

export interface QuickDraft {
  text: string
  setText(next: string): void
  desc: string
  setDesc(next: string): void
  date: TitleDate
  tokens: CaptureTokens | null
  manual: ManualPick
  setManual: React.Dispatch<React.SetStateAction<ManualPick>>
  /** Proiectul în care se va scrie, sau undefined dacă nu există niciunul permis. */
  project: Project | undefined
  projects: Project[]
  /** Alegerea din selector: bate semnul din text, pentru sarcina asta. */
  pickProject(id: string): void
  schedule: DraftSchedule
  /** Titlul care se va salva (fără dată, fără semne). */
  title: string
  assigneeId: string | null
  urgent: boolean
  /** De ce nu se poate trimite acum, sau null. */
  error: DraftError | null
  saving: boolean
  shake: boolean
  /** Trimite. Întoarce tichetul creat, sau null dacă n-a plecat nimic. */
  submit(): Promise<Issue | null>
  reset(): void
}

/**
 * Starea unei capturi: textul, descrierea, ce s-a ales din butoane, și
 * trimiterea. Un singur hook pentru rândul din listă, bara de captură și foaia
 * rapidă, ca cele trei să nu poată înțelege diferit același text — regulile
 * stau în `lib/quickDraft`, aici doar starea și legătura cu depozitul.
 */
export function useQuickDraft({ ctx, tokens: withTokens = false }: QuickDraftOptions): QuickDraft {
  const { createIssue, assignees } = useHorizontal()
  // Numai proiectele în care se poate scrie: un selector care oferă un proiect
  // read-only ar produce o salvare respinsă de RLS, după ce userul a scris tot.
  const projects = useWritableProjects()
  const [text, setText] = useState('')
  const [desc, setDesc] = useState('')
  const [manual, setManual] = useState<ManualPick>({})
  const [saving, setSaving] = useState(false)
  const [shake, setShake] = useState(false)
  // Recunoașterea datei, cu refuzul legat de fragment — vezi `useTitleDate`.
  const date = useTitleDate(text, { onChange: setText })
  const tokens = withTokens ? parseCaptureTokens(date.title, projects, assignees) : null
  // Regulile — aceeași funcție pe care o rulează fereastra nativă de pe telefon.
  const draft = computeDraft({
    text, desc, rejected: date.live, manual, projects, assignees,
    // Calculat la fiecare randare, nu la montare: proiectele sosesc după
    // primul cadru, iar Inbox trebuie găsit și atunci.
    defaultProjectId: captureDefaultProjectId(ctx, projects), nowMs: Date.now(), tokens: withTokens, ctx,
  })
  const project = projects.find((p) => p.id === draft.projectId)
  const resolved: NewIssue | { error: DraftError } = draft.issue ?? { error: draft.error ?? 'empty' }
  const error = draft.error
  const schedule = { dueAt: draft.dueAt, allDay: draft.allDay, rrule: draft.rrule }

  const reset = () => { setText(''); setDesc(''); date.reset(); setManual({}) }

  // Alegerea trăiește în `manual`, deci `reset` o șterge odată cu restul:
  // sarcina următoare pornește iar din Inbox, nu din ce ai ales adineauri.
  const pickProject = (id: string) => setManual((m) => ({ ...m, projectId: id }))

  const submit = async (): Promise<Issue | null> => {
    if (saving || !project) return null
    if (error === 'empty') return null
    if ('error' in resolved) { setShake(true); setTimeout(() => setShake(false), 320); return null }
    setSaving(true)
    try {
      const created = await createIssue(resolved)
      reset()
      return created
    } finally {
      setSaving(false)
    }
  }

  return {
    text, setText, desc, setDesc, date, tokens, manual, setManual, project, projects, pickProject,
    schedule,
    title: draft.title,
    assigneeId: draft.assigneeId,
    urgent: draft.urgent,
    error, saving, shake, submit, reset,
  }
}

/**
 * Ridică o foaie deasupra tastaturii de pe telefon: scrie `--kb` (cât acoperă
 * tastatura) și `--vvh` (înălțimea vizibilă) pe element.
 *
 * Măsurat, nu presupus. `interactive-widget=resizes-content` micșorează
 * fereastra în Chrome, dar WebView-ul Android cu edge-to-edge forțat (targetSdk
 * 36) poate să n-o facă, iar iOS nu o face niciodată. `keyboardInset` dă 0 în
 * primul caz și exact tastatura în celelalte, deci aceeași foaie merge în toate.
 */
export function useKeyboardInset(ref: React.RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const vv = window.visualViewport
    const apply = () => {
      el.style.setProperty('--kb', `${vv ? keyboardInset(window.innerHeight, vv) : 0}px`)
      el.style.setProperty('--vvh', `${Math.round(vv ? vv.height : window.innerHeight)}px`)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
    }
  }, [ref])
}

export interface AutosaveHandle<T extends Fields> {
  draft: T
  status: AutosaveStatus
  /** Tastare: pleacă după pauză. */
  type(patch: Partial<T>): void
  /** Un jeton atins: pleacă acum. */
  commit(patch: Partial<T>): Promise<boolean>
  /** Trimite ce așteaptă (blur, „…"). */
  flush(): Promise<boolean>
}

/**
 * Legătura dintre `Autosaver` (`lib/autosave.ts`) și React: poza din store
 * intră prin `source`, ciorna iese ca stare. Ce așteaptă pleacă și la
 * demontare (orice închidere: fundal, Back, Esc, „…") și când pagina trece în
 * fundal — pe telefon, comutarea pe altă aplicație e adesea ultimul moment în
 * care pagina mai rulează cod.
 *
 * `source` se compară pe valori (cheia JSON), nu pe identitate: store-ul
 * reconstruiește obiectele de tichet la fiecare reîmprospătare.
 */
export function useAutosave<T extends Fields>(source: T, opts: {
  save(patch: Partial<T>): Promise<void>
  normalize?: Normalize<T>
  delay?: number
}): AutosaveHandle<T> {
  const [, bump] = useState(0)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const saver = useRef<Autosaver<T> | null>(null)
  if (!saver.current) {
    saver.current = new Autosaver<T>({
      initial: source,
      delay: opts.delay,
      normalize: opts.normalize,
      save: (patch) => optsRef.current.save(patch),
      onChange: () => bump((n) => n + 1),
    })
  }
  const s = saver.current
  const sourceKey = JSON.stringify(source)
  useEffect(() => {
    s.receive(JSON.parse(sourceKey) as T)
  }, [s, sourceKey])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void s.flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      void s.flush()
      s.dispose()
    }
  }, [s])
  return {
    draft: s.draft,
    status: s.status,
    type: (patch) => { void s.set(patch, 'debounce') },
    commit: (patch) => s.set(patch, 'now'),
    flush: () => s.flush(),
  }
}
