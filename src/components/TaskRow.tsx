import { useHorizontal } from '../store'
import { useCanWriteIn } from '../hooks'
import { hasTime, toShortDate, toTimeInput } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Bell } from './DueChip'

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
          {late && issue.dueAt ? toShortDate(issue.dueAt) : '—'}
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
