import { hasTime, isOverdue, reminderKindOf, toDisplayDate, toShortDate, toTimeInput } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'

/**
 * Clopoțel: „are memento".
 *
 * Exportat de aici și folosit și de `TaskRow`, ca „are memento" să arate
 * identic în modul proiecte și în listele inteligente. Desenul vine din
 * vocabularul comun (`Icon`), nu dintr-un SVG scris pe loc: două clopoțele cu
 * grosimi de linie diferite s-ar vedea imediat.
 */
export function Bell() {
  return (
    <span className="t-bell" title="Are memento">
      <Icon name="bell" size={12} label="Are memento" />
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
