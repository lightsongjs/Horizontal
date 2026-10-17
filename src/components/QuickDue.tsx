import { toDateInput, toTimeInput } from '../lib/schedule'
import { DuePanel } from './DuePanel'

/**
 * Panoul de dată al capturii: același `DuePanel` ca foaia de tichet și
 * formularul (presetări, butoanele de zi și de oră = calendarul și ceasul
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
        dueDate={curDate}
        dueTime={curTime}
        onPreset={(day) => move(toDateInput(day.toISOString()), curTime)}
        onPickDate={(v) => { move(v, curTime); onPicked() }}
        onPickTime={(v) => { move(curDate || fallbackDay, v); onPicked() }}
        onClearTime={() => move(curDate, '')}
        onClear={onClear}
      />
    </div>
  )
}
