import { useState, type ReactNode } from 'react'
import { useHorizontal } from '../store'
import { useAuth } from '../auth'
import { useLongPress } from '../hooks'
import { inboxProjectId } from '../lib/captureTokens'
import { livePins, type PinKind } from '../lib/pins'
import { Icon } from './Icon'
import { ProjectMark } from './ProjectMark'
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

const initialsOf = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('ro-RO') || '?'

interface RowProps {
  icon: ReactNode
  label: string
  on: boolean
  onClick(): void
  /** Apăsare lungă → meniul de fixare. Absent = rândul nu se fixează (Azi). */
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

function PinTile({ label, glyph, on, onClick, onLong }: { label: string; glyph: ReactNode; on: boolean; onClick(): void; onLong(): void }) {
  const press = useLongPress(onLong)
  return (
    <button type="button" className={`dr-pin${on ? ' on' : ''}`} onClick={onClick} {...press}>
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
  const { projects, smartLists, inbox, openCountByProject, pins, assignees, myAssigneeId, savedFilters, filterCounts } = useHorizontal()
  const { session, isAdmin } = useAuth()
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  const me = assignees.find((a) => a.id === myAssigneeId)?.name ?? null
  const email = session?.user.email ?? null
  const who = me ?? email ?? 'Local'

  const inboxId = inboxProjectId(projects)
  const inboxProject = inboxId ? projects.find((p) => p.id === inboxId) ?? null : null
  const pinned = livePins(pins, { projects: projects.map((p) => p.id), filters: savedFilters.map((f) => f.id) })
  const weekCount = smartLists.week.reduce((n, d) => n + d.issues.length, 0)
  const go = (t: NavTarget) => onPick(t)
  // Meniul ține de sertar: Back îl închide odată cu el.
  const openMenu = (t: MenuTarget) => setMenu({ kind: t.kind, ref: t.ref, label: t.label })

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <nav className="drawer" aria-label="Navigare">
        <div className="dr-head">
          <span className="dr-avatar" aria-hidden="true">{initialsOf(who)}</span>
          <span className="dr-who">
            <span className="dr-name">{who}</span>
            {me && email && <span className="dr-email">{email}</span>}
          </span>
          <button type="button" className="dr-gear" onClick={onSettings} aria-label="Setări" title="Setări">
            <Icon name="settingsApp" size={19} />
          </button>
        </div>

        <div className="dr-scroll">
          {pinned.length > 0 && (
            <div className="dr-pins" role="list" aria-label="Fixate">
              {pinned.map((p) => {
                const t = pinTarget(p)
                if (!t) return null
                const label = pinLabel(p, projects, savedFilters)
                return (
                  <PinTile
                    key={`${p.kind}:${p.ref}`}
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
            <Row icon={<Icon name="today" size={19} />} label="Azi" on={same(current, { kind: 'screen', screen: 'today' })}
              onClick={() => go({ kind: 'screen', screen: 'today' })} onMenu={openMenu}
              count={smartLists.today.length} late={smartLists.overdue.length} />
            <Row icon={<Icon name="list" size={19} />} label="7 zile" on={same(current, { kind: 'screen', screen: 'week' })}
              onClick={() => go({ kind: 'screen', screen: 'week' })} onMenu={openMenu}
              pin={{ kind: 'list', ref: 'week' }} count={weekCount} />
            <Row icon={<Icon name="people" size={19} />} label="Ale mele" on={same(current, { kind: 'screen', screen: 'inbox' })}
              onClick={() => go({ kind: 'screen', screen: 'inbox' })} onMenu={openMenu}
              pin={{ kind: 'list', ref: 'inbox' }} fresh={inbox.fresh.length} />
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
