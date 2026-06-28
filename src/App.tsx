import { useAuth } from './auth'
import { DepFlowProvider, useDepFlow } from './store'
// Note: no in-app logout by design — the session persists. Sign-out, if ever
// needed, is done out-of-band (e.g. clearing the session via a URL/devtools).
import { UIProvider, useUI } from './ui'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { OrdineView } from './components/OrdineView'
import { SheetHost } from './components/SheetHost'

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
      <div className="logo">{project ? project.prefix.slice(0, 2) : 'DF'}</div>
      <div className="htxt">
        <h1>{project ? project.name : 'DepFlow'}</h1>
        <div className="crumb">{project ? project.description : 'Toate proiectele tale'}</div>
      </div>
      {project && (
        <div className="hprog">
          <span className="dot" />
          <span>{pct}%</span>
        </div>
      )}
    </header>
  )
}

function Shell() {
  const { loading, error, project } = useDepFlow()
  const { openNewIssue, openNewProject } = useUI()
  return (
    <div id="app">
      <Header />
      <main>
        {error && <div className="banner">⚠ {error}</div>}
        {loading ? (
          <div className="view">
            <p className="empty">Se încarcă…</p>
          </div>
        ) : project ? (
          <OrdineView />
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
    <DepFlowProvider>
      <UIProvider>
        <Shell />
      </UIProvider>
    </DepFlowProvider>
  )
}
