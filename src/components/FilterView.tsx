import { useEffect, useMemo } from 'react'
import { useHorizontal } from '../store'
import { filterIssues, groupByProject } from '../lib/savedFilters'
import { isOverdue } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { TaskRow } from './TaskRow'
import { SplitView } from './SplitView'
import { ProjectMark } from './ProjectMark'
import { useTaskActions } from './TaskActions'

function ProjectGroup({ projectId, issues, onOpen, now }: { projectId: string; issues: Issue[]; onOpen(id: string): void; now: Date }) {
  const { projects } = useHorizontal()
  const ta = useTaskActions()
  const project = projects.find((p) => p.id === projectId)
  const selecting = ta.narrow && ta.selectMode
  return (
    <div className="list-group filter-group" style={project?.accent ? ({ ['--gc' as string]: project.accent }) : undefined}>
      <div
        className={`list-group-head${selecting ? ' selectable' : ''}`}
        role={selecting ? 'button' : undefined}
        onClick={selecting ? () => ta.toggleMany(issues.map((i) => i.id)) : undefined}
      >
        {project && <ProjectMark project={project} dot="filter-group-dot" size={14} />}
        <span className="list-group-label">{project?.name ?? projectId}</span>
        <span className="list-group-num">{issues.length}</span>
      </div>
      {issues.map((it) => <TaskRow key={it.id} issue={it} onOpen={onOpen} late={isOverdue(it, now)} />)}
    </div>
  )
}

/**
 * Ecranul unui filtru salvat: rândurile din „Azi" (aceleași gesturi, aceeași
 * selecție), grupate pe proiect. Fără FAB și fără rând de captură — ca „Ale
 * mele": un filtru n-are o zi sau un proiect implicit în care să cadă o
 * sarcină nouă. Peste 1200px, panoul lateral, ca listele inteligente.
 *
 * Datele sunt `openIssues` (toate tichetele nebifate, din toate proiectele),
 * nu `dueIssues`: un filtru „ale lui Mihai" trebuie să vadă și ce n-are dată.
 */
export function FilterView({ filterId, onOpenTask }: { filterId: string; onOpenTask(id: string): void }) {
  const { savedFilters, filtersLoaded, openIssues, openLoaded, projects, filterContext } = useHorizontal()
  const ta = useTaskActions()
  const filter = savedFilters.find((f) => f.id === filterId) ?? null
  const now = filterContext.now

  const matched = useMemo(
    () => (filter ? filterIssues(openIssues, filter.rules, filterContext) : []),
    [filter, openIssues, filterContext],
  )
  const groups = useMemo(() => groupByProject(matched, projects), [matched, projects])

  // Rândurile de pe ecran, pentru „Toate" din antetul selecției.
  const visibleKey = matched.map((i) => i.id).join(',')
  const { setVisible, exitSelectMode } = ta
  useEffect(() => { setVisible(visibleKey ? visibleKey.split(',') : []) }, [visibleKey, setVisible])
  // Selecția e a unei liste: alt filtru (sau alt ecran) o închide.
  useEffect(() => () => exitSelectMode(), [filterId, exitSelectMode])

  if (!filter) return <p className="empty">{filtersLoaded ? 'Filtrul nu mai există.' : 'Se încarcă…'}</p>
  if (!openLoaded) return <p className="empty">Se încarcă…</p>

  return (
    <SplitView>
      <div className="panel smart-list filter-list">
        {groups.length === 0 && <p className="day-empty">Niciun tichet deschis nu trece de filtru.</p>}
        {groups.map((g) => (
          <ProjectGroup key={g.projectId} projectId={g.projectId} issues={g.issues} onOpen={onOpenTask} now={now} />
        ))}
      </div>
    </SplitView>
  )
}
