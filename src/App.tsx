import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './auth'
import { useCanWrite } from './hooks'
import { HorizontalProvider, useHorizontal } from './store'
import { UIProvider, useUI } from './ui'
import { ThemeProvider, useTheme } from './theme'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { ProjectDetail, type Tab } from './components/ProjectDetail'
import { SheetHost } from './components/SheetHost'
import { Sidebar } from './components/Sidebar'
import { QuickSearch } from './components/QuickSearch'
import { UsersView } from './components/UsersView'
import { SmartListView, SMART_LISTS, type SmartListKind } from './components/SmartListView'
import { Toast } from './components/Toast'
import { deepLinkNotice, parseTicketPath, resolveTicketProject, ticketPath } from './lib/deepLink'
import { isReminderAction, SNOOZE_MINUTES } from './lib/pushPayload'
import type { Project } from './lib/types'

function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  return (
    <button className={`theme-toggle ${className ?? ''}`} onClick={toggle} aria-label="Schimbă tema">
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  )
}

function getBuildAgo(): string {
  const diff = Math.floor((Date.now() - new Date(__BUILD_TIME__).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} minute${m > 1 ? 's' : ''} ago` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hour${h > 1 ? 's' : ''} ago` }
  const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`
}

const DAYS_FULL = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']
const MON_FULL = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

/** Subtitlul unei liste inteligente: ziua ei, sau intervalul, în litere. */
function smartCrumb(kind: SmartListKind, now: Date): string {
  const d = new Date(now)
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1)
  if (kind === 'week') {
    const end = new Date(now)
    end.setDate(end.getDate() + 6)
    const from = now.getMonth() === end.getMonth() ? `${now.getDate()}` : `${now.getDate()} ${MON_FULL[now.getMonth()]}`
    return `${from} – ${end.getDate()} ${MON_FULL[end.getMonth()]}`
  }
  return `${DAYS_FULL[d.getDay()]}, ${d.getDate()} ${MON_FULL[d.getMonth()]}`
}

function Header({ onNewIssue, onSearch, onProjectSettings, onRefresh, canWrite, smartList, onExitSmartList }: { onNewIssue: () => void; onSearch: () => void; onProjectSettings: () => void; onRefresh: () => void; canWrite: boolean; smartList: SmartListKind | null; onExitSmartList: () => void }) {
  const { project, completion, selectProject, smartLists } = useHorizontal()
  const pct = project ? Math.round(completion(project.id) * 100) : 0
  const list = smartList ? SMART_LISTS.find((s) => s.kind === smartList) : null
  const listCount = smartList === 'today' ? smartLists.today.length
    : smartList === 'tomorrow' ? smartLists.tomorrow.length
    : smartList === 'week' ? smartLists.week.reduce((n, d) => n + d.issues.length, 0)
    : 0
  return (
    <header>
      {(project || list) && (
        <button className="back" aria-label="Înapoi" onClick={() => (list ? onExitSmartList() : selectProject(null))}>
          ‹
        </button>
      )}
      <div className="logo">{list ? list.icon : project ? project.prefix.slice(0, 2) : 'H'}</div>
      <div className="htxt">
        <h1>{list ? list.label : project ? project.name : 'Horizontal'}</h1>
        <div className="crumb">
          {list ? smartCrumb(list.kind, new Date()) : project ? project.description : 'Toate proiectele tale'}
          {!project && !list && <span style={{ display: 'block', fontSize: '10px', opacity: 0.5, marginTop: '1px' }}>Built: {getBuildAgo()}</span>}
        </div>
      </div>
      {list && listCount > 0 && <div className="hcount">{listCount}</div>}
      {project && (
        <div className="hprog">
          <span className="dot" />
          <span>{pct}%</span>
        </div>
      )}
      {project && canWrite && (
        <button className="header-new-btn" onClick={onNewIssue} title="Tichet nou (C)">
          + Tichet
        </button>
      )}
      {/* Not gated on canWrite, unlike its neighbours: searching changes
          nothing, so a read-only member must be able to do it. */}
      {project && (
        <button className="header-search-btn" onClick={onSearch} aria-label="Caută tichet" title="Caută tichet (O)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      )}
      {project && canWrite && (
        <button className="header-settings-btn" onClick={onProjectSettings} aria-label="Setări proiect" title="Setări proiect">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      )}
      <button className="header-refresh-btn" onClick={onRefresh} aria-label="Reîncarcă">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
      <ThemeToggle className="theme-toggle-mobile" />
    </header>
  )
}

/**
 * Bara de jos, numai pe telefon (vezi `.tabbar` în styles.css). Pe mobil
 * sidebar-ul e ascuns, deci fără ea listele inteligente n-ar avea drum.
 *
 * Patru tab-uri, nu cinci: „Caută" ar fi fost al cincilea, dar QuickSearch
 * caută în proiectul deschis, iar de aici nu există unul.
 */
function TabBar({ smartList, onSmartList, onProjects, onQuickAdd, inProjects }: {
  smartList: SmartListKind | null
  onSmartList(kind: SmartListKind): void
  onProjects(): void
  onQuickAdd(): void
  inProjects: boolean
}) {
  return (
    <nav className="tabbar">
      <button className={smartList === 'today' ? 'on' : ''} onClick={() => onSmartList('today')}>
        <span className="tb-ico" aria-hidden="true">★</span>Azi
      </button>
      <button className={smartList === 'week' ? 'on' : ''} onClick={() => onSmartList('week')}>
        <span className="tb-ico" aria-hidden="true">▤</span>7 zile
      </button>
      <button className="tb-add" onClick={onQuickAdd} aria-label="Sarcină nouă">
        <span className="tb-ico" aria-hidden="true">+</span>
      </button>
      <button className={inProjects ? 'on' : ''} onClick={onProjects}>
        <span className="tb-ico" aria-hidden="true">⊞</span>Proiecte
      </button>
    </nav>
  )
}

const SHORTCUTS = [
  { key: 'C', action: 'Tichet nou' },
  { key: 'O', action: 'Caută tichet' },
  { key: 'P', action: 'Proiect nou' },
  { key: '1', action: 'Tab → List' },
  { key: '2', action: 'Tab → Cards' },
  { key: '3', action: 'Tab → Graf' },
  { key: '4', action: 'Tab → Teme' },
  { key: 'T', action: 'Tree View (în Cards)' },
  { key: 'Ctrl+S', action: 'Salvează cardul (rămâne deschis)' },
  { key: 'Ctrl+↵', action: 'Salvează și închide cardul' },
  { key: '?', action: 'Afișează shortcuts' },
  { key: 'Esc', action: 'Închide modal' },
]

/** Adâncimea intrării curente din istoric, din history.state. */
const readDepth = () => (window.history.state as { hzDepth?: number } | null)?.hzDepth ?? 0

const LAST_VIEW_KEY = 'horizontal:last-view'

/** `smart:today` → `today`. Orice altceva → null. */
function parseLastView(raw: string | null): SmartListKind | null {
  const kind = raw?.startsWith('smart:') ? raw.slice(6) : null
  return kind === 'today' || kind === 'tomorrow' || kind === 'week' ? kind : null
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')

function Shell() {
  const { loading, error, project, projects, issuesLoadedFor, issuesLoadFailedFor, byId, selectProject, refresh, toggleDone, updateIssue } = useHorizontal()
  const { openNewIssue, openNewProject, openProjectSettings, openIssue, closeSheet, sheet, ticketId } = useUI()
  const { isAdmin } = useAuth()
  const canWrite = useCanWrite()
  const [showUsers, setShowUsers] = useState(false)
  /**
   * Lista inteligentă deschisă. Ca `showUsers`, e un strat peste conținut care
   * NU deține URL-ul: mașinăria de mai jos e scrisă în jurul a două stări
   * (proiect, ticket) și nu merită atinsă pentru asta. Ce contează practic —
   * PWA-ul să se deschidă unde ai rămas — se rezolvă cu `last-view`.
   */
  const [smartList, setSmartList] = useState<SmartListKind | null>(null)
  // Contor, nu boolean: fiecare apăsare pe „+" trebuie să refocuseze inputul,
  // chiar dacă lista era deja deschisă. Un boolean ar fi „true" a doua oară.
  const [focusQuickAdd, setFocusQuickAdd] = useState(0)
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('horizontal:last-tab')
    return saved === 'ordine' || saved === 'list' || saved === 'graf' || saved === 'teme' ? saved : 'list'
  })
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  // ─────────────────────────────────────────────────────────────────────────
  // Mașina de stări a URL-ului. Cine deține URL-ul, și când:
  //
  //   • un ticket deschis (`ticketId` din stiva de sheet-uri) → `/<id>`;
  //   • altfel proiectul selectat → `/project/<slug>`, sau `/` fără proiect.
  //
  // Formularul de tichet nou și cardurile de dependență din stivă NU dețin
  // URL-ul. Regula se aplică în patru efecte, în ordinea asta:
  //   1. boot (o singură dată, prin `bootDone`): citește path-ul → alege
  //      proiectul; un `/<id>` lasă `deepLinkPending` și așteaptă datele;
  //   2. proiect → URL: tace cât timp URL-ul aparține unui ticket;
  //   3. rezolvarea deep link-ului: deschide sheet-ul când sosesc issues
  //      (`issuesLoadedFor`) sau renunță onest dacă încărcarea a eșuat;
  //   4. `[ticketId]` sheet → URL: push la deschidere, back la închidere.
  // Plus handler-ul de `popstate`, singurul care merge invers: URL → stare.
  //
  // Refs, nu state, pentru că handler-ele de istoric citesc valorile *acum*,
  // în afara unui render. `historyDepth` (ținut și în `history.state`) spune
  // câte intrări am împins noi în sesiunea asta: 0 înseamnă că un
  // `history.back()` ar scoate userul din aplicație, deci rescriem în loc.
  // ─────────────────────────────────────────────────────────────────────────
  const urlSyncReady = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])
  // Setat cât timp un deep link se rezolvă, ca sincronizarea proiect → URL să
  // nu scrie /project/<slug> peste /MS-03. Vezi Task 4.
  const deepLinkPending = useRef<string | null>(null)
  // Efectul de boot rulează o singură dată. `loading` redevine true la fiecare
  // refresh() (inclusiv la revenirea în tab), deci nu poate fi singura gardă.
  const bootDone = useRef(false)
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const ticketIdRef = useRef(ticketId)
  ticketIdRef.current = ticketId
  const projectRef = useRef(project)
  projectRef.current = project
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  // Adâncimea intrării curente în istoric, memorată în history.state. Intrarea
  // cu care s-a încărcat pagina nu are state → 0 → nu avem nimic al nostru în
  // spate, deci history.back() ar scoate userul din aplicație.
  const historyDepth = useRef<number>(readDepth())
  const pushPath = (path: string) => {
    historyDepth.current += 1
    window.history.pushState({ hzDepth: historyDepth.current }, '', path)
  }
  const replacePath = (path: string) => {
    window.history.replaceState({ hzDepth: historyDepth.current }, '', path)
  }
  const projectPath = (p: Project | null) => (p ? `/project/${slugify(p.name)}` : '/')
  /** Așază URL-ul pe destinația reală (proiect sau landing), fără intrare nouă. */
  const settleUrl = (p: Project | null) => {
    const path = projectPath(p)
    if (window.location.pathname !== path) replacePath(path)
  }
  /**
   * Un Back a fost refuzat (formular cu modificări nesalvate) → punem URL-ul
   * înapoi pe starea care rămâne pe ecran: ticketul deschis, altfel proiectul.
   * Idempotent: dacă intrarea pe care am aterizat arată deja starea corectă nu
   * împingem nimic, altfel ar rămâne o intrare duplicat pe care nimic nu o mai
   * scoate și următorul Back n-ar face nimic vizibil.
   */
  const reassertUrl = () => {
    const open = ticketIdRef.current
    const path = open ? ticketPath(open) : projectPath(projectRef.current)
    if (window.location.pathname !== path) pushPath(path)
  }
  const mainRef = useRef<HTMLElement>(null)
  const [pullY, setPullY] = useState(0)
  const pullStart = useRef<number | null>(null)
  const pullYRef = useRef(0)
  const THRESHOLD = 72

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      if (el.scrollTop === 0) pullStart.current = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (pullStart.current === null) return
      const dy = e.touches[0].clientY - pullStart.current
      if (dy > 0) {
        e.preventDefault()
        pullYRef.current = Math.min(dy, THRESHOLD * 1.5)
        setPullY(pullYRef.current)
      }
    }
    const onEnd = async () => {
      if (pullYRef.current >= THRESHOLD) await refresh()
      pullStart.current = null
      pullYRef.current = 0
      setPullY(0)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [refresh])

  // Ce secțiune era deschisă la ultima folosire. Fără asta, un PWA deschis de pe
  // ecranul de start ar ateriza mereu în proiecte, nu în lista de azi.
  useEffect(() => {
    if (smartList) localStorage.setItem(LAST_VIEW_KEY, `smart:${smartList}`)
    else if (project) localStorage.removeItem(LAST_VIEW_KEY)
  }, [smartList, project])

  const openSmartList = useCallback((kind: SmartListKind) => {
    setShowUsers(false)
    setSmartList(kind)
    selectProject(null)
  }, [selectProject])

  const exitSmartList = useCallback(() => {
    setSmartList(null)
    localStorage.removeItem(LAST_VIEW_KEY)
    // Deschiderea unei sarcini încarcă proiectul ei în store, fără să schimbe
    // ecranul. Fără curățenia asta, un Back din „Azi" ar ateriza pe boardul
    // ultimei sarcini deschise — un loc pe care nu l-a cerut nimeni.
    selectProject(null)
  }, [selectProject])

  // Remember the active tab globally — persists across refreshes AND across
  // project switches. The chosen view stays until the user changes it.
  useEffect(() => { localStorage.setItem('horizontal:last-tab', tab) }, [tab])

  const findBySlug = (slug: string) => projects.find((p) => slugify(p.name) === slug)

  // Fallback: selectează ultimul proiect folosit (dacă există), din localStorage.
  // Întoarce proiectul pe care am aterizat, ca apelantul să poată așeza URL-ul.
  const selectLastUsedProject = (): Project | null => {
    const lastSlug = localStorage.getItem('horizontal:last-project')
    const found = lastSlug ? findBySlug(lastSlug) : null
    if (found) selectProject(found.id)
    return found ?? null
  }

  /**
   * Deschide ticketul cerut de URL. Dacă ticketul e în alt proiect, comută
   * proiectul și lasă efectul de rezolvare să deschidă sheet-ul după ce ajung
   * issues. Dacă nu există (prefix necunoscut sau ticket șters), anunță și
   * așază URL-ul pe destinația reală, ca să nu rămână agățat pe /XX-01.
   *
   * Se apelează din `popstate` (după ce stiva de sheet-uri a fost închisă, vezi
   * `onPop`) și din `openTaskAnywhere`, unde stiva e oricum goală — suntem
   * într-o listă inteligentă. În ambele cazuri precondiția e aceeași, deci
   * ramurile de eșec pot așeza URL-ul pe proiect fără să rămână un sheet de
   * ticket deschis sub un URL de proiect.
   */
  const resolveTicketUrl = (target: string) => {
    const current = projectRef.current
    const owner = resolveTicketProject(projectsRef.current, target)
    if (!owner) {
      setNotice(deepLinkNotice(target, 'missing'))
      settleUrl(current)
      return
    }
    if (current && owner.id === current.id) {
      if (byIdRef.current[target]) openIssue(target)
      else {
        setNotice(deepLinkNotice(target, 'missing'))
        settleUrl(current)
      }
      return
    }
    deepLinkPending.current = target
    selectProject(owner.id)
  }

  /**
   * Deschide o sarcină dintr-o listă inteligentă, PESTE listă.
   *
   * Sarcina poate aparține oricărui proiect, inclusiv unuia nedeschis
   * niciodată, iar formularul are nevoie de contextul acelui proiect: valurile,
   * temele, celelalte tichete pentru dependențe. `resolveTicketUrl` îl încarcă
   * (e același drum pe care merge un deep link) și deschide sheet-ul când sosesc
   * datele.
   *
   * Ce NU face, și aici era greșeala: nu părăsește lista. Prima versiune dădea
   * `setSmartList(null)`, deci se vedea o clipă boardul proiectului și abia apoi
   * apărea cardul — te muta din „Azi" într-un loc pe care nu-l cerusesi, iar la
   * închiderea cardului rămâneai acolo. Lista rămâne randată dedesubt fiindcă
   * `smartList` are prioritate față de `project` în randare; proiectul se
   * încarcă doar în store, ca formularul să funcționeze complet.
   */
  const openTaskAnywhere = (id: string) => {
    resolveTicketUrl(id)
  }

  // Step 1 — on load: read path, select project, then unlock URL sync.
  // Un path de ticket (/MS-03) nu conține proiectul, așa că îl deducem din
  // prefixul id-ului. Issues se încarcă lazy, deci sheet-ul se deschide mai
  // târziu, într-un efect separat, după ce ajung datele.
  useEffect(() => {
    if (loading || bootDone.current) return
    bootDone.current = true
    const target = parseTicketPath(window.location.pathname)
    if (target) {
      const owner = resolveTicketProject(projects, target)
      if (owner) {
        deepLinkPending.current = target
        selectProject(owner.id)
      } else {
        // Fără proiecte în listă nu putem ști dacă ticketul a dispărut sau doar
        // listProjects() a eșuat — `error` face diferența.
        setNotice(deepLinkNotice(target, error ? 'load-failed' : 'missing'))
        settleUrl(selectLastUsedProject())
      }
    } else {
      const match = window.location.pathname.match(/^\/project\/(.+)$/)
      if (match) {
        const found = findBySlug(match[1])
        if (found) selectProject(found.id)
      } else {
        // O listă inteligentă memorată bate ultimul proiect: userul a plecat de
        // acolo, deci acolo se întoarce.
        const lastView = parseLastView(localStorage.getItem(LAST_VIEW_KEY))
        if (lastView) setSmartList(lastView)
        else selectLastUsedProject()
      }
    }
    urlSyncReady.current = true
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rezolvă deep link-ul în așteptare de îndată ce issues proiectului sunt
  // încărcate. Semnalul e `issuesLoadedFor` — o listă goală nu poate distinge
  // „încă nu s-a încărcat” de „proiect fără tichete”. `issuesLoadFailedFor` e
  // celălalt capăt: fără el, un eșec de încărcare ar lăsa `deepLinkPending`
  // agățat pe vecie, iar sincronizarea proiect → URL ar tăcea toată sesiunea.
  useEffect(() => {
    const pending = deepLinkPending.current
    if (!pending || !project) return
    if (issuesLoadFailedFor === project.id) {
      deepLinkPending.current = null
      setNotice(deepLinkNotice(pending, 'load-failed'))
      settleUrl(project)
      return
    }
    if (issuesLoadedFor !== project.id) return
    deepLinkPending.current = null
    if (byId[pending]) openIssue(pending)
    else {
      setNotice(deepLinkNotice(pending, 'missing'))
      settleUrl(project)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuesLoadedFor, issuesLoadFailedFor, project, byId, openIssue])

  // Step 2 — sync project → URL using name slug. Nu scrie nimic cât timp URL-ul
  // aparține unui ticket (deep link în curs de rezolvare, sau sheet deschis) —
  // altfel /project/<slug> ar călca peste /MS-03.
  useEffect(() => {
    if (!urlSyncReady.current) return
    const slug = project ? slugify(project.name) : null
    if (slug) localStorage.setItem('horizontal:last-project', slug)
    else localStorage.removeItem('horizontal:last-project')

    // URL-ul aparține unui ticket doar dacă un deep link se rezolvă sau un sheet
    // de ticket e deschis — nu doar pentru că pathname-ul *arată* ca un ticket.
    // Un deep link eșuat lasă /ZZ-99 în bară și trebuie suprascris.
    const ticketOwnsUrl = deepLinkPending.current !== null || ticketIdRef.current !== null
    if (ticketOwnsUrl) return

    const path = slug ? `/project/${slug}` : '/'
    if (window.location.pathname !== path) pushPath(path)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sheet de ticket → URL. `ticketId` vine din stiva de sheet-uri, nu din vârf,
  // deci un card de dependență deschis peste formular nu atinge URL-ul.
  // Deschiderea în aplicație împinge o intrare, deci Back închide sheet-ul.
  useEffect(() => {
    if (!urlSyncReady.current) return
    const onTicketUrl = parseTicketPath(window.location.pathname)

    if (ticketId) {
      const path = ticketPath(ticketId)
      if (window.location.pathname === path) return
      // URL-ul e deja al acestui ticket (alt caps, după un deep link) → doar îl
      // canonizăm, fără intrare nouă.
      if (onTicketUrl === ticketId) replacePath(path)
      else pushPath(path)
    } else if (onTicketUrl && deepLinkPending.current === null) {
      // Sheet-ul s-a închis dar URL-ul e încă de ticket. Garda `onTicketUrl`
      // previne un back dublu când popstate a fost cel care a închis sheet-ul.
      if (historyDepth.current > 0) window.history.back()
      // Deep link rece: intrarea de ticket e prima din sesiune, un back ar
      // scoate userul din aplicație. Rescriem în loc să navigăm.
      else settleUrl(projectRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId])

  // Browser back/forward → sync store. Un path de ticket nu schimbă proiectul;
  // doar deschide sau închide sheet-ul.
  useEffect(() => {
    const onPop = () => {
      historyDepth.current = readDepth()
      const target = parseTicketPath(window.location.pathname)
      // Ticketul cerut e deja cel deschis (ex. un card de dependență peste el)
      // → nu resetăm stiva și nu deranjăm garda de close.
      if (target && ticketIdRef.current === target) return
      // Orice altă destinație închide stiva, inclusiv un alt ticket: un
      // formular cu modificări nesalvate nu are voie să dispară în silență.
      // Dacă garda blochează, nu mai navigăm nicăieri și punem URL-ul înapoi.
      if (sheetRef.current.kind !== 'none' && !closeSheet()) {
        reassertUrl()
        return
      }
      if (target) {
        // `closeSheet()` a golit stiva, iar `openIssue()` de mai jos o rescrie
        // în același handler → React 18 le grupează într-un singur render, deci
        // efectul `[ticketId]` nu vede niciodată starea intermediară „niciun
        // ticket deschis, dar URL de ticket” (care ar declanșa un back).
        resolveTicketUrl(target)
        return
      }
      const match = window.location.pathname.match(/^\/project\/(.+)$/)
      const found = match ? findBySlug(match[1]) : null
      selectProject(found?.id ?? null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectProject, projects, openIssue, closeSheet]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'Escape' && showShortcuts) { setShowShortcuts(false); return }
      if (e.key === 'Escape' && showSearch) { setShowSearch(false); return }
      if (sheet.kind !== 'none') return  // don't fire shortcuts when modal is open
      if (showSearch) return
      if (showUsers) return

      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (!canWrite) return; project && openNewIssue() }
      else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); project && setShowSearch(true) }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!isAdmin) return; openNewProject() }
      else if (e.key === '?') { e.preventDefault(); setShowShortcuts(v => !v) }
      else if (e.key === '1' && project) { e.preventDefault(); setTab('list') }
      else if (e.key === '2' && project) { e.preventDefault(); setTab('ordine') }
      else if (e.key === '3' && project) { e.preventDefault(); setTab('graf') }
      else if (e.key === '4' && project) { e.preventDefault(); setTab('teme') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project, openNewIssue, openNewProject, sheet, showShortcuts, showSearch, showUsers, canWrite, isAdmin])

  /**
   * Butoanele notificării („Gata", „Amână 10 min"). Service worker-ul nu poate
   * scrie singur — n-are nici sesiunea userului, nici o cheie de API pe care
   * s-o poată ține secretă. Deci trimite mesajul aici, iar pagina face
   * mutația cu drepturile utilizatorului. Vezi `src/sw.ts`.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (!isReminderAction(e.data)) return
      const { action, id } = e.data
      if (action === 'done') void toggleDone(id)
      // Amânarea mută mementoul, nu scadența: sarcina rămâne când era, doar
      // sună din nou peste zece minute.
      else void updateIssue(id, { remindAt: new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString() })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [toggleDone, updateIssue])

  // Un drop care aterizează în afara zonei de fișiere lovește comportamentul
  // implicit al browserului și scoate utilizatorul din SPA — deschide fișierul
  // ca pagină, pierzând starea nesalvată. O pereche inertă la nivel de document
  // face ratarea fără efect. Înregistrată o singură dată, aici, nu în fiecare
  // componentă care acceptă fișiere.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    document.addEventListener('dragover', swallow)
    document.addEventListener('drop', swallow)
    return () => {
      document.removeEventListener('dragover', swallow)
      document.removeEventListener('drop', swallow)
    }
  }, [])

  return (
    <div id="app">
      <Sidebar
        isAdmin={isAdmin}
        showUsers={showUsers && isAdmin}
        onShowUsers={() => { setShowUsers(true); setSmartList(null) }}
        onNavigate={() => { setShowUsers(false); exitSmartList() }}
        smartList={smartList}
        onSmartList={openSmartList}
      />
      <div className="app-body">
        <Header onNewIssue={openNewIssue} onSearch={() => setShowSearch(true)} onProjectSettings={openProjectSettings} onRefresh={refresh} canWrite={canWrite} smartList={smartList} onExitSmartList={exitSmartList} />
        <main ref={mainRef}>
          {pullY > 0 && (
            <div style={{ textAlign: 'center', padding: '6px 0', fontSize: '13px', color: 'var(--txt-dim)', transform: `translateY(${pullY * 0.4}px)`, transition: pullY === 0 ? 'transform 0.3s' : 'none' }}>
              {pullY >= THRESHOLD ? '↑ Eliberează' : '↓ Trage pentru refresh'}
            </div>
          )}
          {error && <div className="banner">⚠ {error}</div>}
          {loading ? (
            <div className="view">
              <p className="empty">Se încarcă…</p>
            </div>
          ) : smartList ? (
            <SmartListView kind={smartList} onOpenTask={openTaskAnywhere} focusSignal={focusQuickAdd} />
          ) : showUsers && isAdmin ? (
            <UsersView />
          ) : project ? (
            <ProjectDetail tab={tab} setTab={setTab} />
          ) : (
            <ProjectsView />
          )}
        </main>
        {!smartList && (project ? canWrite : isAdmin) && (
          <button
            className="fab"
            aria-label={project ? 'Adaugă tichet' : 'Adaugă proiect'}
            onClick={project ? openNewIssue : openNewProject}
          >
            +
          </button>
        )}
        <TabBar
          smartList={smartList}
          onSmartList={openSmartList}
          onProjects={() => { exitSmartList(); setShowUsers(false); selectProject(null) }}
          onQuickAdd={() => { openSmartList('today'); setFocusQuickAdd((n) => n + 1) }}
          inProjects={!smartList && !showUsers}
        />
      </div>
      <Toast message={notice} onDone={clearNotice} />
      <SheetHost />
      {showSearch && <QuickSearch onClose={() => setShowSearch(false)} />}
      {showShortcuts && (
        <div className="shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-title">Keyboard shortcuts</div>
            <table className="shortcuts-table">
              <tbody>
                {SHORTCUTS.map(({ key, action }) => (
                  <tr key={key}>
                    <td><kbd>{key}</kbd></td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="shortcuts-close" onClick={() => setShowShortcuts(false)}>Închide</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function App() {
  const { enabled, session, loading } = useAuth()

  if (loading) {
    return (
      <div id="app">
        <main>
          <div className="view">
            <p className="empty">Se încarcă…</p>
          </div>
        </main>
      </div>
    )
  }

  if (enabled && !session) return <Login />

  return (
    <ThemeProvider>
      <HorizontalProvider>
        <UIProvider>
          <Shell />
        </UIProvider>
      </HorizontalProvider>
    </ThemeProvider>
  )
}
