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
 * grosimi de linie diferite s-ar vedea imediat. Clasa e `.t-mark`, numită pe
 * ROL (semn mic pe rând/chip), nu pe desen — `Recur` de mai jos o împarte
 * fără să mintă despre ce e.
 */
export function Bell() {
  return (
    <span className="t-mark" aria-label="Are memento">
      <Icon name="bell" size={12} />
    </span>
  )
}

/**
 * Semnul de repetare: „acest tichet e recurent".
 *
 * Exportat la fel ca `Bell` și din același motiv — folosit de `DueChip` ȘI de
 * `TaskRow`, ca „se repetă" să arate identic în modul proiecte și în listele
 * inteligente, la fel cum arată „are memento". Predicatul („are ceva de
 * arătat") trăiește o singură dată, aici, în `describeRrule`: cine randează
 * `<Recur rrule={...} />` nu poate recalcula altfel dacă tichetul se repetă,
 * deci un al treilea mod de afișare nu poate diverge fără să reimplementeze
 * funcția asta.
 *
 * Clasa e `.t-mark`, aceeași cu `Bell` — nu `.t-bell`: numele vechi descria un
 * desen, nu un rol, și „clopoțel" pe o iconiță de săgeți rotative ar fi
 * mințit exact genul de lucru pe care vocabularul de iconițe (`Icon.tsx`)
 * încearcă să-l evite.
 */
export function Recur({ rrule }: { rrule: string | null }) {
  const rec = describeRrule(rrule)
  if (!rec) return null
  return (
    <span className="t-mark" aria-label={`Se repetă ${rec}`}>
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
