import { hasTime, isOverdue, reminderKindOf, toDisplayDate, toShortDate, toTimeInput } from '../lib/schedule'
import type { Issue } from '../lib/types'

/** Clopoțel: „are memento". Inline, ca să moștenească `currentColor`. */
export function Bell() {
  return (
    <span className="t-bell" title="Are memento" aria-label="Are memento">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    </span>
  )
}

const REMINDER_LABEL: Record<string, string> = {
  due: 'memento la scadență',
  m30: 'memento 30 min înainte',
  d1: 'memento cu o zi înainte',
}

type Due = Pick<Issue, 'dueAt' | 'allDay' | 'remindAt' | 'done'>

/** Textul din `title`: aici încape tot ce nu încape pe card. */
export function dueTitle(issue: Due, now: Date): string {
  if (!issue.dueAt) return ''
  const parts = [toDisplayDate(issue.dueAt) + (hasTime(issue) ? ` ${toTimeInput(issue.dueAt)}` : ' · toată ziua')]
  const kind = reminderKindOf(issue.dueAt, issue.remindAt)
  if (kind !== 'none') parts.push(REMINDER_LABEL[kind])
  if (isOverdue(issue, now)) parts.unshift('Restanță')
  return parts.join(' · ')
}

interface Props {
  issue: Due
  /** „Acum" primit din afară acolo unde lista îl calculează deja o dată. */
  now?: Date
}

/**
 * Scadența unui tichet din modul proiecte: ziua, ora **dacă are una**, și
 * clopoțelul **dacă sună**.
 *
 * Un tichet fără scadență nu arată nimic. Absența e informația căutată, iar un
 * „—" pe fiecare card ar fi zgomot pe majoritatea lor: în modul proiecte
 * scadența e excepția, nu regula (în listele inteligente e invers, de asta
 * `TaskRow` chiar arată un „—" în coloana de oră).
 *
 * Anul lipsește din chip, ca la `toShortDate` peste tot altundeva; e în `title`.
 */
export function DueChip({ issue, now }: Props) {
  if (!issue.dueAt) return null
  const at = now ?? new Date()
  return (
    <span className={`due-chip${isOverdue(issue, at) ? ' late' : ''}`} title={dueTitle(issue, at)}>
      <span className="dc-date">{toShortDate(issue.dueAt)}</span>
      {hasTime(issue) && <span className="dc-time">{toTimeInput(issue.dueAt)}</span>}
      {issue.remindAt && <Bell />}
    </span>
  )
}
