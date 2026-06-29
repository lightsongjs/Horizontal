import { useState, useEffect, useRef } from 'react'
import { useAuth } from './auth'
import { DepFlowProvider, useDepFlow } from './store'
import { UIProvider, useUI } from './ui'
import { ThemeProvider, useTheme } from './theme'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { ProjectDetail, type Tab } from './components/ProjectDetail'
import { SheetHost } from './components/SheetHost'
import { Sidebar } from './components/Sidebar'

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

function Header({ onNewIssue, onProjectSettings }: { onNewIssue: () => void; onProjectSettings: () => void }) {
  const { project, completion, selectProject } = useDepFlow()
  const pct = project ? Math.round(completion(project.id) * 100) : 0
  return (
    <header>
      {project && (
        <button className="back" aria-label="Înapoi" onClick={() => selectProject(null)}>
          ‹
        </button>
      )}
      <div className="logo">{project ? project.prefix.slice(0, 2) : 'H'}</div>
      <div className="htxt">
        <h1>{project ? project.name : 'Horizontal'}</h1>
        <div className="crumb">{project ? project.description : 'Toate proiectele tale'}</div>
      </div>
      {project && (
        <div className="hprog">
          <span className="dot" />
          <span>{pct}%</span>
        </div>
      )}
      {project && (
        <button className="header-new-btn" onClick={onNewIssue} title="Tichet nou (C)">
          + Tichet
        </button>
      )}
      {project && (
        <button className="header-settings-btn" onClick={onProjectSettings} aria-label="Setări proiect" title="Setări proiect">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      )}
      <ThemeToggle className="theme-toggle-mobile" />
    </header>
  )
}

const SHORTCUTS = [
  { key: 'C', action: 'Tichet nou' },
  { key: 'P', action: 'Proiect nou' },
  { key: '1', action: 'Tab → Ordine' },
  { key: '2', action: 'Tab → Graf' },
  { key: '3', action: 'Tab → Teme' },
  { key: '?', action: 'Afișează shortcuts' },
  { key: 'Esc', action: 'Închide modal' },
]

const slugify = (name: string) =>
  name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')

function Shell() {
  const { loading, error, project, projects, selectProject, refresh } = useDepFlow()
  const { openNewIssue, openNewProject, openProjectSettings, sheet } = useUI()
  const [tab, setTab] = useState<Tab>('ordine')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const urlSyncReady = useRef(false)
  const pullStartY = useRef<number | null>(null)
  const [pullProgress, setPullProgress] = useState(0) // 0-1
  const PULL_THRESHOLD = 80

  const onTouchStart = (e: React.TouchEvent) => {
    const main = (e.currentTarget as HTMLElement)
    if (main.scrollTop === 0) pullStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current === null) return
    const dy = e.touches[0].clientY - pullStartY.current
    if (dy > 0) setPullProgress(Math.min(dy / PULL_THRESHOLD, 1))
  }
  const onTouchEnd = async () => {
    if (pullProgress >= 1) await refresh()
    pullStartY.current = null
    setPullProgress(0)
  }

  // Reset tab when switching projects
  useEffect(() => { setTab('ordine') }, [project?.id])

  const findBySlug = (slug: string) => projects.find((p) => slugify(p.name) === slug)

  // Step 1 — on load: read path, select project by name slug, then unlock URL sync
  useEffect(() => {
    if (loading) return
    const match = window.location.pathname.match(/^\/project\/(.+)$/)
    if (match) {
      const found = findBySlug(match[1])
      if (found) selectProject(found.id)
    }
    urlSyncReady.current = true
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2 — sync project → URL using name slug
  useEffect(() => {
    if (!urlSyncReady.current) return
    const path = project ? `/project/${slugify(project.name)}` : '/'
    if (window.location.pathname !== path)
      window.history.pushState(null, '', path)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Browser back/forward → sync store
  useEffect(() => {
    const onPop = () => {
      const match = window.location.pathname.match(/^\/project\/(.+)$/)
      const found = match ? findBySlug(match[1]) : null
      selectProject(found?.id ?? null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectProject, projects]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'Escape' && showShortcuts) { setShowShortcuts(false); return }
      if (sheet.kind !== 'none') return  // don't fire shortcuts when modal is open

      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); project && openNewIssue() }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); openNewProject() }
      else if (e.key === '?') { e.preventDefault(); setShowShortcuts(v => !v) }
      else if (e.key === '1' && project) { e.preventDefault(); setTab('ordine') }
      else if (e.key === '2' && project) { e.preventDefault(); setTab('graf') }
      else if (e.key === '3' && project) { e.preventDefault(); setTab('teme') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project, openNewIssue, openNewProject, sheet, showShortcuts])

  return (
    <div id="app">
      <Sidebar />
      <div className="app-body">
        <Header onNewIssue={openNewIssue} onProjectSettings={openProjectSettings} />
        <main onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          {pullProgress > 0 && (
            <div style={{ textAlign: 'center', padding: '8px', opacity: pullProgress, color: 'var(--text-2)', fontSize: '13px' }}>
              {pullProgress >= 1 ? '↑ Eliberează pentru refresh' : '↓ Trage pentru refresh'}
            </div>
          )}
          {error && <div className="banner">⚠ {error}</div>}
          {loading ? (
            <div className="view">
              <p className="empty">Se încarcă…</p>
            </div>
          ) : project ? (
            <ProjectDetail tab={tab} setTab={setTab} />
          ) : (
            <ProjectsView />
          )}
        </main>
        <button
          className="fab"
          aria-label={project ? 'Adaugă tichet' : 'Adaugă proiect'}
          onClick={project ? openNewIssue : openNewProject}
        >
          +
        </button>
      </div>
      <SheetHost />
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
      <DepFlowProvider>
        <UIProvider>
          <Shell />
        </UIProvider>
      </DepFlowProvider>
    </ThemeProvider>
  )
}
