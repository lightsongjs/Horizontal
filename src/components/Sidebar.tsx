import { useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useTheme } from '../theme'
import { useAuth } from '../auth'
import { useCanWrite } from '../hooks'
import { SMART_LISTS, type SmartListKind } from './SmartListView'
import { Icon } from './Icon'

function getBuildAgo(): string {
  const diff = Math.floor((Date.now() - new Date(__BUILD_TIME__).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} minute${m > 1 ? 's' : ''} ago` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hour${h > 1 ? 's' : ''} ago` }
  const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`
}

interface SidebarProps {
  isAdmin?: boolean
  showUsers?: boolean
  onShowUsers?: () => void
  onNavigate?: () => void
  smartList?: SmartListKind | null
  onSmartList?: (kind: SmartListKind) => void
}

export function Sidebar({ isAdmin = false, showUsers = false, onShowUsers, onNavigate, smartList = null, onSmartList }: SidebarProps = {}) {
  const { projects, project, completion, selectProject, reorderProjects, smartLists } = useHorizontal()

  // Navigate away from any overlay (e.g. Users) then select a project.
  const goToProject = (id: string | null) => { onNavigate?.(); selectProject(id) }
  const { openNewProject, openNewIssue } = useUI()
  const { theme, toggle } = useTheme()
  const { enabled, signOut } = useAuth()
  const canWrite = useCanWrite()
  // "Tichet nou" needs write access to the open project; "Proiect nou" is admin-only.
  const showNewBtn = project ? canWrite : isAdmin
  const dragId = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'personal' | 'work'>('all')

  const visibleProjects = filter === 'all' ? projects : projects.filter((p) => p.type === filter)

  // Chipsurile filtrează și numerele listelor inteligente: „nu-mi arăta
  // serviciul în weekend" e exact motivul pentru care există.
  const inFilter = (projectId: string) => {
    if (filter === 'all') return true
    return projects.find((p) => p.id === projectId)?.type === filter
  }
  const counts: Record<SmartListKind, number> = {
    today: smartLists.today.filter((i) => inFilter(i.projectId)).length,
    tomorrow: smartLists.tomorrow.filter((i) => inFilter(i.projectId)).length,
    week: smartLists.week.reduce((n, d) => n + d.issues.filter((i) => inFilter(i.projectId)).length, 0),
  }
  const overdueCount = smartLists.overdue.filter((i) => inFilter(i.projectId)).length

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">H</div>
        <div className="sidebar-brand-txt">
          <span className="sidebar-app-name">Horizontal</span>
          <span style={{ display: 'block', fontSize: '9px', color: 'var(--txt-dim)', opacity: 0.6, lineHeight: 1.4 }}>Built: {getBuildAgo()}</span>
        </div>
      </div>

      <button
        className={`sidebar-nav-item ${!project && !showUsers && !smartList ? 'on' : ''}`}
        onClick={() => goToProject(null)}
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

      {isAdmin && (
        <button
          className={`sidebar-nav-item ${showUsers ? 'on' : ''}`}
          onClick={() => onShowUsers?.()}
        >
          <span className="sidebar-nav-icon">
            <Icon name="members" size={14} />
          </span>
          <span>Utilizatori</span>
        </button>
      )}

      <div className="sidebar-section-label">Sarcini</div>

      {SMART_LISTS.map(({ kind, label, icon }) => (
        <button
          key={kind}
          className={`sidebar-nav-item ${smartList === kind ? 'on' : ''}`}
          onClick={() => onSmartList?.(kind)}
        >
          <span className="sidebar-nav-icon"><Icon name={icon} size={17} /></span>
          <span>{label}</span>
          {/* Restanțele nu au rând propriu: ar fi un rând gol în ziua bună.
              Trăiesc ca badge pe „Azi", fiindcă sunt o problemă de azi. */}
          {kind === 'today' && overdueCount > 0 && (
            <span className="sl-late" title={`${overdueCount} restanțe`}>{overdueCount}</span>
          )}
          {counts[kind] > 0 && <span className="sl-count">{counts[kind]}</span>}
        </button>
      ))}

      <div className="sidebar-section-label">Proiecte</div>

      <div style={{ display: 'flex', gap: 4, margin: '6px 0 2px', padding: '0 2px' }}>
        {(['all', 'personal', 'work'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ flex: 1, fontSize: 10, padding: '3px 0', borderRadius: 5, border: '1px solid var(--line-soft)',
              background: filter === f ? 'var(--accent)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--txt-dim)', cursor: 'pointer', fontWeight: filter === f ? 600 : 400 }}>
            {f === 'all' ? 'Toate' : f === 'personal' ? 'Personal' : 'Serviciu'}
          </button>
        ))}
      </div>

      <div className="sidebar-proj-list">
        {visibleProjects.map((p) => {
          const pct = Math.round(completion(p.id) * 100)
          const isActive = project?.id === p.id
          return (
            <div
              key={p.id}
              className={`sidebar-proj-item ${isActive ? 'on' : ''} ${dragOver === p.id ? 'drag-over' : ''}`}
              draggable
              onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => {
                // Un fișier tras deasupra ține de zona de attachment, nu de
                // reordonarea proiectelor — nu-l tratăm ca drop de reordonare.
                if (e.dataTransfer.types.includes('Files')) return
                e.preventDefault(); setDragOver(p.id)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes('Files')) return
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
              <span className="sidebar-drag-handle" title="Trage pentru a reordona" aria-label="Trage pentru a reordona"><Icon name="drag" size={15} /></span>
              <button className="sidebar-proj-btn" onClick={() => goToProject(p.id)}>
                <span className="sidebar-proj-dot" style={{ background: p.accent }} />
                <span className="sidebar-proj-name">{p.name}</span>
                <span className="sidebar-proj-pct">{pct}%</span>
              </button>
            </div>
          )
        })}
        {visibleProjects.length === 0 && (
          <p className="sidebar-empty">{filter === 'all' ? 'Niciun proiect încă' : 'Niciun proiect în această categorie'}</p>
        )}
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer-row">
        {showNewBtn && (
          <button
            className="sidebar-new-btn"
            onClick={project ? openNewIssue : openNewProject}
          >
            <span className="sidebar-new-plus">+</span>
            {project ? 'Tichet nou' : 'Proiect nou'}
          </button>
        )}
        <button className="sidebar-theme-btn" onClick={toggle} aria-label="Schimbă tema">
          {theme === 'dark' ? (
            <Icon name="themeLight" size={15} />
          ) : (
            <Icon name="themeDark" size={15} />
          )}
        </button>
        {enabled && (
          <button className="sidebar-theme-btn" onClick={() => signOut()} aria-label="Deconectare" title="Deconectare">
            <Icon name="logout" size={15} />
          </button>
        )}
      </div>
    </aside>
  )
}
