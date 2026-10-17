import { useEffect, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { PushToggle } from './PushToggle'
import { QuickAdd } from './QuickAdd'
import { TaskRow } from './TaskRow'
import { useRowPinKey } from './RowPin'
import { unpinned } from '../lib/pinned'
import { addDays, isOverdue, startOfLocalDay, toShortDate, WEEK_FIRST_OFFSET } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Icon, type IconName } from './Icon'
import { SplitView } from './SplitView'
import { useMediaQuery } from '../hooks'
import { useTaskActions } from './TaskActions'
import { useCalendar } from '../calendar'
import { eventsOn, mergeDay, type DayEvents } from '../lib/calendarEvents'
import { EventBand, EventRow } from './EventRow'

/**
 * „Mâine" nu mai e o listă (2026-10-14): „7 zile" începe de mâine, deci o
 * listă separată ar fi fost primul grup din „7 zile" încă o dată. O stare
 * veche `'tomorrow'` (ultima vizualizare, `hzScreen`) se citește ca `'week'`
 * — vezi `isScreen` din `App.tsx`.
 */
export type SmartListKind = 'today' | 'week'

export const SMART_LISTS: { kind: SmartListKind; label: string; icon: IconName }[] = [
  { kind: 'today', label: 'Azi', icon: 'today' },
  { kind: 'week', label: '7 zile', icon: 'list' },
]

/**
 * Scadența implicită a unei sarcini adăugate din listă: ziua în care apare.
 * „Azi" → azi; „7 zile" începe de mâine, deci mâine — altfel captura ar
 * dispărea din lista în care tocmai ai scris-o. Comună rândului de captură și
 * foii rapide deschise din FAB.
 */
export function smartListDueAt(kind: SmartListKind, now = new Date()): string {
  const today = startOfLocalDay(now)
  return (kind === 'week' ? addDays(today, WEEK_FIRST_OFFSET) : today).toISOString()
}

const DAYS_FULL = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const now = () => new Date()

interface GroupProps {
  label: string
  date?: string
  issues: Issue[]
  color?: string
  onOpen(id: string): void
  late?: boolean
  /** Ce se scrie când grupul e gol. Absent = grupul dispare cu totul. */
  empty?: string
  /** Un buton în capul grupului (restanțele: „Mută pe azi"). */
  action?: { label: string; onClick(): void }
  /**
   * Evenimentele din Google Calendar ale zilei: banda de toată ziua sub cap,
   * cele cu oră amestecate printre sarcini (`mergeDay`). NU intră în număr —
   * numărul e „ce ai de făcut", iar o ședință nu se bifează.
   */
  events?: DayEvents
  /** Iconița din fața etichetei (restanțe: ceas, azi: stea). */
  icon?: IconName
  /**
   * Grupul „Fixate": ordinea vine gata (`comparePinned`, nu `mergeDay`, care
   * ar reordona după urgent și oră), iar fiecare rând își spune singur ziua
   * și dacă e restant — rândurile vin din zile diferite.
   */
  pinned?: boolean
}

function Group({ label, date, issues, color, onOpen, late, empty, action, events, icon, pinned }: GroupProps) {
  const ta = useTaskActions()
  const { dockedIssueId } = useUI()
  const hasEvents = !!events && (events.band.length > 0 || events.timed.length > 0)
  if (issues.length === 0 && !empty && !hasEvents) return null
  // În selecție, capul grupului alege tot grupul (sau îl scoate, dacă era ales tot).
  const selecting = ta.narrow && ta.selectMode && issues.length > 0
  return (
    <div className="list-group" style={color ? ({ ['--gc' as string]: color }) : undefined}>
      <div
        className={`list-group-head${selecting ? ' selectable' : ''}`}
        role={selecting ? 'button' : undefined}
        onClick={selecting ? () => ta.toggleMany(issues.map((i) => i.id)) : undefined}
      >
        {icon && <span className={`list-group-ico ${icon}`}><Icon name={icon} size={15} /></span>}
        <span className="list-group-label">{label}</span>
        <span className="list-group-num">{issues.length}</span>
        {date && <span className="list-group-date">{date}</span>}
        {action && !ta.selectMode && issues.length > 0 && (
          <button type="button" className="group-act" onClick={action.onClick}><Icon name="forward" size={13} />{action.label}</button>
        )}
      </div>
      {events && <EventBand items={events.band} />}
      {pinned ? issues.map((it) => (
        <TaskRow key={it.id} issue={it} onOpen={onOpen} late={isOverdue(it, now())} day docked={it.id === dockedIssueId} />
      )) : issues.length > 0 || (events && events.timed.length > 0)
        ? mergeDay(issues, events?.timed ?? []).map((r) => r.kind === 'issue'
          ? <TaskRow key={r.issue.id} issue={r.issue} onOpen={onOpen} late={late} docked={r.issue.id === dockedIssueId} />
          : <EventRow key={r.occ.key} occ={r.occ} />)
        : !hasEvents && <p className="day-empty">{empty}</p>}
    </div>
  )
}

interface Props {
  kind: SmartListKind
  onOpenTask(id: string): void
  /** Se schimbă la fiecare cerere de focus pe quick add (butonul „+" din bara de jos). */
  focusSignal?: number
  /** `a` / `C` din modul Vim: ziua rândului de sub cursor, peste cea a listei. */
  captureDueAt?: string | null
  onCaptured?(): void
}

/**
 * Cele trei liste inteligente. Datele vin gata tăiate din `store.smartLists`
 * (motorul pur din `lib/schedule`), deci aici e numai randare.
 *
 * Restanțele apar NUMAI în „Azi", deasupra sarcinilor zilei: o restanță e o
 * problemă de azi, dar „Next 7 days" e o listă despre ce urmează.
 */
export function SmartListView({ kind, onOpenTask, focusSignal = 0, captureDueAt = null, onCaptured }: Props) {
  const { smartLists, dueLoaded } = useHorizontal()
  const { dockedIssueId } = useUI()
  // F pe rândul cu focusul de tastatură (Tab), fără tichet deschis.
  useRowPinKey()
  const cal = useCalendar()
  const [showDone, setShowDone] = useState(false)
  // Un ceas pe minut, doar cât sunt evenimente: un eveniment terminat se
  // estompează fără să aștepte o altă randare.
  const [, setTick] = useState(0)
  const hasEvents = cal.events.length > 0
  useEffect(() => {
    if (!hasEvents) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [hasEvents])
  const now = new Date()
  const today = startOfLocalDay(now)
  const eventsFor = (d: Date) => eventsOn(cal.events, cal.calendars, d, now)

  const defaultDueAt = smartListDueAt(kind, now)
  // Pe telefon captura e foaia rapidă din FAB. Rândul ar fi un al doilea punct
  // de intrare, ar ocupa capul listei și ar ridica tastatura în mijlocul unei
  // liste care derulează — exact experiența pe care foaia o înlocuiește.
  const narrow = useMediaQuery('(max-width: 899px)')
  const ta = useTaskActions()

  // Fixatele stau în grupul „Fixate" de sus, deci grupurile zilelor le arată fără ele
  // (`unpinned`); numerele din antet, sertar și sidebar numără lista întreagă.
  const overdueRows = unpinned(smartLists.overdue)
  const todayRows = unpinned(smartLists.today)
  // Rândurile de pe ecran, pentru „Toate" din antetul selecției.
  const visible = kind === 'today'
    ? [...smartLists.pinned, ...overdueRows, ...todayRows, ...(showDone ? smartLists.doneToday : [])]
    : [...smartLists.weekPinned, ...smartLists.week.flatMap((d) => unpinned(d.issues))]
  const visibleKey = visible.map((i) => i.id).join(',')
  const { setVisible, exitSelectMode } = ta
  useEffect(() => { setVisible(visibleKey ? visibleKey.split(',') : []) }, [visibleKey, setVisible])
  // Selecția e a unei liste: alt ecran (sau altă listă) o închide.
  useEffect(() => () => exitSelectMode(), [kind, exitSelectMode])

  if (!dueLoaded) return <p className="empty">Se încarcă…</p>

  return (
    <SplitView>
      <div className="panel smart-list">
        {!narrow && <QuickAdd defaultDueAt={captureDueAt ?? defaultDueAt} focusSignal={focusSignal} onAdded={onCaptured} />}
        {kind === 'today' && <PushToggle />}

        {kind === 'today' && (
          <>
            {/* Fixatele: primul grup, deasupra restanțelor și a urgentelor — numai
                cele care sunt oricum în „Azi" (`buildSmartLists`, `lib/pinned.ts`). */}
            <Group
              label="Fixate"
              issues={smartLists.pinned}
              color="var(--accent)"
              icon="pin"
              onOpen={onOpenTask}
              pinned
            />
            <Group
              label="Restanțe"
              issues={overdueRows}
              color="var(--blocked)"
              icon="overdue"
              onOpen={onOpenTask}
              late
              action={{
                label: 'Mută restanțele pe azi',
                onClick: () => void ta.run({ kind: 'date', preset: { kind: 'today' } }, overdueRows.map((i) => i.id)),
              }}
            />
            <Group
              label="Azi"
              issues={todayRows}
              color="var(--txt)"
              icon="today"
              onOpen={onOpenTask}
              // Ziua nu e liberă dacă ce are e fixat sus.
              empty={todayRows.length < smartLists.today.length ? undefined : 'Nimic pe azi. Frumos.'}
              events={eventsFor(today)}
            />
            {smartLists.doneToday.length > 0 && (
              <>
                <button className="done-toggle" onClick={() => setShowDone((v) => !v)}>
                  <Icon name={showDone ? 'collapse' : 'expand'} size={15} /> Terminate azi ({smartLists.doneToday.length})
                </button>
                {showDone && smartLists.doneToday.map((it) => (
                  <TaskRow key={it.id} issue={it} onOpen={onOpenTask} docked={it.id === dockedIssueId} />
                ))}
              </>
            )}
          </>
        )}

        {kind === 'week' && (
          <Group
            label="Fixate"
            issues={smartLists.weekPinned}
            color="var(--accent)"
            icon="pin"
            onOpen={onOpenTask}
            pinned
          />
        )}
        {kind === 'week' && smartLists.week.map(({ offset, date, issues }) => {
          const rows = unpinned(issues)
          return (
            <Group
              key={offset}
              label={offset === 1 ? 'Mâine' : cap(DAYS_FULL[date.getDay()])}
              date={toShortDate(date)}
              issues={rows}
              onOpen={onOpenTask}
              // O zi al cărei singur rând e fixat sus nu e „—".
              empty={rows.length < issues.length ? undefined : '—'}
              events={eventsFor(date)}
            />
          )
        })}
      </div>
    </SplitView>
  )
}
