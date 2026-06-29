import { useAuth } from './auth'
import { DepFlowProvider, useDepFlow } from './store'
// Note: no in-app logout by design — the session persists. Sign-out, if ever
// needed, is done out-of-band (e.g. clearing the session via a URL/devtools).
import { UIProvider, useUI } from './ui'
import { ThemeProvider, useTheme } from './theme'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { ProjectDetail } from './components/ProjectDetail'
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

function Header() {
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
      <ThemeToggle className="theme-toggle-mobile" />
    </header>
  )
}

function Shell() {
  const { loading, error, project } = useDepFlow()
  const { openNewIssue, openNewProject } = useUI()
  return (
    <div id="app">
      <Sidebar />
      <div className="app-body">
        <Header />
        <main>
          {error && <div className="banner">⚠ {error}</div>}
          {loading ? (
            <div className="view">
              <p className="empty">Se încarcă…</p>
            </div>
          ) : project ? (
            <ProjectDetail />
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
