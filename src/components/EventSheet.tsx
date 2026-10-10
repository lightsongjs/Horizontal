import { useCalendar } from '../calendar'
import { eventTitle, eventWhen, FALLBACK_COLOR } from '../lib/calendarEvents'
import { Icon } from './Icon'

/** Ce scrie pe butonul de videoconferință: numele serviciului, dacă îl recunoaștem. */
function meetLabel(url: string): string {
  if (/meet\.google\.com/i.test(url)) return 'Intră în Meet'
  if (/zoom\.us/i.test(url)) return 'Intră în Zoom'
  if (/teams\.(microsoft|live)\.com/i.test(url)) return 'Intră în Teams'
  return 'Intră în apel'
}

const RESPONSE: Record<string, string> = {
  declined: 'Ai refuzat',
  tentative: 'Poate',
  needsAction: 'Fără răspuns',
}

/**
 * Foaia unui eveniment din Google Calendar — numai de citit. Ce se schimbă la
 * un eveniment se schimbă în Google („Deschide în Google"); aici e doar ce-ți
 * trebuie în drum spre el: când, unde, linkul de apel.
 */
export function EventSheet({ eventId }: { eventId: string }) {
  const { events, accounts } = useCalendar()
  const e = events.find((x) => x.id === eventId)
  if (!e) return <p className="empty">Evenimentul nu mai e în calendar.</p>
  const cal = accounts.flatMap((a) => a.calendars).find((c) => c.id === e.calendarId)
  const response = e.response ? RESPONSE[e.response] : undefined

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">
          <span className="cdot" style={{ background: cal?.color || FALLBACK_COLOR }} />
          {cal?.name ?? 'Google Calendar'}
          {response && <>{' · '}{response}</>}
        </div>
        <h2 className={e.response === 'declined' ? 'ev-declined-title' : undefined}>{eventTitle(e)}</h2>
      </div>
      <div className="sheet-scroll event-sheet">
        <p className="ev-when">{eventWhen(e)}</p>
        {e.location && <p className="ev-where">{e.location}</p>}
        <div className="ev-actions">
          {e.meetUrl && (
            <a className="btn-primary sm" href={e.meetUrl} target="_blank" rel="noopener noreferrer">
              {meetLabel(e.meetUrl)}
            </a>
          )}
          {e.htmlLink && (
            <a className="btn-ghost" href={e.htmlLink} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={14} /> Deschide în Google
            </a>
          )}
        </div>
      </div>
    </>
  )
}
