import { fromDisplayDate, fromTimeText, toDateInput, toTimeInput } from '../lib/schedule'
import { DuePanel, useDueFields } from './DuePanel'

/**
 * Panoul de dată al capturii: același `DuePanel` ca foaia de tichet și
 * formularul (presetări, `zz/ll/aaaa` + `hh:mm`, calendarul și ceasul
 * sistemului), dar nimic nu se scrie până la Trimite — fiecare alegere e
 * `manual.due` în ciornă, care bate data din titlu (`draftSchedule`), ca
 * vechea fâșie cu două inputuri native. Fără rândul mementoului și fără
 * „Se repetă": captura pune mementoul implicit, iar repetarea vine din titlu.
 *
 * Inline, deasupra rândului de controale, nu foaie de jos: foaia rapidă stă
 * lipită de tastatură. Butoanele panoului nu iau focusul (`keepFocus` pe
 * container, doar pentru butoane), deci tastatura rămâne sus și scrisul în
 * titlu continuă după o presetare; după calendar / ceas (popup-ul lor ia
 * focusul) focusul se întoarce pe titlu, ca înainte.
 */
export function QuickDue({ dueAt, allDay, fallbackDay, onDue, onPicked, onClear }: {
  dueAt: string | null
  allDay: boolean
  /** Ziua orei alese fără zi: ziua listei, altfel azi. */
  fallbackDay: string
  onDue(date: string, time: string): void
  onPicked(): void
  onClear(): void
}) {
  const curDate = dueAt ? toDateInput(dueAt) : ''
  const curTime = dueAt && !allDay ? toTimeInput(dueAt) : ''
  const f = useDueFields(curDate, curTime)
  const move = (date: string, time: string) => {
    if (date === curDate && time === curTime) return
    onDue(date, time)
  }
  return (
    <div
      className="qs-when"
      role="group"
      aria-label="Scadența"
      onPointerDown={(e) => { if ((e.target as Element).closest('button')) e.preventDefault() }}
    >
      <DuePanel
        now={new Date()}
        dueText={f.dueText}
        timeText={f.timeText}
        dueDate={f.dueDate}
        dueTime={f.dueTime}
        onDueText={(t) => {
          f.setDueText(t)
          const v = fromDisplayDate(t)
          if (v) move(v, curTime)
        }}
        onTimeText={(t) => {
          f.setTimeText(t)
          const v = fromTimeText(t)
          if (v && curDate) move(curDate, v)
        }}
        onTimeBlur={() => { if (f.timeText.trim() === '' && curDate) move(curDate, '') }}
        onPreset={(day) => move(toDateInput(day.toISOString()), curTime)}
        onPickDate={(v) => { move(v, curTime); onPicked() }}
        onPickTime={(v) => { move(curDate || fallbackDay, v); onPicked() }}
        onClear={onClear}
      />
    </div>
  )
}
