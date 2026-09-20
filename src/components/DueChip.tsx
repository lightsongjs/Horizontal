import { hasTime, isOverdue, reminderKindOf, toDisplayDate, toShortDate, toTimeInput } from '../lib/schedule'
import { describeRrule } from '../lib/recurrence'
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
    <span className="t-bell" aria-label="Are memento">
      <Icon name="bell" size={12} />
    </span>
  )
}

/**
 * Semnul de repetare: „acest tichet e recurent".
 *
 * Exportat la fel ca `Bell`, ca „se repetă" să arate identic oriunde apare un
 * jeton de scadență — deocamdată doar aici, dar `TaskRow` ar reutiliza-o la
 * fel cum reutilizează `Bell`, nu ar desena a doua iconiță. Refolosește clasa
 * `.t-bell` în loc de una nouă: e deja exact „iconiță mică, aliniată, în
 * culoarea de accent a jetonului" — ce mai are nevoie și semnul de repetare —
 * iar două semne mici cu culori diferite unul lângă altul ar fi exact ce
 * vocabularul comun de iconițe există să evite.
 */
export function Recur({ rrule }: { rrule: string | null }) {
  const rec = describeRrule(rrule)
  if (!rec) return null
  return (
    <span className="t-bell" aria-label={`Se repetă ${rec}`}>
      <Icon name="recurring" size={12} />
    </span>
  )
}

const REMINDER_LABEL: Record<string, string> = {
  due: 'memento la scadență',
  m30: 'memento 30 min înainte',
  d1: 'memento cu o zi înainte',
}

type Due = Pick<Issue, 'dueAt' | 'allDay' | 'remindAt' | 'done' | 'rrule'>

/** Textul din `title`: aici încape tot ce nu încape pe card. */
export function dueTitle(issue: Due, now: Date): string {
  if (!issue.dueAt) return ''
  const parts = [toDisplayDate(issue.dueAt) + (hasTime(issue) ? ` ${toTimeInput(issue.dueAt)}` : ' · toată ziua')]
  const kind = reminderKindOf(issue.dueAt, issue.remindAt)
  if (kind !== 'none') parts.push(REMINDER_LABEL[kind])
  const rec = describeRrule(issue.rrule)
  if (rec) parts.push(`se repetă ${rec}`)
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
      <Recur rrule={issue.rrule} />
    </span>
  )
}
