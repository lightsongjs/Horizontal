import { useHorizontal } from '../store'
import { useCanWriteIn } from '../hooks'
import { hasTime, toTimeInput } from '../lib/schedule'
import type { Issue } from '../lib/types'

/** Clopoțel: „are memento". Inline, ca să moștenească `currentColor`. */
function Bell() {
  return (
    <span className="t-bell" title="Are memento" aria-label="Are memento">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    </span>
  )
}

const DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm']

interface Props {
  issue: Issue
  onOpen(id: string): void
  /** Restanță: ora și bifa devin roșii, iar ziua ratată se arată în locul orei. */
  late?: boolean
}

/**
 * Un rând de sarcină într-o listă inteligentă.
 *
 * Primește `Issue` ca obiect, nu id: sarcinile vin din TOATE proiectele, deci
 * `byId` (care ține doar proiectul deschis) nu le-ar găsi.
 *
 * Aceeași gramatică de clase ca `.list-row` din ListView — ținută în sincron
 * intenționat, ca cele două liste ale aplicației să arate ca una.
 */
export function TaskRow({ issue, onOpen, late = false }: Props) {
  const { toggleDone, projects } = useHorizontal()
  const canWrite = useCanWriteIn(issue.projectId)
  const project = projects.find((p) => p.id === issue.projectId)
  const timed = hasTime(issue)

  return (
    <button
      className={`list-row task-row ${issue.done ? 'done' : ''} ${late ? 'late' : ''}`}
      onClick={() => onOpen(issue.id)}
      data-issue-id={issue.id}
    >
      <span
        className="list-check"
        role="checkbox"
        aria-checked={issue.done}
        aria-label={issue.done ? 'Marchează nefăcut' : 'Marchează gata'}
        onClick={(e) => {
          e.stopPropagation()
          if (canWrite) void toggleDone(issue.id)
        }}
      >
        {issue.done ? '✓' : ''}
      </span>

      {timed ? (
        <span className="t-time">{toTimeInput(issue.dueAt!)}</span>
      ) : (
        // O restanță de zi întreagă nu are oră de arătat, dar are o zi ratată —
        // e informația care lipsește cel mai tare din rând.
        <span className="t-time allday">
          {late && issue.dueAt
            ? `${DAYS[new Date(issue.dueAt).getDay()]} ${new Date(issue.dueAt).getDate()}`
            : '—'}
        </span>
      )}

      <span className="list-title">{issue.title}</span>

      <span className="t-tail">
        {issue.urgent && <span className="t-urgent" title="Urgent">⚡</span>}
        {issue.remindAt && <Bell />}
        {project && (
          <span className="t-proj" title={project.name}>
            <span className="t-dot" style={{ background: project.accent }} />
            <span className="t-proj-name">{project.name}</span>
          </span>
        )}
      </span>
    </button>
  )
}
