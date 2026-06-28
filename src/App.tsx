import { useDepFlow } from './store'
import { UIProvider, useUI } from './ui'
import { ProjectsView } from './components/ProjectsView'
import { ProjectDetail } from './components/ProjectDetail'
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
  const { openNewIssue } = useUI()
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
          <ProjectDetail />
        ) : (
          <ProjectsView />
        )}
      </main>
      {project && (
        <button className="fab" aria-label="Adaugă tichet" onClick={openNewIssue}>
          +
        </button>
      )}
      <SheetHost />
    </div>
  )
}

export function App() {
  return (
    <UIProvider>
      <Shell />
    </UIProvider>
  )
}
