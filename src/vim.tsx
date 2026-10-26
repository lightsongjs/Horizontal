/**
 * Navigarea din tastatură, ca în Vim / yazi: un singur dispecer de taste, un
 * cursor de listă comun tuturor listelor plate, acțiuni pe rânduri, un cursor
 * de câmp în panou și trei panouri (bara laterală, lista, tichetul docat).
 * Macheta aprobată: `design/vim-nav/index.html`.
 *
 * Totul e condiționat de „Mod Vim" (rotița de setări, pe dispozitiv). Oprit,
 * dispecerul nu face nimic și aplicația se poartă exact ca înainte: tastele
 * vechi (C, O, `,` `.`, V, h j k l din „Listă") își au ascultătorii lor.
 * Pornit, dispecerul ia DOAR tastele pe care le înțelege în contextul de acum
 * (`keymap.ts`) și le oprește acolo; restul trec mai departe la ascultătorii
 * vechi, neatinși.
 *
 * De ce pe `document`, în faza de bubble: o tastă coboară window → document →
 * … → țintă și urcă înapoi țintă → … → document → window. Ascultătorii vechi
 * stau pe `window` la urcare, deci după noi — un `stopPropagation` aici îi
 * oprește exact pe tastele pe care le-am luat. Cei în faza de CAPTURĂ
 * (ChipPop, meniul de rând, ajutorul, galeria) rulează înaintea noastră, deci
 * suprapunerile își păstrează Escape-ul. Handler-ele React (inputurile) stau
 * pe rădăcină, tot înaintea noastră: o tastă tratată acolo (`defaultPrevented`)
 * nu mai e a noastră.
 *
 * Cursorul, selecția și potrivirile nu sunt stări ale rândurilor: un rând nu
 * știe că e sub cursor, iar listele nu se randează la o apăsare de `j`. Inelul
 * e o regulă CSS scrisă pe id (`VimStatus`), iar rândurile se citesc din DOM,
 * în ordinea în care sunt desenate — fixatele, restanțele, zilele, layerele —,
 * fiindcă „următorul" e cel de dedesubt de pe ecran, nu din vreo listă de date
 * care ar putea diverge de randare (evenimentele de calendar, „Terminate azi").
 *
 * Acțiunile pe rânduri trec prin `TaskActions` (`run`, `remove`): aceleași
 * scrieri, aceeași coadă (`enqueueWrite`), aceeași poză pentru anulare ca bara
 * de selecție de pe telefon. Nimic nu scrie pe alt drum.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from './theme'
import { useUI } from './ui'
import { useTaskActions } from './components/TaskActions'
import { ActionMenu } from './components/ActionMenu'
import {
  continuations, EMPTY_SEQ, expire, feed, isTypingTarget, pendingLabel, REPEATABLE, SEQ_TIMEOUT_MS, token,
  WHICH_KEY_DELAY_MS, type ActionId, type FeedResult, type KeyCtx, type SeqState,
} from './lib/keymap'
import * as cur from './lib/cursor'
import { doneTarget, pinTarget, urgentTarget } from './lib/bulkActions'
import { ticketUrl } from './lib/deepLink'
import { isTempIssueId } from './lib/issueId'
import type { Issue } from './lib/types'
import type { MenuAction, MenuLevel } from './lib/actionMenu'
import { useMoveIssue } from './hooks'
import { errorMessage } from './lib/errorMessage'
import { appHistory } from './lib/historyPort'

export type Pane = 'sidebar' | 'list' | 'panel'

/** Cât așteaptă panoul înainte să urmeze cursorul: `jjjj` nu deschide patru tichete. */
export const FOLLOW_DELAY_MS = 120

/**
 * Selecția proprie a unei liste. „Listă" / „Cards" au selecția lor
 * (`useWaveActions`, cu bara de jos); `Space` și `Ctrl+A` trec prin ea, ca cele
 * două să nu se contrazică. Listele inteligente n-au una pe desktop (cea din
 * `TaskActions` e a telefonului), deci acolo selecția e a dispecerului.
 */
export interface SelectionAdapter {
  ids(): string[]
  toggle(id: string): void
  setAll(ids: string[]): void
  clear(): void
}

/**
 * Tichetul docat, văzut de dispecer: câmpurile lui în ordine și ce înseamnă
 * „activează" pe fiecare. Îl anunță formularul (`IssueForm`, numai docat),
 * fiindcă doar el îi știe starea locală (urgentul nesalvat, popoverul deschis,
 * editorul descrierii). Dispecerul nu umblă prin DOM-ul formularului după
 * controale — doar le găsește ca să le încercuiască.
 */
export interface PanelAdapter {
  issueId: string
  /**
   * Inelul, în ordine: titlu → jetoane (UN popas; Enter = meniul de acțiuni)
   * → descriere → fiecare dependență → fir. Controalele din antet (fixarea,
   * jetonul de proiect) nu sunt în inel: au literele lor (`F`, `M`) și meniul.
   */
  fields(): string[]
  /** Titlul, descrierea, firul, o dependență. Jetoanele le deschide dispecerul (meniul). */
  activate(field: string): void
  focusTitle(selectAll: boolean): void
  focusDesc(): void
  focusComposer(handoff: boolean): void
  title(): string
  dirty(): boolean
}

/**
 * Meniul de acțiuni (`m`), deschis pe ținte fixate la deschidere. `anchor`:
 * rândul sub care stă (listă) sau null = sub jetoanele panoului. `fromRoot`:
 * deschis pe primul nivel (`m`), deci Esc dintr-un sub-meniu urcă; deschis
 * direct pe un sub-meniu (`t`, `M`, `w`), Esc închide.
 */
export interface MenuState { level: MenuLevel; ids: string[]; anchor: string | null; fromRoot: boolean }

/** Căutarea în listă (`/`) sau filtrul (`f`). */
export interface FindState { mode: 'find' | 'filter'; query: string; open: boolean }

interface VimApi {
  /** O listă plată (o face `SplitView`) anunță că are rânduri pentru cursor. */
  registerCursorHost(): () => void
  /** „Listă": arborele / confirmarea ștergerii au Escape-ul lor — cât sunt pornite, dispecerul nu-l ia. */
  setListBusy(fn: (() => boolean) | null): void
  setSelectionAdapter(a: SelectionAdapter | null): void
  /** Formularul docat se anunță. Întoarce dezabonarea. */
  registerPanel(get: () => PanelAdapter | null): () => void
  getCursor(): string | null
  setCursor(id: string | null): void
  /**
   * Modul „× Valuri” (tabul Teme) se anunță: cât e montat, lista e `grid`, iar
   * `h` / `l` / `0` / `$` mută tichetul între valuri. `to` întoarce valul în
   * care ajunge tichetul, sau null (e deja acolo / la capăt).
   */
  registerGrid(to: GridTarget): () => void
}

/** Valul în care ajunge tichetul `id` la o tastă din „× Valuri”. */
export type GridTarget = (id: string, where: 'left' | 'right' | 'first' | 'last') => number | null

interface VimState {
  enabled: boolean
  cursorId: string | null
  pane: Pane
  /** „5", „g…" — ce s-a tastat și așteaptă continuarea. */
  pending: string
  /** Continuările prefixului, după o ezitare. */
  whichKey: { prefix: string; items: { rest: string; desc: string }[] } | null
  /** Un mesaj scurt, fără clipire: „panoul rămâne pe HZ-12 — nesalvat". */
  hint: string | null
  /** Rândurile alese de dispecer (Space, intervalul vizual) — desenate ca `.selected`. */
  selIds: string[]
  visual: boolean
  find: FindState | null
  /** Potrivirile căutării / filtrului de acum. */
  matches: string[]
  menu: MenuState | null
}

const ApiCtx = createContext<VimApi | null>(null)
const StateCtx = createContext<VimState | null>(null)
/** Câmpul de sub cursorul panoului, separat: doar formularul docat îl citește. */
const FieldCtx = createContext<string | null>(null)

interface Internal {
  hostCount: React.MutableRefObject<number>
  listBusy: React.MutableRefObject<(() => boolean) | null>
  selAdapter: React.MutableRefObject<SelectionAdapter | null>
  panel: React.MutableRefObject<(() => PanelAdapter | null) | null>
  grid: React.MutableRefObject<GridTarget | null>
  cursorRef: React.MutableRefObject<string | null>
  fieldRef: React.MutableRefObject<string | null>
  findRef: React.MutableRefObject<FindState | null>
  setCursorId(id: string | null): void
  setField(f: string | null): void
  setPane(p: Pane): void
  setPending(s: string): void
  setWhichKey(w: VimState['whichKey']): void
  setHint(h: string | null): void
  setSel(ids: string[], visual: boolean): void
  setFind(f: FindState | null): void
  setMatches(ids: string[]): void
  setMenu(m: MenuState | null): void
  /** Execută un rând ales din meniu — îl pune dispecerul, îl cheamă `ActionMenu`. */
  menuExec: React.MutableRefObject<((a: MenuAction, ids: string[]) => void) | null>
}
const InternalCtx = createContext<Internal | null>(null)

export function VimProvider({ children }: { children: ReactNode }) {
  const { vim } = useTheme()
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [field, setFieldState] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')
  const [pending, setPending] = useState('')
  const [whichKey, setWhichKey] = useState<VimState['whichKey']>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [sel, setSelState] = useState<{ ids: string[]; visual: boolean }>({ ids: [], visual: false })
  const [find, setFindState] = useState<FindState | null>(null)
  const [matches, setMatches] = useState<string[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuExec = useRef<((a: MenuAction, ids: string[]) => void) | null>(null)
  const hostCount = useRef(0)
  const listBusy = useRef<(() => boolean) | null>(null)
  const selAdapter = useRef<SelectionAdapter | null>(null)
  const panel = useRef<(() => PanelAdapter | null) | null>(null)
  const grid = useRef<GridTarget | null>(null)
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursorId
  const fieldRef = useRef<string | null>(null)
  fieldRef.current = field
  const findRef = useRef<FindState | null>(null)
  findRef.current = find

  const api = useMemo<VimApi>(() => ({
    registerCursorHost: () => {
      hostCount.current += 1
      return () => { hostCount.current -= 1 }
    },
    setListBusy: (fn) => { listBusy.current = fn },
    setSelectionAdapter: (a) => { selAdapter.current = a },
    registerPanel: (get) => {
      panel.current = get
      return () => { if (panel.current === get) panel.current = null }
    },
    getCursor: () => cursorRef.current,
    setCursor: (id) => { cursorRef.current = id; setCursorId(id) },
    registerGrid: (to) => {
      grid.current = to
      return () => { if (grid.current === to) grid.current = null }
    },
  }), [])

  const internal = useMemo<Internal>(() => ({
    hostCount, listBusy, selAdapter, panel, grid, cursorRef, fieldRef, findRef, menuExec,
    setCursorId: (id) => { cursorRef.current = id; setCursorId(id) },
    setField: (f) => { fieldRef.current = f; setFieldState(f) },
    setPane, setPending, setWhichKey, setHint,
    setSel: (ids, visual) => setSelState({ ids, visual }),
    setFind: (f) => { findRef.current = f; setFindState(f) },
    setMatches, setMenu,
  }), [])

  // Oprit în timpul lucrului: nimic nu rămâne agățat (inel, pastilă, mesaj).
  useEffect(() => {
    if (vim) return
    internal.setCursorId(null)
    internal.setField(null)
    internal.setSel([], false)
    internal.setFind(null)
    setMatches([])
    setMenu(null)
    setPending('')
    setWhichKey(null)
    setHint(null)
  }, [vim, internal])

  const state = useMemo<VimState>(
    () => ({ enabled: vim, cursorId, pane, pending, whichKey, hint, selIds: sel.ids, visual: sel.visual, find, matches, menu }),
    [vim, cursorId, pane, pending, whichKey, hint, sel, find, matches, menu],
  )

  return (
    <ApiCtx.Provider value={api}>
      <InternalCtx.Provider value={internal}>
        <FieldCtx.Provider value={vim ? field : null}>
          <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
        </FieldCtx.Provider>
      </InternalCtx.Provider>
    </ApiCtx.Provider>
  )
}

/** API-ul stabil (nu se schimbă la o mișcare de cursor): pentru liste și rânduri. */
export function useVim(): VimApi {
  const ctx = useContext(ApiCtx)
  if (!ctx) throw new Error('useVim must be used within VimProvider')
  return ctx
}

/** Fără provider (bara de captură, teste de componente): nimic de anunțat. */
const NOOP_API: VimApi = {
  registerCursorHost: () => () => {},
  registerGrid: () => () => {},
  setListBusy: () => {},
  setSelectionAdapter: () => {},
  registerPanel: () => () => {},
  getCursor: () => null,
  setCursor: () => {},
}
export function useVimOptional(): VimApi {
  return useContext(ApiCtx) ?? NOOP_API
}


/** „Listă": arborele și confirmarea ștergerii păstrează Escape-ul pentru ele. */
export function useVimListBusy(busy: boolean) {
  const api = useVimOptional()
  const ref = useRef(busy)
  ref.current = busy
  useEffect(() => {
    api.setListBusy(() => ref.current)
    return () => api.setListBusy(null)
  }, [api])
}

/** Selecția proprie a vizualizării (`useWaveActions`), prin ref: mereu cea de acum. */
export function useVimSelection(adapter: SelectionAdapter) {
  const api = useVimOptional()
  const ref = useRef(adapter)
  ref.current = adapter
  useEffect(() => {
    api.setSelectionAdapter({
      ids: () => ref.current.ids(),
      toggle: (id) => ref.current.toggle(id),
      setAll: (ids) => ref.current.setAll(ids),
      clear: () => ref.current.clear(),
    })
    return () => api.setSelectionAdapter(null)
  }, [api])
}

/**
 * Formularul docat se anunță. Adaptorul stă într-un ref completat la randare
 * (metodele lui folosesc stări definite mai jos în formular), iar dispecerul
 * îl citește la apăsare — mereu pe cel de acum.
 */
export function useVimPanel(ref: React.RefObject<PanelAdapter | null>, on: boolean) {
  const api = useVimOptional()
  useEffect(() => {
    if (!on) return
    return api.registerPanel(() => ref.current)
  }, [api, on, ref])
}

// ─── DOM: rânduri, panouri, câmpuri ────────────────────────────────────────

type Row = cur.CursorRow & { el: HTMLElement; title: string }

/** Rândurile listei de pe ecran, în ordinea desenării. Nu cele din panou, nici cele ascunse (filtrul `f`). */
export function readRows(includeHidden = false): Row[] {
  const els = [...document.querySelectorAll<HTMLElement>('main .list-row[data-issue-id]')]
    .filter((el) => !el.closest('.split-pane') && (includeHidden || el.getClientRects().length > 0))
  const groups = new Map<Element, string>()
  return els.map((el) => {
    const g = el.closest('.list-group')
    let key = 'loose'
    if (g) {
      if (!groups.has(g)) groups.set(g, `g${groups.size}`)
      key = groups.get(g)!
    }
    const title = el.querySelector('.list-title')?.textContent ?? ''
    return { id: el.getAttribute('data-issue-id')!, group: key, el, title }
  })
}

const rowEl = (id: string) => readRows().find((r) => r.id === id)?.el ?? null

function paneOf(el: Element | null): Pane {
  if (el?.closest?.('.split-pane')) return 'panel'
  if (el?.closest?.('.sidebar')) return 'sidebar'
  return 'list'
}

/** Unde e un câmp al panoului pe ecran: inelul și derularea îl caută aici. */
export function fieldSelector(f: string): string {
  if (f === 'title') return '.split-pane .sh-title-wrap'
  if (f === 'chips') return '.split-pane .fc-row'
  if (f === 'desc') return '.split-pane .form-col-desc .desc-box'
  if (f === 'comment') return '.split-pane .thread-compose'
  return `.split-pane [data-vf="${CSS.escape(f)}"]`
}

/** Elementele de navigare ale barei laterale, în ordinea de pe ecran. */
function sidebarItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.sidebar .sidebar-search, .sidebar .sidebar-nav-item, .sidebar .sidebar-proj-btn')]
    .filter((el) => el.offsetParent !== null)
}

/** O suprapunere deschisă (popover de jeton, meniu de rând, galerie, confirmarea închiderii) își ține tastele. */
function overlayOpen(): boolean {
  return !!document.querySelector('.am-menu, .fc-pop, .ctx-menu, .lb-back, .ccm-overlay, .qs-overlay, .kb-sheet')
}

/** Ce se poate focusa într-un popover, în ordine: j / k trec prin ele. */
function popFocusables(pop: Element): HTMLElement[] {
  return [...pop.querySelectorAll<HTMLElement>('button:not([disabled]), input.native-pick-input, [role^="menuitem"]')]
    .filter((el, i, all) => all.indexOf(el) === i && el.getClientRects().length > 0)
}

function blurActive() {
  const a = document.activeElement as HTMLElement | null
  if (a && a !== document.body) a.blur()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    return ok
  }
}

/** Așteaptă până apare ceva (panoul după o deschidere, formularul după docare). */
function waitFor<T>(get: () => T | null | undefined, then: (v: T) => void, tries = 40) {
  const v = get()
  if (v) { then(v); return }
  if (tries <= 0) return
  window.setTimeout(() => waitFor(get, then, tries - 1), 50)
}

// ─── dispecerul ────────────────────────────────────────────────────────────

/** Ce știe doar Shell-ul: navigarea, foile, starea ecranului. */
export interface DispatchActions {
  /** O foaie modală, căutarea, ajutorul, paleta, sertarul: tastele nu sunt ale noastre. */
  blocked(): boolean
  /** Pe ecranul unui proiect, 1–4 sunt taburile, nu o numărătoare. */
  digitTabs(): boolean
  goTop(screen: 'today' | 'week' | 'inbox'): void
  openGoTo(): void
  openSearch(): void
  toggleHelp(): void
  toggleSidebar(): void
  sidebarCollapsed(): boolean
  openSettings(): void
  /** Anularea oferită de toastul de acum (acțiune din listă, bifă recurentă). Fals = n-a fost nimic. */
  undo(): boolean
  /** Sarcină nouă lângă rândul cursorului: aceeași zi într-o listă, valul activ într-un proiect. */
  newTask(near: Issue | undefined): void
}

export function useKeyDispatcher(actions: DispatchActions) {
  const { vim, follow } = useTheme()
  const ui = useUI()
  const ta = useTaskActions()
  const internal = useContext(InternalCtx)
  if (!internal) throw new Error('useKeyDispatcher must be used within VimProvider')

  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const uiRef = useRef(ui)
  uiRef.current = ui
  const taRef = useRef(ta)
  taRef.current = ta
  const move = useMoveIssue()
  const moveRef = useRef(move)
  moveRef.current = move
  const followRef = useRef(follow)
  followRef.current = follow

  const seq = useRef<SeqState>(EMPTY_SEQ)
  const seqTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Contextul în care a pornit secvența, ca timeout-ul să rezolve în același.
  const seqCtx = useRef<Exclude<KeyCtx, 'any'> | null>(null)
  // Selecția dispecerului (listele inteligente) și intervalul vizual.
  const marked = useRef<string[]>([])
  const visualAnchor = useRef<string | null>(null)
  const lastAction = useRef<ActionId | null>(null)

  const clearSeq = useCallback(() => {
    seq.current = EMPTY_SEQ
    if (seqTimer.current) clearTimeout(seqTimer.current)
    if (wkTimer.current) clearTimeout(wkTimer.current)
    seqTimer.current = wkTimer.current = null
    internal.setPending('')
    internal.setWhichKey(null)
  }, [internal])

  // Panoul se urmărește prin focus: orice mutare (mouse, Tab, dispecer) îl actualizează.
  useEffect(() => {
    if (!vim) return
    const sync = () => internal.setPane(paneOf(document.activeElement))
    const onOut = () => window.setTimeout(sync, 0)
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', onOut)
    sync()
    return () => {
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', onOut)
    }
  }, [vim, internal])

  // Alt tichet docat: cursorul de câmp pornește de la capăt.
  useEffect(() => { internal.setField(null) }, [ui.dockedIssueId, internal])

  // …și cursorul de rând îl urmează. Panoul urmează cursorul (j/k), dar un
  // tichet docat pe ALT drum (căutare, deep link, „Mergi la", un card de
  // dependență, o captură) lăsa cursorul pe rândul vechi: `dd`, `x`, `t`… loveau
  // atunci un rând nevăzut, nu tichetul deschis — toastul spunea „Șters", iar
  // tichetul din panou rămânea pe loc. Doar la o schimbare a tichetului docat:
  // cu formularul murdar cursorul merge singur și panoul stă (asta rămâne).
  useEffect(() => {
    if (!vim || !ui.dockedIssueId) return
    if (internal.cursorRef.current !== ui.dockedIssueId) internal.setCursorId(ui.dockedIssueId)
  }, [vim, ui.dockedIssueId, internal])

  // Un click pe rând (mouse) mută și cursorul acolo, ca tastatura să continue
  // de unde ai ales — și ia focusul de pe buton, ca Enter / Space să rămână ale
  // dispecerului (altfel butonul s-ar fi apăsat singur). Un click în bara
  // laterală care schimbă ecranul lasă focusul înapoi în listă.
  useEffect(() => {
    if (!vim) return
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted) return
      const t = e.target as Element | null
      const row = t?.closest?.('main .list-row[data-issue-id]') as HTMLElement | null
      if (row && !row.closest('.split-pane')) {
        internal.setCursorId(row.getAttribute('data-issue-id'))
        window.setTimeout(() => { if (document.activeElement === row) row.blur() }, 0)
        return
      }
      if (e.detail > 0 && t?.closest?.('.sidebar .sidebar-nav-item, .sidebar .sidebar-proj-btn')) {
        window.setTimeout(blurActive, 0)
      }
    }
    // Și focusul de tastatură (Tab) pe un rând îl face cursor: F, x… pe el.
    const onFocus = (e: FocusEvent) => {
      const row = (e.target as Element | null)?.closest?.('main .list-row[data-issue-id]')
      if (row && !row.closest('.split-pane')) internal.setCursorId(row.getAttribute('data-issue-id'))
    }
    document.addEventListener('click', onClick)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('focusin', onFocus)
    }
  }, [vim, internal])

  // Formularul docat s-a salvat (sau și-a pierdut modificările): panoul
  // prinde cursorul din urmă, dacă trebuia să-l urmeze și n-a putut.
  useEffect(() => {
    if (!vim) return
    return ui.subscribeDockedDirty((dirty) => {
      if (dirty) return
      internal.setHint(null)
      // După randare: „curat" vine și când formularul se demontează (panoul
      // închis, modificările aruncate) — atunci nu mai e nimic de urmat.
      window.setTimeout(() => {
        const id = internal.cursorRef.current
        const docked = uiRef.current.dockedIssueId
        if (!followRef.current || !id || !docked || id === docked) return
        if (uiRef.current.isDockedDirty()) return
        if (paneOf(document.activeElement) !== 'list') return
        rowEl(id)?.click()
      }, 50)
    })
  }, [vim, ui, internal])

  // „Către…" din fir (pasarea): meniul e al mouse-ului, iar focusul stă în
  // casetă — Enter ar trimite comentariul. În CAPTURĂ, înaintea casetei:
  // săgețile aleg, Enter alege, Esc închide meniul.
  useEffect(() => {
    if (!vim) return
    const onKey = (e: KeyboardEvent) => {
      const menu = document.querySelector('.split-pane .thread-to-menu')
      if (!menu || !document.activeElement?.closest('.split-pane .thread-compose')) return
      const items = [...menu.querySelectorAll<HTMLElement>('.dep-dd-item:not([disabled])')]
      if (!items.length) return
      const at = items.findIndex((el) => el.hasAttribute('data-vim-hl'))
      const mark = (i: number) => items.forEach((el, k) => el.toggleAttribute('data-vim-hl', k === i))
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        mark(at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter' && at >= 0) {
        e.preventDefault(); e.stopPropagation()
        items[at].click()
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        document.querySelector<HTMLElement>('.split-pane .thread-to-btn')?.click()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [vim])

  useEffect(() => {
    if (!vim) { clearSeq(); return }

    const toast = (m: string) => uiRef.current.showToast(m)
    const scrollTo = (id: string) => rowEl(id)?.scrollIntoView({ block: 'nearest' })
    const panel = () => {
      const p = internal.panel.current?.() ?? null
      return p && p.issueId === uiRef.current.dockedIssueId ? p : null
    }

    // ── selecția: intervalul vizual > selecția (a listei sau a dispecerului) > cursorul ──
    const publishSel = (rows: cur.CursorRow[]) => {
      const vis = visualAnchor.current ? cur.rangeBetween(rows, visualAnchor.current, internal.cursorRef.current) : []
      internal.setSel([...new Set([...marked.current, ...vis])], !!visualAnchor.current)
    }
    const clearSel = () => {
      visualAnchor.current = null
      marked.current = []
      internal.selAdapter.current?.clear()
      internal.setSel([], false)
    }
    const hasSel = () => !!visualAnchor.current || marked.current.length > 0 || (internal.selAdapter.current?.ids().length ?? 0) > 0

    /** Cursorul de pornire: cel de acum, altfel rândul docat (dacă e pe ecran). */
    const current = (rows: cur.CursorRow[]): string | null => {
      const c = internal.cursorRef.current
      if (c && rows.some((r) => r.id === c)) return c
      const d = uiRef.current.dockedIssueId
      if (d && rows.some((r) => r.id === d)) return d
      return null
    }

    const targets = (rows: cur.CursorRow[]): string[] => {
      if (visualAnchor.current) return cur.rangeBetween(rows, visualAnchor.current, current(rows))
      const own = internal.selAdapter.current?.ids() ?? []
      if (own.length) return own
      if (marked.current.length) return marked.current
      const t = taRef.current
      if (t.narrow && t.selectMode && t.selectedIds.size) return [...t.selectedIds]
      const c = current(rows)
      return c ? [c] : []
    }

    /** Tichetul docat, murdar, printre ținte: comutarea l-ar remonta și s-ar pierde ce ai scris. */
    const dirtyBlocks = (ids: string[]): boolean => {
      const u = uiRef.current
      if (!u.dockedIssueId || !ids.includes(u.dockedIssueId) || !u.isDockedDirty()) return false
      u.nudgeSave()
      internal.setHint(`${u.dockedIssueId} are modificări nesalvate · Ctrl+S`)
      return true
    }

    /** După o acțiune care scoate rânduri, cursorul trece pe vecinul celui ieșit. */
    const settleAfter = (before: cur.CursorRow[]) => {
      const fix = () => {
        const id = internal.cursorRef.current
        const rows = readRows()
        if (!id || rows.some((r) => r.id === id)) return
        internal.setCursorId(cur.neighborAfterRemove(before, rows, id))
      }
      window.setTimeout(fix, 300)
      window.setTimeout(fix, 1200)
    }

    /** Deschide rândul exact pe drumul unui click: fiecare listă își are `onOpen`-ul ei. */
    const openRow = (id: string): boolean => {
      const u = uiRef.current
      if (u.dockedIssueId && u.dockedIssueId !== id && u.isDockedDirty()) {
        u.nudgeSave()
        internal.setHint(`Panoul rămâne pe ${u.dockedIssueId} — nesalvat · Ctrl+S`)
        return false
      }
      if (u.dockedIssueId === id) return true
      const el = rowEl(id)
      if (!el) return false
      el.click()
      return true
    }

    const moveCursor = (id: string | null) => {
      if (!id) return
      internal.setCursorId(id)
      scrollTo(id)
      if (visualAnchor.current) { publishSel(readRows()); return }
      if (followTimer.current) clearTimeout(followTimer.current)
      const u = uiRef.current
      const docked = u.dockedIssueId
      if (!docked || docked === id) { internal.setHint(null); return }
      if (!followRef.current) return
      if (internal.listBusy.current?.() || hasSel()) return
      // Murdar: cursorul merge, panoul stă. Un singur mesaj, care rămâne cât
      // ține starea — nu o clipire la fiecare tastă.
      if (u.isDockedDirty()) {
        internal.setHint(`Panoul rămâne pe ${docked} — nesalvat · Ctrl+S`)
        return
      }
      followTimer.current = setTimeout(() => {
        followTimer.current = null
        if (internal.cursorRef.current !== id) return
        if (uiRef.current.isDockedDirty()) return
        rowEl(id)?.click()
      }, FOLLOW_DELAY_MS)
    }

    const focusPanel = () => {
      const pane = document.querySelector<HTMLElement>('.split-pane:not([hidden])')
      if (!pane) return false
      pane.focus({ preventScroll: true })
      if (!internal.fieldRef.current) internal.setField('title')
      return true
    }

    const setField = (f: string | null) => {
      internal.setField(f)
      if (f) document.querySelector(fieldSelector(f))?.scrollIntoView({ block: 'nearest' })
    }

    const focusSidebar = (pick?: (items: HTMLElement[], ix: number) => HTMLElement | undefined) => {
      const items = sidebarItems()
      if (!items.length) return
      const a = document.activeElement as HTMLElement | null
      let ix = a ? items.indexOf(a) : -1
      if (ix < 0) ix = items.findIndex((el) => el.classList.contains('on') || !!el.closest('.on'))
      const target = pick ? pick(items, ix) : items[Math.max(0, ix)]
      target?.focus()
    }

    const wave = (detail: { dir?: 1 | -1; manage?: boolean }) => {
      const ev = new CustomEvent<{ dir?: 1 | -1; manage?: boolean; handled: boolean }>('hz:wave', { detail: { ...detail, handled: false } })
      window.dispatchEvent(ev)
      if (!ev.detail.handled) toast('Valurile sunt într-un proiect (Listă sau Cards)')
    }

    const yank = async (id: string, what: 'link' | 'title', title?: string) => {
      if (what === 'link' && isTempIssueId(id)) { toast('Linkul apare după sincronizare'); return }
      const text = what === 'link' ? ticketUrl(window.location.origin, id) : (title ?? '')
      const ok = await copyText(text)
      toast(ok ? `${what === 'link' ? 'Link copiat' : 'Titlu copiat'} · ${id}` : 'Nu am putut copia')
    }

    /** Redenumirea: tichetul în panou (sau modal), titlul selectat. */
    const rename = (id: string) => {
      if (!openRow(id)) return
      waitFor(
        () => panel()?.issueId === id ? panel() : (document.querySelector<HTMLTextAreaElement>('.sheet.on .sh-title-input') ? 'modal' as const : null),
        (p) => {
          if (p === 'modal') {
            const el = document.querySelector<HTMLTextAreaElement>('.sheet.on .sh-title-input')
            el?.focus(); el?.select()
          } else {
            p.focusTitle(true)
            internal.setField('title')
          }
        },
      )
    }

    const openMenu = (level: MenuLevel, ids: string[], anchor: string | null, fromRoot: boolean) => {
      if (!ids.length) { internal.setHint('Niciun rând sub cursor'); return }
      internal.setMenu({ level, ids, anchor, fromRoot })
    }

    /** Pasarea: tichetul în panou, caseta firului cu „către…" deschis. */
    const handoff = (id: string) => {
      if (!openRow(id)) return
      waitFor(() => (panel()?.issueId === id ? panel() : null), (p) => { internal.setField('comment'); p.focusComposer(true) })
    }

    /**
     * Un rând ales din meniul de acțiuni, pe țintele de la deschidere. Aceleași
     * drumuri ca tastele directe: `TaskActions` (anulare, coadă), refuzul pe
     * formularul docat murdar, ieșirea din selecție, cursorul pe vecin.
     */
    internal.menuExec.current = (a: MenuAction, ids: string[]) => {
      const t = taRef.current
      const rows = readRows()
      const done = () => { clearSel(); settleAfter(rows) }
      const formField = a.kind === 'date' || a.kind === 'urgent' || a.kind === 'delete' || a.kind === 'wave' || a.kind === 'move'
      if (formField && dirtyBlocks(ids)) return
      switch (a.kind) {
        case 'urgent': case 'pin': case 'done': case 'delete':
          if (rowAction(a.kind, rows, ids)) lastAction.current = a.kind
          return
        case 'date':
          if (a.preset.kind === 'tomorrow') { if (rowAction('tomorrow', rows, ids)) lastAction.current = 'tomorrow'; return }
          void t.run({ kind: 'date', preset: a.preset }, ids); done(); return
        case 'wave': void t.run({ kind: 'wave', value: a.value }, ids); done(); return
        case 'move': {
          const id = ids[0]
          const docked = uiRef.current.dockedIssueId === id
          clearSel()
          moveRef.current(id, a.projectId, { open: docked, remount: docked }).catch((e) => toast(errorMessage(e)))
          return
        }
        case 'rename': clearSel(); rename(ids[0]); return
        case 'yank': void yank(ids[0], 'link'); return
        case 'handoff': clearSel(); handoff(ids[0]); return
        case 'sub': case 'calendar': return
      }
    }

    /** O acțiune pe rânduri. Întoarce dacă a făcut ceva (pentru `.`). */
    const rowAction = (id: ActionId, rows: Row[], explicit?: string[]): boolean => {
      const t = taRef.current
      const ids = explicit ?? targets(rows)
      if (!ids.length) { internal.setHint('Niciun rând sub cursor'); return false }
      const issues = t.issuesOf(ids)
      const before = rows
      const done = () => { clearSel(); settleAfter(before) }
      switch (id) {
        case 'done':
          void t.run({ kind: 'done', value: doneTarget(issues) }, ids); done(); return true
        case 'pin':
          void t.run({ kind: 'pin', value: pinTarget(issues) }, ids); done(); return true
        case 'urgent':
          if (dirtyBlocks(ids)) return false
          void t.run({ kind: 'urgent', value: urgentTarget(issues) }, ids); done(); return true
        case 'tomorrow':
          if (dirtyBlocks(ids)) return false
          void t.run({ kind: 'date', preset: { kind: 'tomorrow' } }, ids); done(); return true
        case 'delete': {
          if (dirtyBlocks(ids)) return false
          const u = uiRef.current
          // Tichetul docat dispare din listă: panoul se închide odată cu el (e curat, deci garda nu întreabă).
          if (u.dockedIssueId && ids.includes(u.dockedIssueId) && !u.closeSheet()) return false
          t.remove(ids); done(); return true
        }
        case 'date':
          if (dirtyBlocks(ids)) return false
          openMenu('date', ids, explicit ? null : current(rows) ?? ids[0], false)
          return false
        case 'move':
          if (ids.length !== 1) { toast('Se mută câte un tichet — alege unul singur'); return false }
          if (dirtyBlocks(ids)) return false
          openMenu('move', ids, explicit ? null : ids[0], false)
          return false
        default:
          return false
      }
    }

    const run = (id: ActionId, count: number) => {
      const a = actionsRef.current
      const rows = readRows()
      switch (id) {
        case 'goToday': a.goTop('today'); return
        case 'goWeek': a.goTop('week'); return
        case 'goMine': a.goTop('inbox'); return
        case 'goTo': a.openGoTo(); return
        case 'search': a.openSearch(); return
        case 'help': a.toggleHelp(); return
        case 'settings': a.openSettings(); return
        case 'toggleSidebar':
          if (!a.sidebarCollapsed() && paneOf(document.activeElement) === 'sidebar') blurActive()
          a.toggleSidebar()
          return
        case 'historyBack': appHistory.back(); return
        case 'historyForward': appHistory.forward(); return
        case 'undo': if (!a.undo()) toast('Nimic de anulat'); else settleAfter(rows); return
        case 'wavePrev': wave({ dir: -1 }); return
        case 'waveNext': wave({ dir: 1 }); return
        case 'waveManage': wave({ manage: true }); return

        // listă: mișcări
        case 'down': moveCursor(cur.step(rows, current(rows), 1, count)); return
        case 'up': moveCursor(cur.step(rows, current(rows), -1, count)); return
        case 'groupDown': moveCursor(cur.stepGroup(rows, current(rows), 1, count)); return
        case 'groupUp': moveCursor(cur.stepGroup(rows, current(rows), -1, count)); return
        case 'first': moveCursor(cur.first(rows)); return
        case 'last': moveCursor(cur.last(rows)); return
        case 'open': {
          const c = current(rows) ?? cur.first(rows)
          if (!c) return
          internal.setCursorId(c)
          openRow(c)
          return
        }
        case 'toPanel': {
          if (uiRef.current.dockedIssueId) { focusPanel(); return }
          const c = current(rows) ?? cur.first(rows)
          if (!c) return
          internal.setCursorId(c)
          if (!openRow(c)) return
          // Panoul apare după randare (și după încărcarea proiectului, pentru
          // o sarcină dintr-o listă inteligentă): îl așteptăm puțin.
          waitFor(() => document.querySelector('.split-pane:not([hidden]) .sh-header'), () => focusPanel())
          return
        }
        // „× Valuri”: tichetul (sau selecția) în valul vecin. Rândul nu iese din
        // listă, deci cursorul rămâne pe loc. Valul e un câmp al formularului:
        // pe tichetul docat murdar, refuzat ca data sau urgentul.
        case 'waveLeft': case 'waveRight': case 'waveFirst': case 'waveLast': {
          const to = internal.grid.current
          if (!to) return
          const ids = targets(rows)
          if (!ids.length) { internal.setHint('Niciun rând sub cursor'); return }
          if (dirtyBlocks(ids)) return
          const where = id === 'waveLeft' ? 'left' : id === 'waveRight' ? 'right' : id === 'waveFirst' ? 'first' : 'last'
          const dest = to(current(rows) ?? ids[0], where)
          if (dest === null) { internal.setHint(where === 'left' || where === 'first' ? 'E deja în prima coloană' : 'E deja în ultima coloană'); return }
          internal.setHint(null)
          void taRef.current.run({ kind: 'wave', value: dest }, ids)
          clearSel()
          return
        }
        case 'toSidebar':
          if (a.sidebarCollapsed()) { a.toggleSidebar(); window.setTimeout(() => focusSidebar(), 0) }
          else focusSidebar()
          return

        // listă: acțiuni
        case 'done': case 'pin': case 'urgent': case 'tomorrow': case 'delete': case 'date': case 'move':
          if (rowAction(id, rows) && REPEATABLE.has(id)) lastAction.current = id
          return
        case 'repeat':
          if (!lastAction.current) { toast('Nimic de repetat'); return }
          rowAction(lastAction.current, rows)
          return
        case 'rename': { const c = current(rows); if (c) rename(c); return }
        case 'menu': {
          // Din panou: tichetul deschis. Din listă: intervalul > selecția > rândul.
          if (paneOf(document.activeElement) === 'panel') {
            const p = panel()
            if (p) openMenu('root', [p.issueId], null, true)
            return
          }
          const ids = targets(rows)
          openMenu('root', ids, current(rows) ?? ids[0] ?? null, true)
          return
        }
        case 'yankLink': case 'yankTitle': {
          const c = current(rows) ?? targets(rows)[0]
          if (!c) return
          void yank(c, id === 'yankLink' ? 'link' : 'title', rows.find((r) => r.id === c)?.title)
          return
        }
        case 'find': case 'filter':
          internal.setFind({ mode: id, query: id === internal.findRef.current?.mode ? internal.findRef.current.query : '', open: true })
          return
        case 'nextMatch': case 'prevMatch': {
          const q = internal.findRef.current?.query ?? ''
          if (!q) { toast('Întâi / și un text'); return }
          const m = cur.matching(rows, q)
          if (!m.length) { toast(`Nicio potrivire pentru „${q}"`); return }
          moveCursor(cur.nextMatch(rows, m, current(rows), id === 'nextMatch' ? 1 : -1, count))
          return
        }
        case 'mark': {
          const c = current(rows) ?? cur.first(rows)
          if (!c) return
          const own = internal.selAdapter.current
          if (own) own.toggle(c)
          else marked.current = marked.current.includes(c) ? marked.current.filter((x) => x !== c) : [...marked.current, c]
          internal.setCursorId(c)
          moveCursor(cur.step(rows, c, 1, 1))
          publishSel(readRows())
          return
        }
        case 'visual': {
          if (visualAnchor.current) { visualAnchor.current = null; publishSel(rows); return }
          const c = current(rows) ?? cur.first(rows)
          if (!c) return
          internal.setCursorId(c)
          visualAnchor.current = c
          publishSel(rows)
          return
        }
        case 'newTask': {
          const c = current(rows)
          a.newTask(c ? taRef.current.issuesOf([c])[0] : undefined)
          return
        }

        // panou
        case 'toList': {
          blurActive()
          internal.setPane('list')
          const c = current(rows) ?? cur.first(rows)
          if (c && c !== internal.cursorRef.current) { internal.setCursorId(c); scrollTo(c) }
          return
        }
        case 'fieldDown': case 'fieldUp': case 'fieldFirst': case 'fieldLast': {
          const p = panel()
          if (!p) return
          const fs = p.fields()
          if (!fs.length) return
          const at = Math.max(0, fs.indexOf(internal.fieldRef.current ?? 'title'))
          const next = id === 'fieldFirst' ? 0 : id === 'fieldLast' ? fs.length - 1
            : Math.max(0, Math.min(fs.length - 1, at + (id === 'fieldDown' ? count : -count)))
          setField(fs[next])
          return
        }
        case 'sectionDown': case 'sectionUp': {
          const p = panel()
          if (!p) return
          setField(cur.sectionStep(p.fields(), internal.fieldRef.current ?? 'title', id === 'sectionDown' ? 1 : -1))
          return
        }
        case 'activate': {
          const p = panel()
          if (!p) return
          const f = internal.fieldRef.current ?? 'title'
          setField(f)
          if (f === 'chips') openMenu('root', [p.issueId], null, true)
          else p.activate(f)
          return
        }
        case 'pTitle': case 'pRename': { const p = panel(); if (!p) return; setField('title'); p.focusTitle(id === 'pRename'); return }
        case 'pDesc': { const p = panel(); if (!p) return; setField('desc'); p.focusDesc(); return }
        case 'pComment': { const p = panel(); if (!p) return; setField('comment'); p.focusComposer(false); return }
        case 'pHandoff': { const p = panel(); if (!p) return; setField('comment'); p.focusComposer(true); return }
        // Pe tichetul docat, prin aceleași drumuri ca din listă (TaskActions):
        // o scriere pe formularul curat îl remontează (`SplitView`), pe cel
        // murdar e refuzată — nimic nu mai trăiește doar în starea formularului.
        case 'pDate': { const p = panel(); if (p && !dirtyBlocks([p.issueId])) openMenu('date', [p.issueId], null, false); return }
        case 'pWave': { const p = panel(); if (p && !dirtyBlocks([p.issueId])) openMenu('wave', [p.issueId], null, false); return }
        case 'pMove': { const p = panel(); if (p && !dirtyBlocks([p.issueId])) openMenu('move', [p.issueId], null, false); return }
        case 'pDone': case 'pUrgent': case 'pPin': {
          const p = panel()
          if (!p) return
          const k = id === 'pDone' ? 'done' : id === 'pUrgent' ? 'urgent' : 'pin'
          rowAction(k, rows, [p.issueId])
          return
        }
        case 'pDelete': {
          const p = panel()
          if (!p) return
          if (dirtyBlocks([p.issueId])) return
          const pid = p.issueId
          if (!uiRef.current.closeSheet()) return
          taRef.current.remove([pid])
          settleAfter(rows)
          return
        }
        case 'pYankLink': case 'pYankTitle': {
          const p = panel()
          if (p) void yank(p.issueId, id === 'pYankLink' ? 'link' : 'title', p.title())
          return
        }

        // bara laterală
        case 'sbDown': focusSidebar((items, ix) => items[Math.min(items.length - 1, ix + count)]); return
        case 'sbUp': focusSidebar((items, ix) => items[Math.max(0, (ix < 0 ? items.length : ix) - count)]); return
        case 'sbFirst': focusSidebar((items) => items[0]); return
        case 'sbLast': focusSidebar((items) => items[items.length - 1]); return
        case 'sbOpen': {
          const el = document.activeElement as HTMLElement | null
          if (!el?.closest('.sidebar')) return
          el.click()
          window.setTimeout(() => { blurActive(); internal.setPane('list') }, 0)
          return
        }
      }
    }

    /**
     * Scara Esc: fiecare apăsare face UN pas. Întoarce false când n-a făcut
     * nimic — atunci Escape-ul trece mai departe la ascultătorii vechi
     * (arborele din „Listă", navigarea din „Cards").
     *
     * secvența → câmpul (în panou) → panoul → bara laterală → selecția →
     * închide panoul → căutarea / filtrul → cursorul. Popoverele (ChipPop,
     * popoverul rândului) se închid singure, înaintea noastră, în captură.
     */
    const escape = (typing: boolean): boolean => {
      if (seq.current.keys.length || seq.current.count) { clearSeq(); return true }
      const active = document.activeElement
      const pane = paneOf(active)
      if (typing) {
        blurActive()
        // Din câmpul panoului în panou, nu în listă: încă un Esc te duce acolo.
        if (pane === 'panel') focusPanel()
        return true
      }
      if (pane === 'panel') {
        // Pe un jeton (după un popover închis): întâi panoul, apoi lista.
        if (!active?.classList.contains('split-pane')) { focusPanel(); return true }
        blurActive(); internal.setPane('list'); return true
      }
      if (pane === 'sidebar') { blurActive(); internal.setPane('list'); return true }
      if (internal.listBusy.current?.()) return false
      if (hasSel()) { clearSel(); return true }
      if (uiRef.current.dockedIssueId) {
        // Garda de închidere rămâne: cu modificări nesalvate, formularul întreabă.
        uiRef.current.closeSheet()
        return true
      }
      if (internal.findRef.current) { internal.setFind(null); internal.setMatches([]); return true }
      if (internal.cursorRef.current) { internal.setCursorId(null); internal.setHint(null); return true }
      return false
    }

    const take = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation() }

    const onResult = (r: FeedResult, e: KeyboardEvent | null) => {
      if (r.kind === 'none') { clearSeq(); return }
      if (e) take(e)
      if (r.kind === 'broken') { clearSeq(); return }
      if (r.kind === 'fire') { clearSeq(); run(r.binding.id, r.count); return }
      // pending
      internal.setPending(pendingLabel(seq.current))
      if (seqTimer.current) clearTimeout(seqTimer.current)
      if (wkTimer.current) clearTimeout(wkTimer.current)
      seqTimer.current = setTimeout(() => {
        const x = expire(seq.current, { ctx: seqCtx.current })
        seq.current = x.state
        onResult(x.result, null)
        clearSeq()
      }, SEQ_TIMEOUT_MS)
      if (seq.current.keys.length) {
        wkTimer.current = setTimeout(() => {
          const items = continuations(seq.current, seqCtx.current)
          if (items.length) internal.setWhichKey({ prefix: seq.current.keys.join(''), items })
        }, WHICH_KEY_DELAY_MS)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const a = actionsRef.current
      const active = document.activeElement
      const typing = isTypingTarget(active)
      // Ctrl+A: toate rândurile, în modul normal (într-un câmp rămâne „selectează textul").
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && !typing
        && !a.blocked() && !overlayOpen() && internal.hostCount.current > 0 && paneOf(active) === 'list') {
        const ids = readRows().map((r) => r.id)
        if (!ids.length) return
        take(e)
        const own = internal.selAdapter.current
        if (own) own.setAll(ids)
        else { marked.current = ids; publishSel(readRows()) }
        return
      }
      // Combinațiile (Ctrl+S, Ctrl+F, Ctrl+,) rămân ale ascultătorilor lor.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (a.blocked()) { clearSeq(); return }
      const tok = token(e)
      if (!tok) return
      // Într-un popover (data, valul, mutarea): j / k trec prin opțiuni, ca săgețile.
      const pop = active?.closest('.fc-pop')
      if (pop && !typing && (tok === 'j' || tok === 'k')) {
        const items = popFocusables(pop)
        if (items.length) {
          take(e)
          const i = items.indexOf(active as HTMLElement)
          items[(i + (tok === 'j' ? 1 : -1) + items.length) % items.length]?.focus()
        }
        return
      }
      if (overlayOpen()) { clearSeq(); return }
      if (tok === 'Escape') {
        if (escape(typing)) take(e)
        return
      }
      // Modul de inserare: doar Escape (mai sus) și combinațiile trec.
      if (typing) return
      // Enter pe un buton care nu e rând (o pastilă de val, „Mută restanțele")
      // e al butonului.
      if ((tok === 'Enter' || tok === 'Space') && active instanceof HTMLElement && active !== document.body
        && !active.matches('.list-row') && active.matches('button, a[href], [role="button"], [role="tab"], summary')
        && paneOf(active) === 'list') return
      const pane = paneOf(active)
      const ctx: Exclude<KeyCtx, 'any'> | null = pane === 'list' && internal.hostCount.current === 0 ? null
        : pane === 'panel' && !panel() ? null
        : pane === 'list' && internal.grid.current ? 'grid' : pane
      if (/^[1-4]$/.test(tok) && !seq.current.count && !seq.current.keys.length && a.digitTabs()) return
      const allowCount = ctx === 'list' || ctx === 'grid' || ctx === 'sidebar' || ctx === 'panel'
      if (!seq.current.keys.length && !seq.current.count) seqCtx.current = ctx
      const r = feed(seq.current, tok, { ctx: seqCtx.current, now: Date.now(), allowCount })
      seq.current = r.state
      onResult(r.result, e)
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearSeq()
      if (followTimer.current) clearTimeout(followTimer.current)
    }
  }, [vim, internal, clearSeq])

  // Alt ecran: selecția dispecerului și intervalul nu mai înseamnă nimic.
  const resetLocal = useCallback(() => {
    marked.current = []
    visualAnchor.current = null
    internal.setSel([], false)
    internal.setFind(null)
    internal.setMatches([])
    internal.setMenu(null)
  }, [internal])
  return resetLocal
}

// ─── ce se vede ────────────────────────────────────────────────────────────

const ids = (list: string[]) => list.map((id) => `[data-issue-id="${CSS.escape(id)}"]`).join(',')

/** Bara de căutare (`/`) / filtru (`f`): jos, ca linia de comandă din Vim. */
function VimFind({ find, count }: { find: FindState; count: number }) {
  const internal = useContext(InternalCtx)!
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (find.open) inputRef.current?.focus() }, [find.open, find.mode])

  const close = (jump: boolean) => {
    const q = find.query.trim()
    internal.setFind(q ? { ...find, open: false } : null)
    inputRef.current?.blur()
    if (!q) { internal.setMatches([]); return }
    if (!jump) return
    // Enter: cursorul pe prima potrivire de sub el (căutare) sau pe primul rând rămas (filtru).
    window.setTimeout(() => {
      const rows = readRows()
      const m = cur.matching(readRows(true), q)
      const c = internal.cursorRef.current
      const next = find.mode === 'filter' ? (rows.some((r) => r.id === c) ? c : cur.first(rows)) : cur.nextMatch(rows, m, c, 1)
      if (next) { internal.setCursorId(next); rows.find((r) => r.id === next)?.el.scrollIntoView({ block: 'nearest' }) }
    }, 0)
  }
  return (
    <div className="vim-find" role="search">
      <span className="vim-find-k">{find.mode === 'filter' ? 'f' : '/'}</span>
      <input
        ref={inputRef}
        className="vim-find-input"
        value={find.query}
        readOnly={!find.open}
        placeholder={find.mode === 'filter' ? 'filtrează — ascunde ce nu se potrivește' : 'caută în listă — Enter sare, n / N mai departe'}
        onChange={(e) => internal.setFind({ ...find, query: e.target.value })}
        onFocus={() => { if (!find.open) internal.setFind({ ...find, open: true }) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); close(true) }
          else if (e.key === 'Escape') { e.preventDefault(); close(false) }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="vim-find-n">{find.query.trim() ? `${count} ${count === 1 ? 'potrivire' : 'potriviri'}` : ''}</span>
    </div>
  )
}

/**
 * Inelul cursorului, selecția, potrivirile, câmpul panoului, linia panoului
 * activ, pastila cu tastele în așteptare, fereastra cu continuări, bara de
 * căutare și popoverul rândului. Numai sub `(pointer: fine)` — pe telefon
 * nimic din toate astea (CSS-ul le ascunde, iar fără tastatură oricum nu apar).
 */
export function VimStatus() {
  const st = useContext(StateCtx)
  const field = useContext(FieldCtx)
  const internal = useContext(InternalCtx)
  const enabled = !!st?.enabled
  const pane = st?.pane ?? 'list'

  useEffect(() => {
    const app = document.getElementById('app')
    if (!app) return
    if (enabled) app.setAttribute('data-vim-pane', pane)
    else app.removeAttribute('data-vim-pane')
    return () => app.removeAttribute('data-vim-pane')
  }, [enabled, pane])

  // Filtrul ascunde rânduri, deci potrivirile se calculează pe lista întreagă,
  // înainte ca regula de ascundere să le scoată din DOM-ul vizibil.
  const query = st?.find?.query ?? ''
  useEffect(() => {
    if (!internal || !enabled) return
    internal.setMatches(query.trim() ? cur.matching(readRows(true), query) : [])
  }, [query, enabled, internal])

  if (!st || !enabled) return null
  const rules: string[] = []
  if (st.cursorId) {
    const sel = `main .list-row[data-issue-id="${CSS.escape(st.cursorId)}"]`
    rules.push(`${sel} { background: var(--vim-cur-bg); } ${sel}::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--vim-cur-bar); }`)
  }
  if (st.selIds.length) {
    rules.push(`main .list-row:is(${ids(st.selIds)}) { background: var(--accent-soft); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent); }`)
  }
  const q = st.find?.query.trim()
  if (q && st.find?.mode === 'find' && st.matches.length) {
    rules.push(`main .list-row:is(${ids(st.matches)}) .list-title { background: color-mix(in srgb, var(--star) 35%, transparent); border-radius: 3px; }`)
  }
  if (q && st.find?.mode === 'filter') {
    rules.push(st.matches.length
      ? `main .list-row[data-issue-id]:not(.split-pane *):not(:is(${ids(st.matches)})) { display: none; }`
      : `main .list-row[data-issue-id]:not(.split-pane *) { display: none; }`)
  }
  if (field) {
    rules.push(`#app[data-vim-pane="panel"] ${fieldSelector(field)} { box-shadow: 0 0 0 2px var(--accent); background-color: var(--accent-soft); border-radius: var(--r-s); }`)
  }
  const mode = st.visual ? `VIZUAL ${st.selIds.length}` : st.selIds.length ? `SELECȚIE ${st.selIds.length}` : ''
  return (
    <>
      {/* Reguli pe id, nu clase pe rânduri: rândurile (memo) nu se randează la
          o mișcare de cursor, iar un rând remontat își păstrează inelul. */}
      {rules.length > 0 && <style>{`@media (pointer: fine) { ${rules.join(' ')} }`}</style>}
      {st.find && <VimFind find={st.find} count={st.matches.length} />}
      {(st.pending || st.hint || mode) && (
        <div className={`vim-pill${st.find ? ' above-find' : ''}`} role="status" aria-live="polite">
          {mode && <span className="vim-pill-mode">{mode}</span>}
          {st.pending ? <kbd className="vim-pill-keys">{st.pending}</kbd> : st.hint && <span className="vim-pill-hint">{st.hint}</span>}
        </div>
      )}
      {st.whichKey && (
        <div className="vim-wk" role="tooltip">
          <div className="vim-wk-head">{st.whichKey.prefix} …</div>
          {st.whichKey.items.map((it) => (
            <div key={it.rest} className="vim-wk-row"><kbd>{it.rest}</kbd><span>{it.desc}</span></div>
          ))}
        </div>
      )}
      {st.menu && internal && createPortal(
        <ActionMenu
          menu={st.menu}
          onLevel={(level) => internal.setMenu(st.menu && { ...st.menu, level })}
          onClose={() => internal.setMenu(null)}
          exec={(a, ids) => internal.menuExec.current?.(a, ids)}
        />,
        document.body,
      )}
    </>
  )
}
