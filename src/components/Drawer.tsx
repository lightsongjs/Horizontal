import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { useHorizontal } from '../store'
import { useAuth } from '../auth'
import { swallowNextClick, useLongPress } from '../hooks'
import { drawerDismiss, LONG_PRESS_MS, lockAxis, movedBeyondTap, type Axis } from '../lib/swipe'
import { inboxProjectId } from '../lib/captureTokens'
import { livePins, movePin, pinKey, type PinKind } from '../lib/pins'
import { useReorderDrag } from './reorderDrag'
import { Icon } from './Icon'
import { ProjectMark } from './ProjectMark'
import { BuildAge } from './BuildAge'
import { PinGlyph, PinMenu, pinLabel, pinTarget, sameTarget, type MenuTarget, type NavTarget } from './NavMenu'

/** Ce e pe ecran acum, ca rândul lui să fie marcat. */
export type DrawerCurrent = NavTarget | null

interface Props {
  current: DrawerCurrent
  onPick(target: NavTarget): void
  onClose(): void
  onSettings(): void
  onNewProject(): void
  /** „+ Filtru" (fără id) și „Editează" din meniul unui filtru. */
  onFilterForm(id?: string): void
}

const same = sameTarget

export const initialsOf = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('ro-RO') || '?'

interface RowProps {
  icon: ReactNode
  label: string
  on: boolean
  onClick(): void
  /** Apăsare lungă → meniul de fixare. Absent = rândul nu se fixează (navigarea: Azi, 7 zile, Ale mele). */
  pin?: { kind: PinKind; ref: string }
  onMenu(t: MenuTarget): void
  count?: number
  /** Restanțele de pe „Azi" — același jeton ca în sidebar. */
  late?: number
  /** Necititele din „Ale mele" — bulina existentă. */
  fresh?: number
}

function Row({ icon, label, on, onClick, pin, onMenu, count, late, fresh }: RowProps) {
  const press = useLongPress(() => { if (pin) onMenu({ ...pin, label }) })
  return (
    <button type="button" className={`dr-row${on ? ' on' : ''}`} onClick={onClick} {...(pin ? press : {})}>
      <span className="dr-row-ico">{icon}</span>
      <span className="dr-row-label">{label}</span>
      {!!late && <span className="sl-late" title={`${late} restanțe`}>{late}</span>}
      {!!fresh && <span className="sl-new" title={`${fresh} necitite`}>{fresh}</span>}
      {!!count && <span className="dr-count">{count}</span>}
    </button>
  )
}

interface PinTileProps {
  label: string
  glyph: ReactNode
  on: boolean
  onClick(): void
  onLong(): void
  /** Tragerea comună a rândului de pătrate; null = un singur pătrat, n-are unde merge. */
  drag: ReturnType<typeof useReorderDrag> | null
  dragKey: string
}

/**
 * Un pătrat fixat. Ca pe ecranul de pornire din Android (2026-11-06): ținut
 * apăsat se ridică; tras de acolo își schimbă locul, iar ridicat fără să se
 * miște deschide meniul (Desprinde). Fără ceva de tras (un singur pătrat),
 * meniul vine pe loc, ca înainte.
 */
function PinTile({ label, glyph, on, onClick, onLong, drag, dragKey }: PinTileProps) {
  const el = useRef<HTMLButtonElement | null>(null)
  const timer = useRef<number | null>(null)
  const g = useRef<{ x: number; y: number; held: boolean; moving: boolean } | null>(null)
  const [held, setHeld] = useState(false)
  const live = useRef({ drag, onLong })
  live.current = { drag, onLong }
  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const finish = (commit: boolean) => {
    stopTimer()
    const s = g.current
    g.current = null
    setHeld(false)
    if (!s?.held) return
    if (s.moving) live.current.drag?.end(commit)
    else if (commit) live.current.onLong()
  }
  useEffect(() => {
    const node = el.current
    if (!node) return
    // Ridicat, pătratul nu lasă rândul (sau sertarul) să deruleze sub deget.
    // Ascultător nativ, nepasiv: unul din React n-are voie să oprească derularea.
    const block = (e: globalThis.TouchEvent) => { if (g.current?.held && e.cancelable) e.preventDefault() }
    node.addEventListener('touchmove', block, { passive: false })
    return () => { node.removeEventListener('touchmove', block); stopTimer() }
  }, [])

  const lifted = drag?.drag?.key === dragKey
  const offset = drag?.offset(dragKey)
  return (
    <button
      type="button"
      ref={(n) => { el.current = n; drag?.ref(dragKey)(n) }}
      className={`dr-pin${on ? ' on' : ''}${held || lifted ? ' lift' : ''}${drag?.drag && !lifted ? ' shifting' : ''}`}
      style={offset ? { transform: offset } : undefined}
      onClick={onClick}
      onTouchStart={(e) => {
        const t = e.touches[0]
        g.current = { x: t.clientX, y: t.clientY, held: false, moving: false }
        stopTimer()
        timer.current = window.setTimeout(() => {
          timer.current = null
          const s = g.current
          if (!s) return
          try { navigator.vibrate?.(12) } catch { /* fără vibrație */ }
          // Click-ul de la ridicarea degetului ar naviga (sau ar închide meniul).
          swallowNextClick()
          if (!live.current.drag) { g.current = null; live.current.onLong(); return }
          s.held = true
          setHeld(true)
        }, LONG_PRESS_MS)
      }}
      onTouchMove={(e) => {
        const s = g.current
        if (!s) return
        const t = e.touches[0]
        if (!s.held) {
          // S-a mișcat înainte de prag: e derulare sau închiderea sertarului.
          if (movedBeyondTap(t.clientX - s.x, t.clientY - s.y)) { stopTimer(); g.current = null }
          return
        }
        // Ridicat: degetul e al pătratului, nu al sertarului (care s-ar închide).
        e.stopPropagation()
        if (!s.moving) {
          if (!movedBeyondTap(t.clientX - s.x, t.clientY - s.y)) return
          s.moving = !!live.current.drag?.begin(dragKey, s.x)
        }
        if (s.moving) live.current.drag?.track(t.clientX)
      }}
      onTouchEnd={(e) => { if (g.current?.held) e.stopPropagation(); finish(true) }}
      onTouchCancel={() => finish(false)}
      onContextMenu={(e) => {
        // Chrome pe Android dă și el un `contextmenu` la apăsarea lungă —
        // apăsarea e a noastră. Click dreapta (mouse) deschide meniul.
        e.preventDefault()
        if (!g.current && timer.current === null && !held) onLong()
      }}
    >
      <span className="dr-pin-ico">{glyph}</span>
      <span className="dr-pin-name">{label}</span>
    </button>
  )
}

/**
 * Sertarul de navigare de pe telefon (sub 900px), ca la TickTick: cine ești și
 * rotița, rândul de pătrate fixate, listele, apoi proiectele. Înlocuiește
 * tab-ul „Proiecte" din bara de jos — bara spune unde ești, sertarul ține tot
 * ce nu e zilnic. Istoricul (Back îl închide) și navigarea stau în `App.tsx`;
 * aici e numai randare și meniul de fixare.
 */
export function Drawer({ current, onPick, onClose, onSettings, onNewProject, onFilterForm }: Props) {
  const { projects, smartLists, inbox, openCountByProject, pins, movePins, assignees, myAssigneeId, savedFilters, filterCounts } = useHorizontal()
  const { session, isAdmin } = useAuth()
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  const me = assignees.find((a) => a.id === myAssigneeId)?.name ?? null
  const email = session?.user.email ?? null
  const who = me ?? email ?? 'Local'

  const inboxId = inboxProjectId(projects)
  const inboxProject = inboxId ? projects.find((p) => p.id === inboxId) ?? null : null
  const pinned = livePins(pins, { projects: projects.map((p) => p.id), filters: savedFilters.map((f) => f.id) })
  // Ordinea pătratelor: ținut apăsat și tras (`PinTile`). A contului, ca în bara laterală.
  const livePinned = useRef(pinned)
  livePinned.current = pinned
  const pinDrag = useReorderDrag(pinned.map(pinKey), 'x', (key, to) => void movePins(movePin(livePinned.current, key, to)))
  const weekCount = smartLists.week.reduce((n, d) => n + d.issues.length, 0)
  const go = (t: NavTarget) => onPick(t)
  // Meniul ține de sertar: Back îl închide odată cu el.
  const openMenu = (t: MenuTarget) => setMenu({ kind: t.kind, ref: t.ref, label: t.label })

  // Tras spre stânga, sertarul se închide — oriunde pe el, nu doar pe fundalul
  // din dreapta. Aceeași regulă de direcție ca la rânduri (`lockAxis`): o
  // tragere verticală rămâne derulare.
  const drag = useRef<{ x: number; y: number; t: number; axis: Axis } | null>(null)
  const [dx, setDx] = useState(0)
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    drag.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: 'pending' }
  }
  const onTouchMove = (e: TouchEvent) => {
    const g = drag.current
    if (!g) return
    const t = e.touches[0]
    const mx = t.clientX - g.x
    if (g.axis === 'pending') g.axis = lockAxis(mx, t.clientY - g.y)
    if (g.axis === 'h') setDx(Math.min(0, mx))
  }
  const onTouchEnd = (e: TouchEvent) => {
    const g = drag.current
    drag.current = null
    if (g?.axis === 'h') {
      swallowNextClick()
      if (drawerDismiss(dx, e.timeStamp - g.t)) { onClose(); return }
    }
    setDx(0)
  }

  return (
    <>
      <div className="drawer-bg" onClick={onClose} style={dx ? { opacity: Math.max(0, 1 + dx / 300) } : undefined} />
      <nav
        className={`drawer${dx ? ' dragging' : ''}`}
        aria-label="Navigare"
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="dr-head">
          <span className="dr-avatar" aria-hidden="true">{initialsOf(who)}</span>
          <span className="dr-who">
            <span className="dr-name">{who}</span>
            {me && email && <span className="dr-email">{email}</span>}
            <BuildAge />
          </span>
          <button type="button" className="dr-gear" onClick={onSettings} aria-label="Setări" title="Setări">
            <Icon name="settingsApp" size={19} />
          </button>
        </div>

        <div className="dr-scroll">
          {/* Pătratele: numai proiecte și filtre (`livePins`). Navigarea (Azi,
              7 zile, Ale mele) e rândurile de sub ele și nu se mai fixează —
              un pătrat „7 zile" deasupra rândului „7 zile" era același lucru de două ori. */}
          {pinned.length > 0 && (
            <div className="dr-pins" role="list" aria-label="Fixate">
              {pinned.map((p) => {
                const t = pinTarget(p)
                if (!t) return null
                const label = pinLabel(p, projects, savedFilters)
                return (
                  <PinTile
                    key={pinKey(p)}
                    dragKey={pinKey(p)}
                    drag={pinned.length > 1 ? pinDrag : null}
                    label={label}
                    glyph={<PinGlyph pin={p} projects={projects} filters={savedFilters} />}
                    on={same(current, t)}
                    onClick={() => go(t)}
                    onLong={() => openMenu({ kind: p.kind, ref: p.ref, label })}
                  />
                )
              })}
            </div>
          )}

          <div className="dr-group">
            <Row icon={<span className="today"><Icon name="today" size={19} /></span>} label="Azi" on={same(current, { kind: 'screen', screen: 'today' })}
              onClick={() => go({ kind: 'screen', screen: 'today' })} onMenu={openMenu}
              count={smartLists.today.length} late={smartLists.overdue.length} />
            <Row icon={<Icon name="list" size={19} />} label="7 zile" on={same(current, { kind: 'screen', screen: 'week' })}
              onClick={() => go({ kind: 'screen', screen: 'week' })} onMenu={openMenu}
              count={weekCount} />
            <Row icon={<Icon name="people" size={19} />} label="Ale mele" on={same(current, { kind: 'screen', screen: 'inbox' })}
              onClick={() => go({ kind: 'screen', screen: 'inbox' })} onMenu={openMenu}
              fresh={inbox.fresh.length} />
            {inboxProject && (
              <Row icon={<ProjectMark project={inboxProject} size={19} />} label={inboxProject.name}
                on={same(current, { kind: 'project', id: inboxProject.id })}
                onClick={() => go({ kind: 'project', id: inboxProject.id })} onMenu={openMenu}
                pin={{ kind: 'project', ref: inboxProject.id }} count={openCountByProject[inboxProject.id]} />
            )}
          </div>

          {/* Filtrele salvate: personale, transversale, numai tichete deschise. */}
          <div className="dr-group dr-filters">
            <div className="dr-label">Filtre</div>
            {savedFilters.map((f) => (
              <Row key={f.id} icon={<Icon name={f.icon} size={19} />} label={f.name}
                on={same(current, { kind: 'filter', id: f.id })}
                onClick={() => go({ kind: 'filter', id: f.id })} onMenu={openMenu}
                pin={{ kind: 'filter', ref: f.id }} count={filterCounts[f.id]} />
            ))}
            <button type="button" className="dr-add" onClick={() => onFilterForm()}>
              <Icon name="add" size={16} /> Filtru
            </button>
          </div>

          <div className="dr-projects">
            <div className="dr-label">Proiecte</div>
            {projects.filter((p) => p.id !== inboxId).map((p) => (
              <Row key={p.id} icon={<ProjectMark project={p} dot="dr-dot" size={17} />} label={p.name}
                on={same(current, { kind: 'project', id: p.id })}
                onClick={() => go({ kind: 'project', id: p.id })} onMenu={openMenu}
                pin={{ kind: 'project', ref: p.id }} count={openCountByProject[p.id]} />
            ))}
            {projects.length === 0 && <p className="dr-empty">Niciun proiect încă.</p>}
            {isAdmin && (
              <button type="button" className="dr-add" onClick={onNewProject}>
                <Icon name="add" size={16} /> Proiect
              </button>
            )}
          </div>
        </div>
      </nav>
      {menu && (
        <PinMenu
          target={menu}
          onClose={() => setMenu(null)}
          onEdit={menu.kind === 'filter' ? () => onFilterForm(menu.ref) : undefined}
        />
      )}
    </>
  )
}
