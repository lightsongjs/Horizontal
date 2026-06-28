import { useDepFlow } from '../store'
import type { Issue, Project } from '../lib/types'

function tagsFor(project: Project, issues: Issue[], themeName: (k: string) => string): string[] {
  const keys = Array.from(new Set(issues.filter((i) => i.projectId === project.id).map((i) => i.theme)))
  return keys.filter(Boolean).map(themeName)
}

export function ProjectsView() {
  const { projects, completion, selectProject, themes, issues } = useDepFlow()
  const themeName = (k: string) => themes.find((t) => t.key === k)?.name ?? k

  return (
    <div className="view">
      <div className="section-label">
        Proiecte active <span className="cnt">{projects.length}</span>
      </div>
      {projects.length === 0 && <p className="empty">Niciun proiect încă. Apasă + pentru a crea unul.</p>}
      {projects.map((p, i) => {
        const pct = Math.round(completion(p.id) * 100)
        // issues only holds the currently-selected project's issues; tags use
        // whatever is loaded. Fine for the seed; full counts load on open.
        const tags = tagsFor(p, issues, themeName).slice(0, 5)
        return (
          <button key={p.id} className={`proj p${(i % 3) + 1}`} onClick={() => selectProject(p.id)}>
            <span className="glow" style={{ background: p.accent }} />
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            <div className="proj-meta">
              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span className="pct">{pct}%</span>
            </div>
            {tags.length > 0 && (
              <div className="proj-tags">
                {tags.map((t) => (
                  <span key={t} className="mini">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
