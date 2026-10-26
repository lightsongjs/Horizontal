import { useRef, useState } from 'react'
import type React from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useAuth } from '../auth'
import { useCanWrite, useCanWriteFn } from '../hooks'
import { SMART_LISTS, type SmartListKind } from './SmartListView'
import { Icon } from './Icon'
import { repository } from '../data'
import { logoutPlan } from '../lib/logoutPlan'
import { getAndroidBridge } from '../lib/androidBridge'
import { ProjectMark } from './ProjectMark'
import { livePins, type PinKind } from '../lib/pins'
import { PinGlyph, PinMenu, pinLabel, pinTarget, type MenuTarget } from './NavMenu'
import { initialsOf } from './Drawer'
import { inboxProjectId } from '../lib/captureTokens'
import { inboxFirst, reorderWithInboxFirst } from '../lib/projectOrder'
import type { NavAction, SidebarMarks } from '../lib/paneProtocol'

import { BuildAge } from './BuildAge'

interface SidebarProps {
  /** „Utilizatori” e deschis (din rotița de setări) — niciun proiect nu e „pe ecran”. */
  showUsers?: boolean
  onNavigate?: () => void
  smartList?: SmartListKind | null
  onSmartList?: (kind: SmartListKind) => void
  /** „Ale mele" e un ecran separat de `SmartListKind` (vezi `Screen` din
   *  App.tsx) — de-aia trei props proprii, în loc să lărgim `smartList`. */
  inboxActive?: boolean
  inboxUnread?: number
  /** Câte tichete stau acolo cu totul — ca `sl-count` de pe listele de sarcini. */
  inboxTotal?: number
  onInbox?: () => void
  /** Filtrul salvat deschis acum (ecranul `filter:<id>`), sau null. */
  filterId?: string | null
  onFilter?: (id: string) => void
  /** „+" de la titlul „Filtre" (fără id) și „Editează" din meniul unui filtru. */
  onFilterForm?: (id?: string) => void
  /** Câmpul „Caută” din capul barei (aceeași căutare ca O / Ctrl+F). */
  onSearch?: () => void
  /** „Împarte ecranul" (panoul dublu), jos în bară; doar de la 1200px. */
  onSplit?: () => void
  /**
   * Panoul dublu: bara e a GAZDEI și conduce panoul cu focus. Locul „pe ecran"
   * vine din ruta panoului (`marks`), nu din store-ul gazdei (care n-are
   * niciun proiect deschis), iar ce cere bara pleacă la panou (`onNav`).
   */
  split?: {
    marks: SidebarMarks
    /** 0 = stânga, 1 = dreapta; null cu un singur panou rămas. */
    focusIx: 0 | 1 | null
    onNav: (a: NavAction) => void
    /** Butonul de jos: cu două panouri îl închide pe cel fără focus; cu unul, îl redeschide pe al doilea. */
    onToggle: () => void
  }
}

export function Sidebar({ showUsers = false, onNavigate, smartList = null, onSmartList, inboxActive = false, inboxUnread = 0, inboxTotal = 0, onInbox, filterId = null, onFilter, onFilterForm, onSearch, onSplit, split }: SidebarProps = {}) {
  const { projects, project: storeProject, openCountByProject, selectProject, reorderProjects, smartLists, reportError, pins, savedFilters, filterCounts, assignees, myAssigneeId } = useHorizontal()
  // Meniul de fixare: click dreapta pe un rând, sau ⋮ pe rândul de proiect.
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const menuAt = (kind: PinKind, ref: string, label: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ kind, ref, label, at: { x: e.clientX, y: e.clientY } })
  }
  // În gazda panoului dublu proiectul „pe ecran" e al panoului cu focus.
  const project = split ? projects.find((p) => p.id === split.marks.projectId) ?? null : storeProject
  const other = split?.marks
  /** Punctul gri: locul panoului celălalt (macheta: „Deschis în celălalt panou"). */
  const otherDot = (on: boolean) => (on ? <span className="sidebar-other" title="Deschis în celălalt panou" /> : null)
  const pinned = livePins(pins, { projects: projects.map((p) => p.id), filters: savedFilters.map((f) => f.id) })
  // Pe un ecran-listă (Ale mele, un filtru) proiectul din store e doar al
  // tichetului deschis, nu ecranul — aceeași gardă ca `projectChrome`.
  const offProject = inboxActive || filterId !== null

  // Pleacă de pe orice strat (ex. Utilizatori), apoi deschide proiectul.
  const goToProject = (id: string) => {
    if (split) return split.onNav({ type: 'project', id })
    onNavigate?.(); selectProject(id)
  }
  const ui = useUI()
  const openNewProject = split ? () => split.onNav({ type: 'new-project' }) : ui.openNewProject
  const openNewIssue = split ? () => split.onNav({ type: 'new-issue' }) : ui.openNewIssue
  const openAppSettings = split ? () => split.onNav({ type: 'settings' }) : ui.openAppSettings
  const { enabled, signOut, session, isAdmin } = useAuth()
  const who = assignees.find((a) => a.id === myAssigneeId)?.name ?? session?.user.email ?? 'Local'
  const onSignOut = async () => {
    const st = repository.sync?.status() ?? { offline: false, pending: 0 }
    const offline = st.offline || navigator.onLine === false
    // Fără rețea, signOut-ul pică și sesiunea rămâne — dar coada ar fi fost deja
    // ștearsă: omul ar fi rămas logat, fără modificările lui și fără să știe.
    // Se decide ÎNAINTE de a întreba cutia: refuzul nu depinde de ea.
    if (offline) return reportError('Deconectarea necesită rețea.')
    // Acțiunile din notificări încă netrimise de cutia Android (coada ei). Dacă
    // cutia nu răspunde în 2 s, numărul e NECUNOSCUT — nu zero: cerem confirmare.
    const android = getAndroidBridge()
    let nativePending = 0
    let nativeUnknown = false
    if (android) {
      const q = await Promise.race([
        android.status().then((x) => x.queued, () => null),
        new Promise<null>((r) => setTimeout(() => r(null), 2000)),
      ])
      if (q === null) nativeUnknown = true
      else nativePending = q
    }
    const plan = logoutPlan({ offline, pending: st.pending, nativePending: nativeUnknown ? 1 : nativePending })
    // Coada e locală: după logout nu mai are cine s-o trimită.
    if (plan === 'confirm') {
      const msg = nativeUnknown
        ? `${st.pending} modificări în pagină și, posibil, altele în aplicație, netrimise, se vor pierde. Te deconectezi?`
        : `${st.pending + nativePending} modificări netrimise se vor pierde. Te deconectezi?`
      if (!window.confirm(msg)) return
    }
    // Coada se șterge DOAR după ce serverul a încheiat sesiunea.
    const err = await signOut()
    if (err) return reportError(err)
    await repository.sync?.clear()
    // Și starea nativă: sesiunea, alarmele, planul, coada. Fără asta, telefonul
    // ar suna mai departe mementourile contului vechi. Tot DUPĂ signOut-ul reușit.
    await android?.signOut().catch(() => {})
  }
  const canWriteStore = useCanWrite()
  const canWriteFn = useCanWriteFn()
  const canWrite = split ? (project ? canWriteFn(project.id) : false) : canWriteStore
  // Cromul de proiect al piciorului de sidebar e legat de proiectul DESCHIS ca
  // ecran, nu de orice proiect încărcat în store — o pasă docată deschisă din
  // „Ale mele" încarcă proiectul ei ca formularul să funcționeze, fără să te
  // mute pe boardul lui. Fără gardă, un click pe „Tichet nou" ar fi creat un
  // tichet ÎN PROIECTUL STRĂIN, exact scurgerea reparată la FAB și la taste.
  const projectChrome = offProject ? null : project
  // "Tichet nou" needs write access to the open project; "Proiect nou" is admin-only.
  const showNewBtn = projectChrome ? canWrite : isAdmin
  const dragId = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'personal' | 'work'>('all')

  // Inbox primul, oricare ar fi ordinea trasă (`inboxFirst`); restul o păstrează.
  const ordered = inboxFirst(projects)
  const visibleProjects = filter === 'all' ? ordered : ordered.filter((p) => p.type === filter)
  const inboxId = inboxProjectId(projects)

  // Chipsurile filtrează și numerele listelor inteligente: „nu-mi arăta
  // serviciul în weekend" e exact motivul pentru care există.
  const inFilter = (projectId: string) => {
    if (filter === 'all') return true
    return projects.find((p) => p.id === projectId)?.type === filter
  }
  const counts: Record<SmartListKind, number> = {
    today: smartLists.today.filter((i) => inFilter(i.projectId)).length,
    week: smartLists.week.reduce((n, d) => n + d.issues.filter((i) => inFilter(i.projectId)).length, 0),
  }
  const overdueCount = smartLists.overdue.filter((i) => inFilter(i.projectId)).length

  return (
    <aside className="sidebar">
      {/* Cine ești, apoi căutarea — ca în sertarul de pe telefon. Sub nume,
          vârsta buildului: a ajuns ultimul push aici? (`BuildAge`) */}
      <div className="sidebar-me">
        <span className="dr-avatar" aria-hidden="true">{initialsOf(who)}</span>
        <span className="sidebar-me-who">
          <span className="sidebar-me-name">{who}</span>
          <BuildAge />
        </span>
        <button className="sidebar-theme-btn" onClick={openAppSettings} aria-label="Setări" title="Setări">
          <Icon name="settingsApp" size={16} />
        </button>
      </div>
      {onSearch && (
        <button className="sidebar-search" onClick={onSearch}>
          <Icon name="search" size={15} />
          <span>Caută</span>
          <kbd>Ctrl F</kbd>
        </button>
      )}
      {split && split.focusIx !== null && (
        <div className="sidebar-who" title="Ctrl+Shift+[ / Ctrl+Shift+] mută focusul între panouri">
          <span className="sidebar-mini" aria-hidden="true"><i className={split.focusIx === 0 ? 'on' : ''} /><i className={split.focusIx === 1 ? 'on' : ''} /></span>
          Navighezi panoul din {split.focusIx === 0 ? 'stânga' : 'dreapta'}
        </div>
      )}

      {/* Fixatele: pe telefon sunt pătratele din sertar, aici rânduri
          obișnuite într-un grup sus — aceeași ordine, aceeași țintă. */}
      {pinned.length > 0 && (
        <>
          <div className="sidebar-section-label">Fixate</div>
          {pinned.map((p) => {
            const t = pinTarget(p)
            if (!t) return null
            const label = pinLabel(p, projects, savedFilters)
            const on = t.kind === 'project'
              ? !offProject && !smartList && !showUsers && project?.id === t.id
              : t.kind === 'filter' ? filterId === t.id
              : t.screen === 'inbox' ? inboxActive : smartList === t.screen
            return (
              <button
                key={`${p.kind}:${p.ref}`}
                className={`sidebar-nav-item sidebar-pinned ${on ? 'on' : ''}`}
                onClick={() => {
                  if (t.kind === 'project') goToProject(t.id)
                  else if (t.kind === 'filter') onFilter?.(t.id)
                  else if (t.screen === 'inbox') onInbox?.()
                  else onSmartList?.(t.screen as SmartListKind)
                }}
                onContextMenu={menuAt(p.kind, p.ref, label)}
              >
                <span className="sidebar-nav-icon"><PinGlyph pin={p} projects={projects} filters={savedFilters} size={16} /></span>
                <span className="sidebar-pinned-name">{label}</span>
              </button>
            )
          })}
        </>
      )}

      {SMART_LISTS.map(({ kind, label, icon }) => (
        <button
          key={kind}
          className={`sidebar-nav-item ${smartList === kind ? 'on' : ''}`}
          onClick={() => onSmartList?.(kind)}
          onContextMenu={kind === 'week' ? menuAt('list', 'week', '7 zile') : undefined}
        >
          <span className={`sidebar-nav-icon ${icon}`}><Icon name={icon} size={17} /></span>
          <span>{label}</span>
          {otherDot(!!other && other.otherScreen === kind)}
          {/* Restanțele nu au rând propriu: ar fi un rând gol în ziua bună.
              Trăiesc ca badge pe „Azi", fiindcă sunt o problemă de azi. */}
          {kind === 'today' && overdueCount > 0 && (
            <span className="sl-late" title={`${overdueCount} restanțe`}>{overdueCount}</span>
          )}
          {counts[kind] > 0 && <span className="sl-count">{counts[kind]}</span>}
        </button>
      ))}

      {/* „Ale mele" — cutia de pase. Nu vine din `SMART_LISTS`: n-are zi, deci
          nu se calculează layer/wave pe ea, e doar tot ce ți-a pasat cineva. */}
      <button
        className={`sidebar-nav-item ${inboxActive ? 'on' : ''}`}
        onClick={() => onInbox?.()}
        onContextMenu={menuAt('list', 'inbox', 'Ale mele')}
      >
        <span className="sidebar-nav-icon"><Icon name="people" size={17} /></span>
        <span>Ale mele</span>
        {otherDot(!!other && other.otherScreen === 'inbox')}
        {/* Două numere, ca pe „Azi" (restanțe + total): necititele sunt o
            chemare, totalul e mărimea listei. Necititele dispar când le-ai
            văzut; totalul rămâne cât timp tichetele sunt ale tale. */}
        {inboxUnread > 0 && <span className="sl-new" title={`${inboxUnread} necitite`}>{inboxUnread}</span>}
        {inboxTotal > 0 && <span className="sl-count">{inboxTotal}</span>}
      </button>

      {/* Doar filtrele și proiectele derulează; cine ești, căutarea și listele
          zilei rămân pe loc (pe telefon sertarul derulează tot). */}
      <div className="sidebar-scroll">
      {/* Filtrele salvate: „+" la titlu, ca un rând de adăugare să nu stea
          între ele. Personale — fiecare cont își vede doar filtrele lui. */}
      <div className="sidebar-section-label sidebar-section-row">
        <span>Filtre</span>
        <button type="button" className="sidebar-section-add" onClick={() => onFilterForm?.()} aria-label="Filtru nou" title="Filtru nou">
          <Icon name="add" size={14} />
        </button>
      </div>
      {savedFilters.map((f) => (
        <button
          key={f.id}
          className={`sidebar-nav-item ${filterId === f.id ? 'on' : ''}`}
          onClick={() => onFilter?.(f.id)}
          onContextMenu={menuAt('filter', f.id, f.name)}
        >
          <span className="sidebar-nav-icon"><Icon name={f.icon} size={17} /></span>
          <span className="sidebar-pinned-name">{f.name}</span>
          {otherDot(!!other && other.otherScreen === `filter:${f.id}`)}
          {filterCounts[f.id] > 0 && <span className="sl-count">{filterCounts[f.id]}</span>}
        </button>
      ))}

      {/* „+" la titlu, ca la filtre. Înainte „Proiect nou" stătea doar în
          piciorul barei, și numai fără proiect deschis — de când „Toate
          proiectele" a ieșit (2026-10-15) nu mai rămânea aproape niciodată
          vizibil. Proiectul nou e numai al adminului. */}
      <div className="sidebar-section-label sidebar-section-row">
        <span>Proiecte</span>
        {isAdmin && (
          <button type="button" className="sidebar-section-add" onClick={openNewProject} aria-label="Proiect nou" title="Proiect nou">
            <Icon name="add" size={14} />
          </button>
        )}
      </div>

      <div className="sidebar-seg" role="tablist">
        {(['all', 'personal', 'work'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Toate' : f === 'personal' ? 'Personal' : 'Serviciu'}
          </button>
        ))}
      </div>

      <div className="sidebar-proj-list">
        {visibleProjects.map((p) => {
          const open = openCountByProject[p.id] ?? 0
          const isActive = project?.id === p.id
          return (
            <div
              key={p.id}
              className={`sidebar-proj-item ${isActive ? 'on' : ''} ${dragOver === p.id ? 'drag-over' : ''}`}
              draggable={p.id !== inboxId}
              onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => {
                // Un fișier tras deasupra ține de zona de attachment, nu de
                // reordonarea proiectelor — nu-l tratăm ca drop de reordonare.
                if (e.dataTransfer.types.includes('Files')) return
                e.preventDefault(); setDragOver(p.id)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setDragOver(null)
                if (!dragId.current || dragId.current === p.id) return
                // Ordinea AFIȘATĂ (cu Inbox primul): lăsat peste Inbox, un
                // proiect trece imediat după el; Inbox însuși nu se trage.
                const next = reorderWithInboxFirst(projects, dragId.current, p.id)
                if (next) reorderProjects(next)
                dragId.current = null
              }}
              onDragEnd={() => { setDragOver(null); dragId.current = null }}
              onContextMenu={menuAt('project', p.id, p.name)}
            >
              {p.id === inboxId
                ? <span className="sidebar-drag-handle" aria-hidden="true" style={{ visibility: 'hidden' }}><Icon name="drag" size={15} /></span>
                : <span className="sidebar-drag-handle" title="Trage pentru a reordona" aria-label="Trage pentru a reordona"><Icon name="drag" size={15} /></span>}
              <button className="sidebar-proj-btn" onClick={() => goToProject(p.id)}>
                <ProjectMark project={p} dot="sidebar-proj-dot" size={14} />
                <span className="sidebar-proj-name">{p.name}</span>
                {otherDot(!!other && other.otherProjectId === p.id)}
                {/* Câte sarcini deschise are — procentul de gata nu ajuta la nimic aici. */}
                {open > 0 && <span className="sidebar-proj-pct">{open}</span>}
              </button>
              <button
                type="button"
                className="sidebar-row-menu"
                aria-label={`Meniu: ${p.name}`}
                title="Fixează / desprinde"
                onClick={(e) => setMenu({ kind: 'project', ref: p.id, label: p.name, at: { x: e.clientX, y: e.clientY } })}
              >
                <Icon name="menu" size={14} />
              </button>
            </div>
          )
        })}
        {visibleProjects.length === 0 && (
          <p className="sidebar-empty">{filter === 'all' ? 'Niciun proiect încă' : 'Niciun proiect în această categorie'}</p>
        )}
      </div>

      </div>

      <div className="sidebar-footer-row">
        {showNewBtn && (
          <button
            className="sidebar-new-btn"
            onClick={projectChrome ? openNewIssue : openNewProject}
          >
            <span className="sidebar-new-plus">+</span>
            {projectChrome ? 'Tichet nou' : 'Proiect nou'}
          </button>
        )}
        {(split || onSplit) && (
          <button
            className={`sidebar-theme-btn sidebar-split-btn${split?.focusIx !== null && split ? ' on' : ''}`}
            onClick={split ? split.onToggle : onSplit}
            aria-pressed={!!split && split.focusIx !== null}
            aria-label={split && split.focusIx !== null ? 'Un singur panou' : 'Împarte ecranul'}
            title={split && split.focusIx !== null ? 'Un singur panou' : 'Împarte ecranul'}
          >
            <Icon name="split" size={15} />
          </button>
        )}
        {enabled && (
          <button className="sidebar-theme-btn" onClick={() => void onSignOut().catch((e) => reportError(e instanceof Error ? e.message : String(e)))} aria-label="Deconectare" title="Deconectare">
            <Icon name="logout" size={15} />
          </button>
        )}
      </div>
      {menu && (
        <PinMenu
          target={menu}
          onClose={() => setMenu(null)}
          onEdit={menu.kind === 'filter' ? () => onFilterForm?.(menu.ref) : undefined}
        />
      )}
    </aside>
  )
}
