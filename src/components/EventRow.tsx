import { useUI } from '../ui'
import { eventTitle, occurrenceDayLabel, occurrenceTime, type EventOccurrence } from '../lib/calendarEvents'

/**
 * Un eveniment din Google Calendar, între sarcinile zilei.
 *
 * Deliberat MAI PUȚIN decât o sarcină: în locul bifei o bară verticală în
 * culoarea calendarului (un eveniment nu se bifează), ora ca interval, titlul
 * mai stins. Fără glisare, fără apăsare lungă, fără selecție — un `<button>`
 * simplu, nu `SwipeRow`. Atingerea deschide foaia de citit.
 */
export function EventRow({ occ }: { occ: EventOccurrence }) {
  const { openEvent } = useUI()
  const time = occurrenceTime(occ)
  const day = occurrenceDayLabel(occ)
  return (
    <button
      type="button"
      className={`list-row event-row${occ.ended ? ' ended' : ''}${occ.declined ? ' declined' : ''}`}
      style={{ ['--ev' as string]: occ.color }}
      onClick={() => openEvent(occ.event.id)}
      data-event-id={occ.event.id}
    >
      <span className="ev-bar" aria-hidden />
      <span className="t-time ev-time">{time}</span>
      <span className="list-title ev-title">{eventTitle(occ.event)}</span>
      {day && <span className="ev-day">{day}</span>}
    </button>
  )
}

/**
 * Banda din capul zilei: evenimentele de toată ziua și zilele 2+ ale celor
 * care trec de miezul nopții. Subțire — e contextul zilei, nu ceva de făcut.
 */
export function EventBand({ items }: { items: EventOccurrence[] }) {
  const { openEvent } = useUI()
  if (!items.length) return null
  return (
    <div className="ev-band">
      {items.map((o) => {
        const day = occurrenceDayLabel(o)
        return (
          <button
            key={o.key}
            type="button"
            className={`ev-band-item${o.ended ? ' ended' : ''}${o.declined ? ' declined' : ''}`}
            style={{ ['--ev' as string]: o.color }}
            onClick={() => openEvent(o.event.id)}
            data-event-id={o.event.id}
          >
            <span className="ev-band-title">{eventTitle(o.event)}</span>
            {day && <span className="ev-day">{day}</span>}
          </button>
        )
      })}
    </div>
  )
}
