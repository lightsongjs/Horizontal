import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useHorizontal } from '../store'
import { useCanWriteIn } from '../hooks'
import { useUI } from '../ui'
import { hasTime, toShortDate, toTimeInput } from '../lib/schedule'
import {
  LONG_PRESS_MS, crossedFull, dragOffset, inEdge, lockAxis, movedBeyondTap, release, restOffset,
  type Axis, type Rest,
} from '../lib/swipe'
import type { Issue } from '../lib/types'
import { Bell, Recur } from './DueChip'
import { Icon } from './Icon'
import { urgentActionFor, useTaskActions } from './TaskActions'

interface Props {
  issue: Issue
  onOpen(id: string): void
  /** Restanță: ora și bifa devin roșii, iar ziua ratată se arată în locul orei. */
  late?: boolean
}

const vibrate = (ms: number) => {
  // Nu există pe iOS și în unele WebView-uri; o lipsă nu e o eroare.
  try { navigator.vibrate?.(ms) } catch { /* fără vibrație */ }
}

/**
 * Un rând de sarcină într-o listă inteligentă.
 *
 * Primește `Issue` ca obiect, nu id: sarcinile vin din TOATE proiectele, deci
 * `byId` (care ține doar proiectul deschis) nu le-ar găsi.
 *
 * Aceeași gramatică de clase ca `.list-row` din ListView — ținută în sincron
 * intenționat, ca cele două liste ale aplicației să arate ca una.
 *
 * Pe telefon rândul se și glisează (dreapta: „Mâine"; stânga: Dată, Urgent,
 * ⋮) și intră în selecție la apăsare lungă. Pragurile sunt în `lib/swipe`;
 * aici doar se citește degetul. Pe desktop nu se schimbă nimic.
 */
export function TaskRow({ issue, onOpen, late = false }: Props) {
  const { toggleDone, projects } = useHorizontal()
  const { dockedIssueId } = useUI()
  const ta = useTaskActions()
  const canWrite = useCanWriteIn(issue.projectId)
  const project = projects.find((p) => p.id === issue.projectId)
  const timed = hasTime(issue)
  const selecting = ta.narrow && ta.selectMode
  const selected = selecting && ta.selectedIds.has(issue.id)

  const body = (
    <>
      <span
        className="list-check"
        role="checkbox"
        aria-checked={selecting ? selected : issue.done}
        aria-label={selecting ? (selected ? 'Deselectează' : 'Selectează') : issue.done ? 'Marchează nefăcut' : 'Marchează gata'}
        onClick={(e) => {
          e.stopPropagation()
          if (selecting) ta.toggleSelected(issue.id)
          else if (canWrite) void toggleDone(issue.id)
        }}
      >
        {selecting
          ? (selected ? <span className="sel-mark"><Icon name="check" size={12} /></span> : <Icon name="notDone" size={17} />)
          : <Icon name={issue.done ? 'done' : 'notDone'} size={17} />}
      </span>

      {timed ? (
        <span className="t-time">{toTimeInput(issue.dueAt!)}</span>
      ) : (
        // O restanță de zi întreagă nu are oră de arătat, dar are o zi ratată —
        // e informația care lipsește cel mai tare din rând.
        <span className="t-time allday">
          {late && issue.dueAt ? toShortDate(issue.dueAt) : '—'}
        </span>
      )}

      <span className="list-title">{issue.title}</span>

      <span className="t-tail">
        {issue.urgent && <span className="t-urgent" title="Urgent"><Icon name="urgent" size={13} /></span>}
        {issue.remindAt && <Bell />}
        <Recur rrule={issue.rrule} />
        {project && (
          <span className="t-proj" title={project.name}>
            <span className="t-dot" style={{ background: project.accent }} />
            <span className="t-proj-name">{project.name}</span>
          </span>
        )}
      </span>
    </>
  )

  const cls = `list-row task-row ${issue.done ? 'done' : ''} ${late ? 'late' : ''}${dockedIssueId === issue.id ? ' docked' : ''}`

  if (!ta.narrow) {
    return (
      <button className={cls} onClick={() => onOpen(issue.id)} data-issue-id={issue.id}>
        {body}
      </button>
    )
  }
  return (
    <SwipeRow issue={issue} cls={cls} onOpen={onOpen} canWrite={canWrite} selecting={selecting} selected={selected}>
      {body}
    </SwipeRow>
  )
}

interface SwipeProps {
  issue: Issue
  cls: string
  onOpen(id: string): void
  /** Doar-citire: nu se glisează (selecția rămâne — acolo se sare, cu raport). */
  canWrite: boolean
  selecting: boolean
  selected: boolean
  children: ReactNode
}

/** Rândul de telefon: banda din spate, rândul deasupra și degetul care le leagă. */
function SwipeRow({ issue, cls, onOpen, canWrite, selecting, selected, children }: SwipeProps) {
  const ta = useTaskActions()
  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLButtonElement>(null)
  const [rest, setRest] = useState<Rest>('closed')
  const [drag, setDrag] = useState<{ offset: number; crossed: boolean } | null>(null)
  // Ce citesc ascultătorii nativi: valorile de ACUM, nu ale randării în care
  // s-au atașat (se atașează o singură dată).
  const live = useRef({ rest, canSwipe: canWrite && !selecting, selecting })
  live.current = { rest, canSwipe: canWrite && !selecting, selecting }
  const act = useRef({ ta, issue })
  act.current = { ta, issue }
  /** Atingerea care tocmai s-a terminat a fost o glisare sau o apăsare lungă: fără click. */
  const swallowClick = useRef(false)

  // Alt rând s-a deschis, s-a derulat sau s-a atins în altă parte: se închide.
  useEffect(() => {
    if (ta.openRow !== issue.id && rest !== 'closed') setRest('closed')
  }, [ta.openRow, issue.id, rest])
  useEffect(() => { if (selecting) setRest('closed') }, [selecting])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let g: {
      x: number; y: number; axis: Axis; moved: boolean; width: number
      offset: number; crossed: boolean; long: ReturnType<typeof setTimeout> | null; longFired: boolean
    } | null = null

    const clearLong = () => { if (g?.long) { clearTimeout(g.long); g.long = null } }

    const onStart = (e: TouchEvent) => {
      // Uitat la FIECARE atingere nouă: după o glisare browserul de obicei nu
      // mai trimite click, iar un „înghite" rămas ar mânca următoarea atingere.
      swallowClick.current = false
      if (e.touches.length !== 1) { g = null; return }
      const t = e.touches[0]
      // Din margine pornește gestul „înapoi" al sistemului.
      if (inEdge(t.clientX, window.innerWidth)) { g = null; return }
      g = {
        x: t.clientX, y: t.clientY, axis: 'pending', moved: false,
        width: el.getBoundingClientRect().width, offset: restOffset(live.current.rest),
        crossed: false, long: null, longFired: false,
      }
      const gg = g
      if (!live.current.selecting) {
        gg.long = setTimeout(() => {
          gg.long = null
          if (gg.moved) return
          gg.longFired = true
          vibrate(15)
          const { ta: a, issue: i } = act.current
          a.setOpenRow(null)
          a.enterSelectMode([i.id])
        }, LONG_PRESS_MS)
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x
      const dy = t.clientY - g.y
      if (!g.moved && movedBeyondTap(dx, dy)) { g.moved = true; clearLong() }
      if (g.axis === 'pending') {
        g.axis = lockAxis(dx, dy)
        if (g.axis === 'h' && live.current.canSwipe) {
          const { ta: a, issue: i } = act.current
          if (a.openRow !== i.id) a.setOpenRow(null)
        }
      }
      if (g.axis !== 'h' || !live.current.canSwipe) return
      // Orizontal, blocat: derularea nu mai are ce căuta în gestul ăsta.
      if (e.cancelable) e.preventDefault()
      g.offset = dragOffset(live.current.rest, dx, g.width)
      const crossed = crossedFull(g.offset, g.width)
      if (crossed && !g.crossed) vibrate(8)
      g.crossed = crossed
      setDrag({ offset: g.offset, crossed })
    }

    const onEnd = () => {
      if (!g) return
      // Întâi anularea, apoi `g = null`: `clearLong` citește `g`. Invers,
      // temporizatorul supraviețuia ridicării și orice atingere scurtă intra
      // în selecție după 450 ms, sub foaia deschisă.
      clearLong()
      const cur = g
      g = null
      if (cur.moved || cur.longFired) swallowClick.current = true
      if (cur.axis !== 'h' || !live.current.canSwipe) { setDrag(null); return }
      const r = release(cur.offset, cur.width)
      const { ta: a, issue: i } = act.current
      setDrag(null)
      if (r.kind === 'commit-right') {
        setRest('closed')
        a.setOpenRow(null)
        void a.run({ kind: 'date', preset: { kind: 'tomorrow' } }, [i.id])
      } else if (r.kind === 'full-left') {
        setRest('closed')
        a.openSheet('date', [i.id])
      } else {
        setRest(r.rest)
        a.setOpenRow(r.rest === 'closed' ? null : i.id)
      }
    }

    const onCancel = () => {
      clearLong()
      g = null
      setDrag(null)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    // Nepasiv: după blocarea pe orizontală, `preventDefault` oprește derularea.
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      clearLong()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [])

  const offset = drag ? drag.offset : restOffset(rest)
  const side = offset > 0 ? 'show-left' : offset < 0 ? 'show-right' : ''
  const close = () => { setRest('closed'); ta.setOpenRow(null) }

  const onClick = () => {
    if (swallowClick.current) { swallowClick.current = false; return }
    if (selecting) { ta.toggleSelected(issue.id); return }
    // O atingere pe un rând deschis îl închide, nu deschide foaia.
    if (rest !== 'closed') { close(); return }
    onOpen(issue.id)
  }

  return (
    <div
      ref={wrapRef}
      className={`swipe ${side}${drag?.crossed ? ' crossed' : ''}${drag ? ' dragging' : ''}`}
      data-swipe-id={issue.id}
    >
      {canWrite && (
        <>
          <div className="swipe-strip swipe-left" aria-hidden={rest !== 'left'}>
            <button
              type="button"
              className="swipe-btn primary"
              aria-label="Mâine"
              tabIndex={rest === 'left' ? 0 : -1}
              onClick={() => { close(); void ta.run({ kind: 'date', preset: { kind: 'tomorrow' } }, [issue.id]) }}
            >
              <Icon name="tomorrow" size={18} />
            </button>
          </div>
          <div className="swipe-strip swipe-right" aria-hidden={rest !== 'right'}>
            <button
              type="button"
              className="swipe-btn primary"
              aria-label="Dată"
              tabIndex={rest === 'right' ? 0 : -1}
              onClick={() => ta.openSheet('date', [issue.id])}
            >
              <Icon name="due" size={18} />
            </button>
            <button
              type="button"
              className="swipe-btn"
              aria-label={issue.urgent ? 'Scoate urgent' : 'Urgent'}
              tabIndex={rest === 'right' ? 0 : -1}
              onClick={() => { close(); void ta.run(urgentActionFor([issue]), [issue.id]) }}
            >
              <Icon name="urgent" size={18} />
            </button>
            <button
              type="button"
              className="swipe-btn"
              aria-label="Mai multe"
              tabIndex={rest === 'right' ? 0 : -1}
              onClick={() => ta.openSheet('more', [issue.id])}
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        </>
      )}
      <button
        ref={rowRef}
        className={`${cls}${selecting ? ' in-select' : ''}${selected ? ' selected' : ''}`}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
        data-issue-id={issue.id}
      >
        {children}
      </button>
    </div>
  )
}
