import { useEffect, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { swallowNextClick, useCanWriteFn } from '../hooks'
import { movePinned } from '../lib/pinned'
import { isOverdue } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { TaskRow } from './TaskRow'
import { useTaskActions } from './TaskActions'

interface Props {
  /** Fixatele grupului, deja în ordinea `comparePinned`. */
  issues: Issue[]
  onOpen(id: string): void
  dockedIssueId: string | null
}

interface Drag {
  id: string
  from: number
  to: number
  startY: number
  dy: number
  /** Mijloacele rândurilor la începutul tragerii — ținta se calculează pe ele. */
  mids: number[]
  /** Pasul dintre două rânduri (înălțime + spațiu). */
  step: number
}

/** Un mouse care a coborât pe un rând devine tragere abia după atâția pixeli; până atunci e click. */
const DRAG_SLOP_PX = 5

/**
 * Rândurile grupului „Fixate" („Azi", „7 zile"), cu ordinea trasă de mână
 * (2026-11-06). Noua ordine e un `pinnedAt` între vecini (`movePinned`), deci
 * o văd toate dispozitivele — și widget-ul de Android — fără nimic în plus.
 *
 * - Desktop / Linux: tragi rândul însuși cu mouse-ul (după `DRAG_SLOP_PX`; un
 *   click rămâne click). Alt+↑/↓ pe rândul cu focusul îl mută cu un loc.
 * - Telefon: mânerul din dreapta rândului (rândul are deja glisarea și apăsarea
 *   lungă pentru selecție, deci tragerea nu poate fi pe el). ↑/↓ pe mâner.
 *
 * Tiparul tragerii e cel din `WaveManager`: rândurile își fac loc cu
 * `transform`, DOM-ul se reordonează abia la eliberare (o mutare de nod în
 * timpul tragerii ar pierde pointerul).
 */
export function PinnedRows({ issues, onOpen, dockedIssueId }: Props) {
  const ta = useTaskActions()
  const { applyWrites } = useHorizontal()
  const canWrite = useCanWriteFn()
  const rows = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  const gesture = useRef<{ id: string; y: number; started: boolean; pointerId: number } | null>(null)
  const live = useRef({ issues, applyWrites, drag })
  live.current = { issues, applyWrites, drag }
  const sortable = issues.length > 1 && !ta.selectMode

  const move = (id: string, to: number) => {
    const writes = movePinned(live.current.issues, id, to, new Date())
    if (writes.length) void live.current.applyWrites(writes.map((w) => ({ id: w.id, patch: { pinnedAt: w.pinnedAt } })))
  }

  const begin = (id: string, startY: number) => {
    const list = live.current.issues
    const from = list.findIndex((i) => i.id === id)
    const rects = list.map((i) => rows.current.get(i.id)?.getBoundingClientRect())
    if (from < 0 || rects.some((r) => !r)) return
    const rs = rects as DOMRect[]
    const step = rs.length > 1 ? rs[1].top - rs[0].top : rs[0].height
    setDrag({ id, from, to: from, startY, dy: 0, mids: rs.map((r) => r.top + r.height / 2), step })
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      if (!g.started) {
        if (Math.abs(e.clientY - g.y) < DRAG_SLOP_PX) return
        g.started = true
        // Butonul rândului ar primi click-ul de la eliberare și l-ar deschide.
        swallowNextClick()
        begin(g.id, g.y)
      }
      setDrag((d) => {
        if (!d) return d
        const dy = e.clientY - d.startY
        const center = d.mids[d.from] + dy
        return { ...d, dy, to: d.mids.filter((m, j) => j !== d.from && m < center).length }
      })
    }
    const onUp = (e: PointerEvent) => {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      gesture.current = null
      const d = live.current.drag
      setDrag(null)
      if (g.started && d) move(d.id, d.to)
    }
    const onCancel = (e: PointerEvent) => {
      if (gesture.current?.pointerId !== e.pointerId) return
      gesture.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // `move` și `begin` citesc totul prin `live` / refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cât se trage, rândurile dintre `from` și `to` își fac loc cu un pas.
  const shift = (j: number): number => {
    if (!drag || j === drag.from) return 0
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -drag.step
    if (drag.from > drag.to && j >= drag.to && j < drag.from) return drag.step
    return 0
  }

  return (
    <>
      {issues.map((it, i) => {
        const movable = sortable && canWrite(it.projectId)
        const lifted = drag?.id === it.id
        const dy = lifted ? drag!.dy : shift(i)
        const step = (e: React.KeyboardEvent, by: -1 | 1) => {
          const to = i + by
          if (to < 0 || to >= issues.length) return
          e.preventDefault()
          move(it.id, to)
        }
        return (
          <div
            key={it.id}
            ref={(el) => { if (el) rows.current.set(it.id, el); else rows.current.delete(it.id) }}
            className={`pin-row${lifted ? ' lift' : ''}${drag && !lifted ? ' shifting' : ''}`}
            style={dy ? { transform: `translateY(${dy}px)` } : undefined}
            onPointerDown={movable && !ta.narrow ? (e) => {
              if (e.pointerType !== 'mouse' || e.button !== 0) return
              // Bifa, piuneza și un link din titlu își păstrează click-ul.
              if ((e.target as Element).closest('.list-check, .row-pin, a')) return
              gesture.current = { id: it.id, y: e.clientY, started: false, pointerId: e.pointerId }
            } : undefined}
            onKeyDown={movable && !ta.narrow ? (e) => {
              if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
              if (e.key === 'ArrowUp') step(e, -1)
              else if (e.key === 'ArrowDown') step(e, 1)
            } : undefined}
          >
            <TaskRow issue={it} onOpen={onOpen} late={isOverdue(it, new Date())} day docked={it.id === dockedIssueId} />
            {movable && ta.narrow && (
              <button
                type="button"
                className="pin-grip"
                aria-label={`Mută „${it.title}" în ordinea fixatelor`}
                title="Trage ca să muți (sau ↑/↓)"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  gesture.current = { id: it.id, y: e.clientY, started: true, pointerId: e.pointerId }
                  begin(it.id, e.clientY)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') step(e, -1)
                  else if (e.key === 'ArrowDown') step(e, 1)
                }}
              >
                <Icon name="drag" size={16} />
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
