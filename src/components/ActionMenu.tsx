import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useCanWriteFn } from '../hooks'
import { useTaskActions } from './TaskActions'
import { NativePick } from './NativePick'
import {
  dateItems, itemForKey, LEVEL_TITLE, moveItems, pushDigit, rootItems, timeFromDigits, waveItems,
  type MenuAction, type MenuItem, type MenuLevel, type MenuTargets,
} from '../lib/actionMenu'
import { moveBlock, moveBlockMessage, moveTargets } from '../lib/moveIssue'
import { waveLabel } from '../lib/waveBar'
import { dateFromInput } from '../lib/nativePicker'
import { toDateInput } from '../lib/schedule'
import { displayIssueId } from '../lib/issueId'
import type { MenuState } from '../vim'

const WIDTH = 340

/**
 * Meniul de acțiuni al modului Vim (`m`; `t` / `M` / `w` direct pe un
 * sub-meniu). Ca fereastra „which-key", dar se alege din el: litera rândului
 * (aceeași cu tasta directă), sau j / k + Enter. Ce nu se poate pe ținte stă
 * stins, cu motivul lângă. În sub-meniul datei cifrele scriu o oră
 * (`1530` → 15:30) și Enter o pune. Backspace șterge o cifră sau urcă un
 * nivel; Esc urcă un nivel, apoi închide.
 *
 * Tastele sunt ascultate pe `window` în CAPTURĂ și oprite acolo, înaintea
 * dispecerului și a formularului: cât e deschis, nimic din spate nu primește
 * o literă. Focusul nu se mută — se întoarce singur unde era.
 *
 * Ce se execută NU e aici: `exec` trimite rândul ales dispecerului, care îl
 * duce prin `TaskActions` (anulare, coadă, refuzul pe formularul murdar).
 */
export function ActionMenu({ menu, onLevel, onClose, exec }: {
  menu: MenuState
  onLevel(level: MenuLevel): void
  onClose(): void
  exec(a: MenuAction, ids: string[]): void
}) {
  const ta = useTaskActions()
  const { projects, project, waves, issues: loaded, obstacleLinks } = useHorizontal()
  const canWrite = useCanWriteFn()
  const boxRef = useRef<HTMLDivElement>(null)
  const [ix, setIx] = useState(0)
  const [digits, setDigits] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const issues = ta.issuesOf(menu.ids)
  const targets = useMemo<MenuTargets>(() => {
    const projIds = new Set(issues.map((i) => i.projectId))
    const pid = projIds.size === 1 ? [...projIds][0] : null
    let wavesWhy: string | null = null
    let ws: MenuTargets['waves'] = []
    if (!pid) wavesWhy = 'tichete din proiecte diferite'
    else if (project?.id !== pid) wavesWhy = 'deschide proiectul ca să alegi valul'
    else {
      ws = [...waves].sort((a, b) => a.position - b.position)
        .map((w) => ({ number: w.number, label: w.number === 0 ? 'Notițe' : waveLabel(w) }))
      if (ws.length < 2) { wavesWhy = 'proiectul are un singur val'; ws = [] }
    }
    const one = issues.length === 1 ? issues[0] : null
    const block = one ? moveBlock(one, project?.id === one.projectId ? loaded : [], project?.id === one.projectId ? obstacleLinks : []) : null
    return {
      count: issues.length,
      allUrgent: issues.length > 0 && issues.every((i) => i.urgent),
      allPinned: issues.length > 0 && issues.every((i) => !!i.pinnedAt),
      allDone: issues.length > 0 && issues.every((i) => i.done),
      waves: ws,
      wavesWhy,
      projects: one ? moveTargets(projects, one.projectId, canWrite) : [],
      moveWhy: one && block ? moveBlockMessage(one.id, block) : null,
    }
  }, [issues, project, waves, loaded, obstacleLinks, projects, canWrite])

  const items: MenuItem[] = menu.level === 'root' ? rootItems(targets)
    : menu.level === 'date' ? dateItems(new Date())
    : menu.level === 'wave' ? waveItems(targets)
    : moveItems(targets)
  const empty = menu.level === 'move'
    ? targets.moveWhy ?? (items.length ? null : 'Nu ai alt proiect în care să-l muți.')
    : menu.level === 'wave' && !items.length ? targets.wavesWhy : null

  // Un nivel nou pornește de sus, fără cifre și fără motivul de dinainte.
  useEffect(() => { setIx(0); setDigits(''); setWhy(null) }, [menu.level])

  // Sub rândul cursorului (listă) sau sub jetoanele panoului; înăuntrul ferestrei.
  useLayoutEffect(() => {
    const anchor = menu.anchor
      ? document.querySelector(`main .list-row[data-issue-id="${CSS.escape(menu.anchor)}"]`)
      : document.querySelector('.split-pane .fc-row') ?? document.querySelector('.split-pane .sh-header')
    const box = boxRef.current
    const r = anchor?.getBoundingClientRect()
    const h = box?.offsetHeight ?? 320
    const w = Math.min(WIDTH, window.innerWidth - 16)
    if (!r) { setPos({ left: Math.max(8, (window.innerWidth - w) / 2), top: 80 }); return }
    const left = Math.max(8, Math.min(r.left + (menu.anchor ? 40 : 0), window.innerWidth - w - 8))
    const below = r.bottom + 4
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below
    setPos({ left, top })
  }, [menu.anchor, menu.level, items.length])

  const up = () => {
    if (menu.level !== 'root' && menu.fromRoot) onLevel('root')
    else onClose()
  }

  const choose = (it: MenuItem | undefined) => {
    if (!it) return
    if (it.disabled) { setWhy(`${it.label}: ${it.disabled}`); return }
    const a = it.action
    if (a.kind === 'sub') { onLevel(a.level); return }
    if (a.kind === 'calendar') {
      const input = boxRef.current?.querySelector<HTMLInputElement>('.native-pick-input')
      try { input?.showPicker() } catch { input?.click() }
      return
    }
    onClose()
    exec(a, menu.ids)
  }

  // Prin ref: ascultătorul se pune o dată, citește starea de acum.
  const state = useRef({ items, ix, digits, level: menu.level })
  state.current = { items, ix, digits, level: menu.level }
  const chooseRef = useRef(choose)
  chooseRef.current = choose
  const upRef = useRef(up)
  upRef.current = up

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      // Un selector nativ (calendarul) deschis își ține tastele.
      if ((document.activeElement as HTMLElement | null)?.classList.contains('native-pick-input')) return
      const s = state.current
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { upRef.current(); return }
      if (e.key === 'Backspace') {
        if (s.digits) setDigits(s.digits.slice(0, -1))
        else upRef.current()
        return
      }
      if (s.level === 'date' && /^[0-9]$/.test(e.key)) { setDigits(pushDigit(s.digits, e.key)); return }
      if (e.key === 'Enter' && s.level === 'date' && s.digits) {
        const time = timeFromDigits(s.digits)
        if (!time) { setWhy(`„${s.digits}" nu e o oră`); return }
        chooseRef.current({ key: '', label: time, action: { kind: 'date', preset: { kind: 'time', time } } })
        return
      }
      if (e.key === 'j' || e.key === 'ArrowDown') { setIx(Math.min(s.items.length - 1, s.ix + 1)); return }
      if (e.key === 'k' || e.key === 'ArrowUp') { setIx(Math.max(0, s.ix - 1)); return }
      if (e.key === 'Enter') { chooseRef.current(s.items[s.ix]); return }
      const hit = itemForKey(s.items, e.key)
      if (hit) chooseRef.current(hit)
    }
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const one = issues.length === 1 ? issues[0] : null
  const subject = one ? `${displayIssueId(one.id)} · ${one.title}` : `${issues.length} tichete`
  const time = digits ? timeFromDigits(digits) : null

  return (
    <div
      ref={boxRef}
      className="am-menu"
      role="menu"
      aria-label={LEVEL_TITLE[menu.level]}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
    >
      <div className="am-head">
        {menu.level !== 'root' && menu.fromRoot && <span className="am-crumb">Acțiuni ›</span>}
        <span className="am-title">{LEVEL_TITLE[menu.level]}</span>
      </div>
      <div className="am-subject" title={subject}>{subject}</div>
      {empty ? <p className="am-empty">{empty}</p> : items.map((it, i) => {
        const cls = `am-item${i === ix ? ' cur' : ''}${it.disabled ? ' off' : ''}${it.danger ? ' danger' : ''}`
        const body = (
          <>
            <span className="am-label">{it.label}{it.action.kind === 'sub' && <span className="am-more" aria-hidden="true"> ›</span>}</span>
            {it.disabled && <span className="am-why">{it.disabled}</span>}
            <kbd className="am-key">{it.key}</kbd>
          </>
        )
        // Calendarul: inputul nativ stă sub rând (un clic îl deschide direct),
        // iar tasta `c` îi cheamă `showPicker()` — pe desktop e un gest de tastatură.
        if (it.action.kind === 'calendar') {
          return (
            <NativePick
              key={it.key}
              type="date"
              label="Alege din calendar"
              className={cls}
              tabIndex={-1}
              initial={() => toDateInput(one?.dueAt ?? new Date().toISOString())}
              onPick={(v) => { onClose(); exec({ kind: 'date', preset: { kind: 'pick', date: dateFromInput(v), time: null } }, menu.ids) }}
            >
              {body}
            </NativePick>
          )
        }
        return (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cls}
            aria-disabled={!!it.disabled || undefined}
            onMouseEnter={() => setIx(i)}
            onClick={() => choose(it)}
          >
            {body}
          </button>
        )
      })}
      {menu.level === 'date' && (
        <div className="am-time">
          Oră: scrie cifrele (<kbd>1530</kbd>, <kbd>9</kbd>) + <kbd>Enter</kbd>
          {digits && <b className={`am-time-v${time ? '' : ' bad'}`}>{time ?? digits}</b>}
        </div>
      )}
      {why && <div className="am-flash" role="status">{why}</div>}
      <div className="am-foot">litera sau j / k + Enter · {menu.level !== 'root' && menu.fromRoot ? 'Esc / ⌫ înapoi' : 'Esc închide'}</div>
    </div>
  )
}
