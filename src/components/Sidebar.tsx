import { useRef, useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'
import { useTheme } from '../theme'

const BUILD_DATE = new Date(__BUILD_TIME__).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })

export function Sidebar() {
  const { projects, project, completion, selectProject, reorderProjects } = useDepFlow()
  const { openNewProject, openNewIssue } = useUI()
  const { theme, toggle } = useTheme()
  const dragId = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">H</div>
        <div className="sidebar-brand-txt">
          <span className="sidebar-app-name">Horizontal</span>
          <span style={{ fontSize: '9px', color: 'var(--txt-dim)', opacity: 0.6, lineHeight: 1 }}>last build: {BUILD_DATE}</span>
        </div>
      </div>

      <button
        className={`sidebar-nav-item ${!project ? 'on' : ''}`}
        onClick={() => selectProject(null)}
      >
        <span className="sidebar-nav-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="8" y="1" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="1" y="8" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.8" />
            <rect x="8" y="8" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.8" />
          </svg>
        </span>
        <span>Toate proiectele</span>
      </button>

      {projects.length > 0 && (
        <div className="sidebar-section-label">Proiecte</div>
      )}

      <div className="sidebar-proj-list">
        {projects.map((p) => {
          const pct = Math.round(completion(p.id) * 100)
          const isActive = project?.id === p.id
          return (
            <div
              key={p.id}
              className={`sidebar-proj-item ${isActive ? 'on' : ''} ${dragOver === p.id ? 'drag-over' : ''}`}
              draggable
              onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(p.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                if (!dragId.current || dragId.current === p.id) return
                const ids = projects.map((x) => x.id)
                const from = ids.indexOf(dragId.current)
                const to = ids.indexOf(p.id)
                const next = [...ids]
                next.splice(from, 1)
                next.splice(to, 0, dragId.current)
                reorderProjects(next)
                dragId.current = null
              }}
              onDragEnd={() => { setDragOver(null); dragId.current = null }}
            >
              <span className="sidebar-drag-handle" title="Trage pentru a reordona">⠿</span>
              <button className="sidebar-proj-btn" onClick={() => selectProject(p.id)}>
                <span className="sidebar-proj-dot" style={{ background: p.accent }} />
                <span className="sidebar-proj-name">{p.name}</span>
                <span className="sidebar-proj-pct">{pct}%</span>
              </button>
            </div>
          )
        })}
        {projects.length === 0 && (
          <p className="sidebar-empty">Niciun proiect încă</p>
        )}
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer-row">
        <button
          className="sidebar-new-btn"
          onClick={project ? openNewIssue : openNewProject}
        >
          <span className="sidebar-new-plus">+</span>
          {project ? 'Tichet nou' : 'Proiect nou'}
        </button>
        <button className="sidebar-theme-btn" onClick={toggle} aria-label="Schimbă tema">
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
      </div>
    </aside>
  )
}
