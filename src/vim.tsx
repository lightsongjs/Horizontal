/**
 * Navigarea din tastatură, ca în Vim / yazi: un singur dispecer de taste, un
 * cursor de listă comun tuturor listelor plate și trei panouri (bara laterală,
 * lista, tichetul docat). Macheta aprobată: `design/vim-nav/index.html`.
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
 * Cursorul nu e o stare a rândurilor: un rând nu știe că e sub cursor, iar
 * listele nu se randează la o apăsare de `j`. Inelul e o regulă CSS scrisă pe
 * id (`VimStatus`), iar rândurile se citesc din DOM, în ordinea în care sunt
 * desenate — fixatele, restanțele, zilele, layerele —, fiindcă „următorul" e
 * cel de dedesubt de pe ecran, nu din vreo listă de date care ar putea
 * diverge de randare (evenimentele de calendar, „Terminate azi").
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTheme } from './theme'
import { useUI } from './ui'
import {
  continuations, EMPTY_SEQ, expire, feed, isTypingTarget, pendingLabel, SEQ_TIMEOUT_MS, token,
  WHICH_KEY_DELAY_MS, type ActionId, type FeedResult, type KeyCtx, type SeqState,
} from './lib/keymap'
import * as cur from './lib/cursor'

export type Pane = 'sidebar' | 'list' | 'panel'

/** Cât așteaptă panoul înainte să urmeze cursorul: `jjjj` nu deschide patru tichete. */
export const FOLLOW_DELAY_MS = 120

interface VimApi {
  /** O listă plată (o face `SplitView`) anunță că are rânduri pentru cursor. */
  registerCursorHost(): () => void
  /** „Listă": selecția / arborele au Escape-ul lor — cât sunt pornite, dispecerul nu-l ia. */
  setListBusy(fn: (() => boolean) | null): void
  getCursor(): string | null
  setCursor(id: string | null): void
}

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
}

const ApiCtx = createContext<VimApi | null>(null)
const StateCtx = createContext<VimState | null>(null)
interface Internal {
  hostCount: React.MutableRefObject<number>
  listBusy: React.MutableRefObject<(() => boolean) | null>
  cursorRef: React.MutableRefObject<string | null>
  setCursorId(id: string | null): void
  setPane(p: Pane): void
  setPending(s: string): void
  setWhichKey(w: VimState['whichKey']): void
  setHint(h: string | null): void
}
const InternalCtx = createContext<Internal | null>(null)

export function VimProvider({ children }: { children: ReactNode }) {
  const { vim } = useTheme()
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')
  const [pending, setPending] = useState('')
  const [whichKey, setWhichKey] = useState<VimState['whichKey']>(null)
  const [hint, setHint] = useState<string | null>(null)
  const hostCount = useRef(0)
  const listBusy = useRef<(() => boolean) | null>(null)
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursorId

  const api = useMemo<VimApi>(() => ({
    registerCursorHost: () => {
      hostCount.current += 1
      return () => { hostCount.current -= 1 }
    },
    setListBusy: (fn) => { listBusy.current = fn },
    getCursor: () => cursorRef.current,
    setCursor: (id) => { cursorRef.current = id; setCursorId(id) },
  }), [])

  const internal = useMemo<Internal>(() => ({
    hostCount, listBusy, cursorRef,
    setCursorId: (id) => { cursorRef.current = id; setCursorId(id) },
    setPane, setPending, setWhichKey, setHint,
  }), [])

  // Oprit în timpul lucrului: nimic nu rămâne agățat (inel, pastilă, mesaj).
  useEffect(() => {
    if (vim) return
    internal.setCursorId(null)
    setPending('')
    setWhichKey(null)
    setHint(null)
  }, [vim, internal])

  const state = useMemo<VimState>(
    () => ({ enabled: vim, cursorId, pane, pending, whichKey, hint }),
    [vim, cursorId, pane, pending, whichKey, hint],
  )

  return (
    <ApiCtx.Provider value={api}>
      <InternalCtx.Provider value={internal}>
        <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
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
  setListBusy: () => {},
  getCursor: () => null,
  setCursor: () => {},
}
export function useVimOptional(): VimApi {
  return useContext(ApiCtx) ?? NOOP_API
}

/** „Listă": selecția / arborele pornite păstrează Escape-ul pentru ele. */
export function useVimListBusy(busy: boolean) {
  const api = useVimOptional()
  const ref = useRef(busy)
  ref.current = busy
  useEffect(() => {
    api.setListBusy(() => ref.current)
    return () => api.setListBusy(null)
  }, [api])
}

// ─── DOM: rânduri, panouri ─────────────────────────────────────────────────

/** Rândurile listei de pe ecran, în ordinea desenării. Nu și cele din panou. */
export function readRows(): (cur.CursorRow & { el: HTMLElement })[] {
  const els = [...document.querySelectorAll<HTMLElement>('main .list-row[data-issue-id]')]
    .filter((el) => !el.closest('.split-pane'))
  const groups = new Map<Element, string>()
  return els.map((el) => {
    const g = el.closest('.list-group')
    let key = 'loose'
    if (g) {
      if (!groups.has(g)) groups.set(g, `g${groups.size}`)
      key = groups.get(g)!
    }
    return { id: el.getAttribute('data-issue-id')!, group: key, el }
  })
}

const rowEl = (id: string) =>
  readRows().find((r) => r.id === id)?.el ?? null

function paneOf(el: Element | null): Pane {
  if (el?.closest?.('.split-pane')) return 'panel'
  if (el?.closest?.('.sidebar')) return 'sidebar'
  return 'list'
}

/** Elementele de navigare ale barei laterale, în ordinea de pe ecran. */
function sidebarItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.sidebar .sidebar-search, .sidebar .sidebar-nav-item, .sidebar .sidebar-proj-btn')]
    .filter((el) => el.offsetParent !== null)
}

/** O suprapunere deschisă (popover de jeton, meniu de rând, galerie, confirmarea închiderii) își ține tastele. */
function overlayOpen(): boolean {
  return !!document.querySelector('.fc-pop, .ctx-menu, .lb-back, .ccm-overlay, .qs-overlay')
}

function blurActive() {
  const a = document.activeElement as HTMLElement | null
  if (a && a !== document.body) a.blur()
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
}

export function useKeyDispatcher(actions: DispatchActions) {
  const { vim, follow } = useTheme()
  const ui = useUI()
  const internal = useContext(InternalCtx)
  if (!internal) throw new Error('useKeyDispatcher must be used within VimProvider')

  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const uiRef = useRef(ui)
  uiRef.current = ui
  const followRef = useRef(follow)
  followRef.current = follow

  const seq = useRef<SeqState>(EMPTY_SEQ)
  const seqTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Contextul în care a pornit secvența, ca timeout-ul să rezolve în același.
  const seqCtx = useRef<Exclude<KeyCtx, 'any'> | null>(null)

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

  // Un click pe rând (mouse) mută și cursorul acolo, ca tastatura să continue
  // de unde ai ales. Un click în bara laterală care schimbă ecranul lasă
  // focusul înapoi în listă — altfel `j` ar fi plimbat focusul prin bară.
  useEffect(() => {
    if (!vim) return
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted) return
      const t = e.target as Element | null
      const row = t?.closest?.('main .list-row[data-issue-id]')
      if (row && !row.closest('.split-pane')) {
        internal.setCursorId(row.getAttribute('data-issue-id'))
        return
      }
      if (e.detail > 0 && t?.closest?.('.sidebar .sidebar-nav-item, .sidebar .sidebar-proj-btn')) {
        window.setTimeout(blurActive, 0)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
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

  useEffect(() => {
    if (!vim) { clearSeq(); return }

    const scrollTo = (id: string) => rowEl(id)?.scrollIntoView({ block: 'nearest' })

    /** Deschide rândul exact pe drumul unui click: fiecare listă își are `onOpen`-ul ei. */
    const openRow = (id: string): boolean => {
      const u = uiRef.current
      if (u.dockedIssueId && u.dockedIssueId !== id && u.isDockedDirty()) {
        u.nudgeSave()
        internal.setHint(`Panoul rămâne pe ${u.dockedIssueId} — nesalvat · Ctrl+S`)
        return false
      }
      const el = rowEl(id)
      if (!el) return false
      el.click()
      return true
    }

    const moveCursor = (id: string | null) => {
      if (!id) return
      internal.setCursorId(id)
      scrollTo(id)
      if (followTimer.current) clearTimeout(followTimer.current)
      const u = uiRef.current
      const docked = u.dockedIssueId
      if (!docked || docked === id) { internal.setHint(null); return }
      if (!followRef.current) return
      if (internal.listBusy.current?.()) return
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

    /** Cursorul de pornire: cel de acum, altfel rândul docat (dacă e pe ecran). */
    const current = (rows: cur.CursorRow[]): string | null => {
      const c = internal.cursorRef.current
      if (c && rows.some((r) => r.id === c)) return c
      const d = uiRef.current.dockedIssueId
      if (d && rows.some((r) => r.id === d)) return d
      return null
    }

    const focusPanel = () => {
      const pane = document.querySelector<HTMLElement>('.split-pane:not([hidden])')
      if (!pane) return false
      pane.focus({ preventScroll: true })
      return true
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
        case 'historyBack': window.history.back(); return
        case 'historyForward': window.history.forward(); return
        case 'down': moveCursor(cur.step(rows, current(rows), 1, count)); return
        case 'up': moveCursor(cur.step(rows, current(rows), -1, count)); return
        case 'groupDown': moveCursor(cur.stepGroup(rows, current(rows), 1, count)); return
        case 'groupUp': moveCursor(cur.stepGroup(rows, current(rows), -1, count)); return
        case 'first': moveCursor(cur.first(rows)); return
        case 'last': moveCursor(cur.last(rows)); return
        case 'open': {
          const id = current(rows) ?? cur.first(rows)
          if (!id) return
          internal.setCursorId(id)
          openRow(id)
          return
        }
        case 'toPanel': {
          if (uiRef.current.dockedIssueId) { focusPanel(); return }
          const id = current(rows) ?? cur.first(rows)
          if (!id) return
          internal.setCursorId(id)
          if (!openRow(id)) return
          // Panoul apare după randare (și după încărcarea proiectului, pentru
          // o sarcină dintr-o listă inteligentă): îl așteptăm puțin.
          let tries = 0
          const wait = () => { if (!focusPanel() && ++tries < 30) window.setTimeout(wait, 50) }
          window.setTimeout(wait, 0)
          return
        }
        case 'toSidebar':
          if (a.sidebarCollapsed()) { a.toggleSidebar(); window.setTimeout(() => focusSidebar(), 0) }
          else focusSidebar()
          return
        case 'toList': {
          blurActive()
          internal.setPane('list')
          const c = current(rows) ?? cur.first(rows)
          if (c && c !== internal.cursorRef.current) { internal.setCursorId(c); scrollTo(c) }
          return
        }
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
     * (selecția și arborele din „Listă", navigarea din „Cards").
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
      if (pane === 'panel' || pane === 'sidebar') { blurActive(); internal.setPane('list'); return true }
      if (internal.listBusy.current?.()) return false
      if (uiRef.current.dockedIssueId) {
        // Garda de închidere rămâne: cu modificări nesalvate, formularul întreabă.
        uiRef.current.closeSheet()
        return true
      }
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
      // Combinațiile (Ctrl+S, Ctrl+F, Ctrl+,) rămân ale ascultătorilor lor.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const a = actionsRef.current
      if (a.blocked() || overlayOpen()) { clearSeq(); return }
      const tok = token(e)
      if (!tok) return
      const active = document.activeElement
      const typing = isTypingTarget(active)
      if (tok === 'Escape') {
        if (escape(typing)) take(e)
        return
      }
      // Modul de inserare: doar Escape (mai sus) și combinațiile trec.
      if (typing) return
      // Enter pe un buton care nu e rând (o pastilă de val, „Mută restanțele")
      // e al butonului.
      if (tok === 'Enter' && active instanceof HTMLElement && active !== document.body
        && !active.matches('.list-row') && active.matches('button, a[href], [role="button"], [role="tab"], summary')
        && paneOf(active) === 'list') return
      const pane = paneOf(active)
      const ctx: Exclude<KeyCtx, 'any'> | null = pane === 'list' && internal.hostCount.current === 0 ? null : pane
      if (/^[1-4]$/.test(tok) && !seq.current.count && !seq.current.keys.length && a.digitTabs()) return
      const allowCount = ctx === 'list' || ctx === 'sidebar'
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
}

// ─── ce se vede ────────────────────────────────────────────────────────────

/**
 * Inelul cursorului, linia panoului activ, pastila cu tastele în așteptare și
 * fereastra cu continuări. Numai sub `(pointer: fine)` — pe telefon nimic din
 * toate astea (CSS-ul le ascunde, iar fără tastatură oricum nu apar).
 */
export function VimStatus() {
  const st = useContext(StateCtx)
  const enabled = !!st?.enabled
  const pane = st?.pane ?? 'list'

  useEffect(() => {
    const app = document.getElementById('app')
    if (!app) return
    if (enabled) app.setAttribute('data-vim-pane', pane)
    else app.removeAttribute('data-vim-pane')
    return () => app.removeAttribute('data-vim-pane')
  }, [enabled, pane])

  if (!st || !enabled) return null
  const sel = st.cursorId ? `main .list-row[data-issue-id="${CSS.escape(st.cursorId)}"]` : null
  return (
    <>
      {/* O regulă pe id, nu o clasă pe rând: rândurile (memo) nu se randează
          la o mișcare de cursor, iar un rând remontat își păstrează inelul. */}
      {sel && (
        <style>{`@media (pointer: fine) { ${sel} { background: var(--vim-cur-bg); } ${sel}::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--vim-cur-bar); } }`}</style>
      )}
      {(st.pending || st.hint) && (
        <div className="vim-pill" role="status" aria-live="polite">
          {st.pending ? <kbd className="vim-pill-keys">{st.pending}</kbd> : <span className="vim-pill-hint">{st.hint}</span>}
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
    </>
  )
}
