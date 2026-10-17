import { useLayoutEffect, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useTaskActions } from './TaskActions'
import { ChipPop } from './ChipPop'
import { DuePanel } from './DuePanel'
import { MoveTargets, useMoveAction } from './MoveProject'
import { hasTime, startOfLocalDay, toDateInput, toTimeInput } from '../lib/schedule'
import type { RowPop } from '../vim'
import type { Issue } from '../lib/types'

/**
 * Popoverul unui rând din modul Vim: `t` (data) și `M` (mutarea). Aceleași
 * corpuri ca în formular — `DuePanel`, `MoveTargets` — în aceeași cochilie
 * (`ChipPop`: Esc în captură, click în afară), ancorate sub rândul cursorului.
 *
 * Rândul e un `<button>`, deci popoverul nu poate sta în el: o cutie fixă,
 * pusă exact peste rând (portal în `body`), ține locul „rândului" pentru
 * `ChipPop`. Scrierile trec prin `TaskActions`, ca la bara de selecție:
 * aceeași anulare, aceeași coadă.
 */
export function VimRowPop({ pop, onClose }: { pop: RowPop; onClose(): void }) {
  const ta = useTaskActions()
  const frame = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const el = document.querySelector(`main .list-row[data-issue-id="${CSS.escape(pop.anchorId)}"]`)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [pop.anchorId])
  const issues = ta.issuesOf(pop.ids)
  if (!rect || !issues.length) return null
  const close = () => {
    onClose()
    // Focusul se întoarce în listă, unde e cursorul — nu pe un jeton care nu există.
    const a = document.activeElement as HTMLElement | null
    if (a && a !== document.body) a.blur()
  }
  return (
    <div
      ref={frame}
      className="vim-row-frame"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <ChipPop
        anchor={null}
        rowRef={frame}
        sheet={false}
        role={pop.kind === 'move' ? 'menu' : 'dialog'}
        label={pop.kind === 'move' ? 'Mută în proiect' : 'Data'}
        className={pop.kind === 'move' ? 'mv-pop' : 'fc-pop-date'}
        onClose={close}
      >
        {pop.kind === 'date'
          ? <RowDue issues={issues} ids={pop.ids} onDone={close} />
          : <RowMove issue={issues[0]} onDone={close} />}
      </ChipPop>
    </div>
  )
}

function RowDue({ issues, ids, onDone }: { issues: Issue[]; ids: string[]; onDone(): void }) {
  const ta = useTaskActions()
  const { updateIssue } = useHorizontal()
  const one = issues.length === 1 ? issues[0] : null
  const now = new Date()
  const act = (f: () => void) => { f(); onDone() }
  return (
    <>
      <p className="fc-h">{one ? one.title : `${issues.length} sarcini`}</p>
      <DuePanel
        now={now}
        dueDate={one?.dueAt ? toDateInput(one.dueAt) : ''}
        dueTime={one && hasTime(one) ? toTimeInput(one.dueAt!) : ''}
        onPreset={(day) => act(() => void ta.run({ kind: 'date', preset: { kind: 'pick', date: day, time: null } }, ids))}
        onPickDate={(v) => act(() => ta.applyDate(ids, v))}
        onPickTime={(v) => act(() => ta.applyTime(ids, v))}
        // „Fără oră" n-are presetare de grup: o scriere pe fiecare, ziua rămâne.
        onClearTime={() => act(() => {
          for (const i of issues) {
            if (!i.dueAt || i.allDay) continue
            void updateIssue(i.id, { dueAt: startOfLocalDay(new Date(i.dueAt)).toISOString(), allDay: true, remindAt: null })
          }
        })}
        onClear={() => act(() => void ta.run({ kind: 'date', preset: { kind: 'none' } }, ids))}
      />
    </>
  )
}

function RowMove({ issue, onDone }: { issue: Issue; onDone(): void }) {
  const { busy, error, pick } = useMoveAction(issue, { open: false, onDone })
  return (
    <>
      <p className="fc-h">Mută în proiect</p>
      {error && <p className="mv-why warn" role="alert">{error}</p>}
      <MoveTargets issue={issue} variant="menu" busy={busy} onPick={(id) => void pick(id)} />
    </>
  )
}
