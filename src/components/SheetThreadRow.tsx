import { useRef, type PointerEvent } from 'react'
import { useAuth } from '../auth'
import { useHorizontal } from '../store'
import { useThreadSummary } from '../data/threadSummary'
import { keepUnread, shortAgo, threadRowFromInbox, threadRowState, threadRowText } from '../lib/thread'
import { Icon } from './Icon'

/** Ca jetoanele foii: atingerea nu ia focusul (tastatura rămâne cum e). */
const keepFocus = (e: PointerEvent) => e.preventDefault()

/**
 * Rândul de fir din foaia de tichet (telefon): ultimul eveniment + numărul,
 * NUMAI dacă firul are ceva. Necitit, e pe accent, cu textul pe două rânduri;
 * citit, o linie gri. În foaie atingerea duce la formularul complet, derulat
 * la fir; în formular (panou, telefon) derulează doar până la Fir.
 * Macheta: `design/sheet-comments/index.html`.
 *
 * Nu încarcă firul: rezumatul (`threadSummary`, două cereri mici) e cerut
 * leneș la deschidere și ținut în memorie. Cât e pe drum, un tichet pasat
 * mie își arată necititul din cutia de pase; offline sau la eroare rândul
 * lipsește — nu minte.
 */
export function SheetThreadRow({ issueId, onOpen, icon = 'expand' }: {
  issueId: string
  onOpen(): void
  /** `expand` = duce în formularul complet (foaia); `toThread` = derulează în jos, la Fir (formularul). */
  icon?: 'expand' | 'toThread'
}) {
  const { assignees, myAssigneeId, inbox } = useHorizontal()
  const { session } = useAuth()
  const myUserId = session?.user.id ?? 'local'
  const summary = useThreadSummary(issueId)
  const live = summary === undefined
    ? threadRowFromInbox([...inbox.fresh, ...inbox.rest].find((r) => r.issueId === issueId))
    : threadRowState(summary, { userId: myUserId, assigneeId: myAssigneeId })
  // Necititul de la deschidere ține cât e montat rândul (`keepUnread`).
  const unreadAt = useRef<string | null>(null)
  if (live.kind === 'unread' && unreadAt.current === null) unreadAt.current = live.at
  const view = keepUnread(live, unreadAt.current)
  if (view.kind === 'hidden') return null

  const text = threadRowText(view, assignees, myUserId)
  const unread = view.kind === 'unread'
  const when = shortAgo(view.at, new Date())
  const label = `Firul${view.count !== null ? `, ${view.count} ${view.count === 1 ? 'eveniment' : 'evenimente'}` : ''}${unread ? ', necitit' : ''}: ${text.who}${text.body ? ` — ${text.body}` : ''}. Deschide firul.`

  return (
    <button
      type="button"
      className={`es-thread ${view.kind}`}
      aria-label={label}
      onPointerDown={keepFocus}
      onClick={onOpen}
    >
      <span className="es-thread-av" aria-hidden="true">{text.initials}</span>
      <span className="es-thread-tx">
        <span className="es-thread-who">
          <span className="es-thread-name">{text.who}</span>
          {when && <span className="es-thread-t">{when}</span>}
          {unread && <span className="es-thread-new">nou</span>}
        </span>
        {text.body && <span className={`es-thread-body${view.handoff ? ' q' : ''}`}>{text.body}</span>}
      </span>
      <span className="es-thread-n" aria-hidden="true">
        <Icon name="comment" size={14} />
        {view.count !== null && view.count}
        <Icon name={icon} size={15} />
      </span>
    </button>
  )
}
