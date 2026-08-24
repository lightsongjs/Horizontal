import { useState } from 'react'
import { useHorizontal } from '../store'
import { PushToggle } from './PushToggle'
import { QuickAdd } from './QuickAdd'
import { TaskRow } from './TaskRow'
import { addDays, startOfLocalDay } from '../lib/schedule'
import type { Issue } from '../lib/types'

export type SmartListKind = 'today' | 'tomorrow' | 'week'

export const SMART_LISTS: { kind: SmartListKind; label: string; icon: string }[] = [
  { kind: 'today', label: 'Azi', icon: '★' },
  { kind: 'tomorrow', label: 'Mâine', icon: '→' },
  { kind: 'week', label: 'Next 7 days', icon: '▤' },
]

const DAYS_FULL = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']
const MON_FULL = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const MON = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const longDate = (d: Date) => `${DAYS_FULL[d.getDay()]}, ${d.getDate()} ${MON_FULL[d.getMonth()]}`

interface GroupProps {
  label: string
  date?: string
  issues: Issue[]
  color?: string
  onOpen(id: string): void
  late?: boolean
  /** Ce se scrie când grupul e gol. Absent = grupul dispare cu totul. */
  empty?: string
}

function Group({ label, date, issues, color, onOpen, late, empty }: GroupProps) {
  if (issues.length === 0 && !empty) return null
  return (
    <div className="list-group" style={color ? ({ ['--gc' as string]: color }) : undefined}>
      <div className="list-group-head">
        <span className="list-group-num">{issues.length}</span>
        <span className="list-group-label">{label}</span>
        {date && <span className="list-group-date">{date}</span>}
      </div>
      {issues.length > 0
        ? issues.map((it) => <TaskRow key={it.id} issue={it} onOpen={onOpen} late={late} />)
        : <p className="day-empty">{empty}</p>}
    </div>
  )
}

interface Props {
  kind: SmartListKind
  onOpenTask(id: string): void
  /** Se schimbă la fiecare cerere de focus pe quick add (butonul „+" din bara de jos). */
  focusSignal?: number
}

/**
 * Cele trei liste inteligente. Datele vin gata tăiate din `store.smartLists`
 * (motorul pur din `lib/schedule`), deci aici e numai randare.
 *
 * Restanțele apar NUMAI în „Azi", deasupra sarcinilor zilei: o restanță e o
 * problemă de azi, dar „Next 7 days" e o listă despre ce urmează.
 */
export function SmartListView({ kind, onOpenTask, focusSignal = 0 }: Props) {
  const { smartLists, dueLoaded } = useHorizontal()
  const [showDone, setShowDone] = useState(false)
  const now = new Date()
  const today = startOfLocalDay(now)

  // Scadența implicită a unei sarcini adăugate din listă e ziua listei. În
  // „Next 7 days" nu există o zi anume, deci azi.
  const defaultDueAt = (kind === 'tomorrow' ? addDays(today, 1) : today).toISOString()

  if (!dueLoaded) return <p className="empty">Se încarcă…</p>

  return (
    <div className="panel smart-list">
      <QuickAdd defaultDueAt={defaultDueAt} focusSignal={focusSignal} />
      {kind === 'today' && <PushToggle />}

      {kind === 'today' && (
        <>
          <Group
            label="Restanțe"
            issues={smartLists.overdue}
            color="var(--blocked)"
            onOpen={onOpenTask}
            late
          />
          <Group
            label="Azi"
            date={longDate(today)}
            issues={smartLists.today}
            color="var(--accent)"
            onOpen={onOpenTask}
            empty="Nimic pe azi. Frumos."
          />
          {smartLists.doneToday.length > 0 && (
            <>
              <button className="done-toggle" onClick={() => setShowDone((v) => !v)}>
                {showDone ? '▾' : '▸'} Terminate azi ({smartLists.doneToday.length})
              </button>
              {showDone && smartLists.doneToday.map((it) => (
                <TaskRow key={it.id} issue={it} onOpen={onOpenTask} />
              ))}
            </>
          )}
        </>
      )}

      {kind === 'tomorrow' && (
        <Group
          label="Mâine"
          date={longDate(addDays(today, 1))}
          issues={smartLists.tomorrow}
          color="var(--active)"
          onOpen={onOpenTask}
          empty="Mâine e liber. Deocamdată."
        />
      )}

      {kind === 'week' && smartLists.week.map(({ offset, date, issues }) => (
        <Group
          key={offset}
          label={offset === 0 ? 'Azi' : offset === 1 ? 'Mâine' : cap(DAYS_FULL[date.getDay()])}
          date={`${date.getDate()} ${MON[date.getMonth()]}`}
          issues={issues}
          color={offset === 0 ? 'var(--accent)' : offset === 1 ? 'var(--active)' : undefined}
          onOpen={onOpenTask}
          empty="—"
        />
      ))}
    </div>
  )
}
