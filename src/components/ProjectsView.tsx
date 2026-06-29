import { useDepFlow } from '../store'

export function ProjectsView() {
  const { projects, completion, selectProject } = useDepFlow()

  return (
    <div className="view">
      <div className="section-label">
        Proiecte active <span className="cnt">{projects.length}</span>
      </div>
      {projects.length === 0 && (
        <p className="empty">Niciun proiect încă. Apasă + pentru a crea unul.</p>
      )}
      <div className="proj-grid">
        {projects.map((p, i) => {
          const pct = Math.round(completion(p.id) * 100)
          return (
            <button key={p.id} className={`proj p${(i % 3) + 1}`} onClick={() => selectProject(p.id)}>
              <span className="glow" style={{ background: p.accent }} />
              <h3>{p.name}</h3>
              {p.description && <p>{p.description}</p>}
              <div className="proj-meta">
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span className="pct">{pct}%</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
