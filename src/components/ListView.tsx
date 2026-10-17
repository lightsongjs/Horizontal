import { useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { HiddenDone, WaveTabs, type WhoFilter } from './WaveTabs'
import { NoWaves } from './NoWaves'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav, useCanWrite } from '../hooks'
import { layerVar } from '../lib/layerColors'
import { DueChip } from './DueChip'
import { TaskProgress } from './TaskProgress'
import { ObstacleChip } from './ObstacleChip'
import { Icon } from './Icon'
import { SplitView } from './SplitView'
import { displayIssueId } from '../lib/issueId'
import { isPinnedOpen, pinnedFirst } from '../lib/pinned'
import { useTaskActions } from './TaskActions'
import { PinMark, RowPin, useRowPinKey } from './RowPin'
import { useTheme } from '../theme'
import { useVimListBusy, useVimSelection } from '../vim'

export function ListView() {
  const { waves, activeWave, byId, stateOf, themeOf, toggleDone, blockedByObstacle, assignees, assigneeShort, project } = useHorizontal()
  const { openEditIssue, dockedIssueId } = useUI()
  const canWrite = useCanWrite()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)

  // Filtrul de om: „ce are Alex pe cap", nu o preferință — stare locală
  // vizualizării, nu în DB, nu în URL (ar bate cu restaurarea din LAST_VIEW_KEY).
  const [personFilter, setPersonFilter] = useState<string | 'none' | null>(null)

  const allIds = useMemo(() => orderedLayers.flatMap((g) => g.ids), [orderedLayers])
  const unassignedCount = useMemo(
    () => allIds.filter((id) => !byId[id]?.assigneeId).length,
    [allIds, byId],
  )
  const countFor = useMemo(() => {
    const counts = new Map<string, number>()
    for (const id of allIds) {
      const aid = byId[id]?.assigneeId
      if (aid) counts.set(aid, (counts.get(aid) ?? 0) + 1)
    }
    return counts
  }, [allIds, byId])
  // Doar oamenii care chiar au ceva în valul ăsta — un filtru cu zero e zgomot.
  // EXCEPȚIE: cel filtrat activ rămâne, chiar cu zero — la schimbarea valului
  // pe unul unde n-are nimic, un jeton care dispare ar lăsa filtrul aplicat
  // dar invizibil, iar lista goală s-ar citi ca „valul ăsta e gol", nu ca
  // „ai un filtru pus". Aici zero nu e zgomot, e rezultatul unei alegeri.
  const holders = useMemo(
    () => assignees.filter((a) => (countFor.get(a.id) ?? 0) > 0 || a.id === personFilter),
    [assignees, countFor, personFilter],
  )
  const showUnassignedChip = unassignedCount > 0 || personFilter === 'none'
  const filteredName =
    personFilter && personFilter !== 'none'
      ? (assignees.find((a) => a.id === personFilter)?.name ?? null)
      : null

  // Poarta e formată din DOUĂ condiții, deliberat, nu una singură:
  // `(holders.length > 0 || showUnassignedChip)` e regula veche (f43add2) —
  // arată filtrul dacă are ce arăta, inclusiv „Nepasate N" într-un val proaspăt
  // unde niciun holder nu ține nimic încă, dar proiectul chiar are oameni.
  // `&& assignees.length > 0` taie proiectele fără NICIUN om real, unde „Toți N"
  // și „Nepasate N" ar fi aceleași cifre. Ștergerea oricăreia din cele două
  // reproduce bug-ul pe care cealaltă îl repara. Filtrul stă în „⋯ → Al cui";
  // ales, apare în bandă ca jeton cu ✕.
  const who: WhoFilter | null =
    (holders.length > 0 || showUnassignedChip) && assignees.length > 0
      ? {
          value: personFilter,
          onChange: setPersonFilter,
          options: [
            { key: null, label: 'Toți', count: allIds.length },
            ...(showUnassignedChip ? [{ key: 'none' as const, label: 'Nepasate', count: unassignedCount }] : []),
            ...holders.map((a) => ({ key: a.id, label: a.name, count: countFor.get(a.id) ?? 0 })),
          ],
        }
      : null

  const visibleLayers = useMemo(() => {
    const matches = (id: string) => {
      if (personFilter === null) return true
      const aid = byId[id]?.assigneeId
      if (personFilter === 'none') return !aid
      return aid === personFilter
    }
    // Fixatele urcă primele ÎN layerul lor, nu peste layere: layerul e
    // calculat din dependențe („ce pot începe acum") și nu se negociază.
    const pinnedTop = (ids: string[]) => {
      const issues = ids.map((id) => byId[id]).filter((i) => !!i)
      return issues.some(isPinnedOpen) ? pinnedFirst(issues).map((i) => i.id) : ids
    }
    return orderedLayers
      .map((g) => ({ ...g, ids: pinnedTop(g.ids.filter(matches)) }))
      .filter((g) => g.ids.length > 0)
  }, [orderedLayers, personFilter, byId])
  const flatLayers = useMemo(() => visibleLayers.map((g) => g.ids), [visibleLayers])

  const wa = useWaveActions()
  // Cu modul Vim pornit, cursorul e al dispecerului (`src/vim.tsx`): j / k
  // merg rând cu rând prin layere, nu din layer în layer. Oprit, h j k l de azi.
  const { vim } = useTheme()
  const { focusedId } = useVimNav(flatLayers, !vim)
  // Arborele, confirmarea ștergerii și selecția goală își țin Escape-ul.
  useVimListBusy(wa.treeViewActive || wa.confirmDel || (wa.selectMode && wa.selectedIds.size === 0))
  // Space / Ctrl+A din modul Vim aleg în selecția „Listei" (cu bara ei de jos),
  // nu într-una paralelă; acțiunile (x, dd, D…) o folosesc ca ținte.
  useVimSelection({
    ids: () => (wa.selectMode ? [...wa.selectedIds] : []),
    toggle: (id) => { if (!wa.selectMode) { wa.exitTreeView(); wa.enterSelectMode() } wa.toggleSelected(id) },
    setAll: (ids) => { wa.exitTreeView(); wa.enterSelectMode(); for (const id of ids) if (!wa.selectedIds.has(id)) wa.toggleSelected(id) },
    clear: () => { if (wa.selectMode) wa.exitSelectMode() },
  })
  // F pe rândul ales cu H J K L sau cu focusul de tastatură (fără tichet deschis).
  useRowPinKey(focusedId)
  const ta = useTaskActions()

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size
  const inSelect = !wa.treeViewActive && wa.selectMode

  return (
    <SplitView>
      {/* Culoarea proiectului ajunge la bifele rândurilor prin `--pc`, ca în
          „Cards" și în listele inteligente („Senin"). */}
      <div className="panel" style={project?.accent ? ({ ['--pc' as string]: project.accent }) : undefined}>
        <WaveTabs
          onWaveChange={wa.exitSelectMode}
          modes={{
            tree: wa.treeViewActive,
            onToggleTree: wa.toggleTree,
            hideDone,
            onToggleHideDone: toggleHideDone,
            selectMode: wa.selectMode,
            onEnterSelect: wa.enterSelectMode,
            onExitSelect: wa.exitSelectMode,
            who,
          }}
        />

        {!waves.some((w) => w.number !== 0) && orderedLayers.length === 0 ? (
          <NoWaves />
        ) : orderedLayers.length === 0 ? (
          <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
        ) : visibleLayers.length === 0 ? (
          <p className="empty">
            {personFilter === 'none'
              ? 'Niciun tichet nepasat în acest val.'
              : filteredName
                ? `Niciun tichet pasat lui ${filteredName} în acest val.`
                : 'Niciun tichet pentru acest filtru.'}
          </p>
        ) : (
          visibleLayers.map((g, i) => (
            <div
              key={g.L}
              className="list-group"
              style={{ '--layer-color': layerVar(i) } as React.CSSProperties}
            >
              <div className="list-group-head">
                <span className="list-group-num">{g.L + 1}</span>
                <span className="list-group-label">{i === 0 ? 'Începe aici' : `Layer ${g.L + 1}`}</span>
                <span className="list-group-count">{g.ids.length}</span>
              </div>
              {g.ids.map((id) => {
                const it = byId[id]
                if (!it) return null
                const state = stateOf(id)
                const theme = it.theme ? themeOf(it.theme) : undefined
                const isSelected = wa.selectedIds.has(id)
                const obstructed = Boolean(blockedByObstacle[id]?.length)
                const treeClass = wa.treeViewActive
                  ? wa.highlightedIds === null
                    ? ''
                    : wa.highlightedIds.has(id)
                      ? ' tree-highlight'
                      : ' tree-dim'
                  : ''
                // Same class grammar as TicketCard.tsx (card variant) — keep in sync.
                const cls =
                  `list-row ${state}` +
                  (isSelected ? ' selected' : '') +
                  (dockedIssueId === id ? ' docked' : '') +
                  (inSelect ? ' in-select' : '') +
                  treeClass +
                  (focusedId === id ? ' vim-focused' : '') +
                  (obstructed ? ' blocat' : '')

                const handleClick = () => {
                  if (wa.treeViewActive) wa.handleTreeSelect(id)
                  else if (inSelect) wa.toggleSelected(id)
                  else openEditIssue(id)
                }

                const pinned = isPinnedOpen(it)
                // Piuneza-buton doar pe desktop și în modul obișnuit: în arbore
                // și în selecție un click pe rând înseamnă altceva.
                const pinnable = !ta.narrow && canWrite && !it.done && !inSelect && !wa.treeViewActive

                return (
                  <button
                    type="button"
                    key={id}
                    className={cls}
                    onClick={handleClick}
                    onContextMenu={pinnable ? (e) => { e.preventDefault(); ta.openRowMenu(id, { x: e.clientX, y: e.clientY }) } : undefined}
                    data-issue-id={id}
                  >
                    <span
                      className="list-check"
                      role="checkbox"
                      aria-checked={inSelect ? isSelected : it.done}
                      aria-label={
                        inSelect
                          ? (isSelected ? 'Deselectează' : 'Selectează')
                          : (it.done ? 'Marchează nefăcut' : 'Marchează gata')
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        if (wa.treeViewActive) return
                        if (inSelect) wa.toggleSelected(id)
                        else if (canWrite) void toggleDone(id)
                      }}
                    >
                      {inSelect
                        ? (isSelected ? <span className="sel-mark"><Icon name="check" size={12} /></span> : <span className="ck" />)
                        : (
                          <span className={`ck${it.done ? ' on' : ''}${it.urgent && !it.done ? ' urg' : ''}`}>
                            {it.done && <Icon name="check" size={12} />}
                          </span>
                        )}
                    </span>
                    {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                    <span className="list-title">{it.title}</span>
                    {/* Coada rândului: aceeași ordine ca `.t-tail` din TaskRow. */}
                    <span className="row-tail">
                      {/* Numele întreg pe ecran lat, pastila cu inițiale pe
                          telefon (CSS le schimbă la 560px): 96px de nume ar
                          fi luat jumătate din titlu acolo, iar titlul e
                          singurul lucru care contează într-o listă. */}
                      {(() => {
                        const who = assignees.find((a) => a.id === it.assigneeId)
                        if (!who) return null
                        return (
                          <>
                            <span className="row-who">{who.name}</span>
                            <span className="row-who-sm" title={who.name}>{assigneeShort[who.id] ?? '?'}</span>
                          </>
                        )
                      })()}
                      {pinnable
                        ? <RowPin pinned={pinned} onToggle={() => void ta.run({ kind: 'pin', value: !pinned }, [id])} />
                        : pinned && <PinMark />}
                      <TaskProgress desc={it.desc} />
                      <DueChip issue={it} />
                      <ObstacleChip issueId={id} />
                      {/* ID-ul în coadă: pe desktop se caută după el; sub
                          900px iese (CSS), titlul are nevoie de loc. */}
                      <span className="list-id">{displayIssueId(id)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )}

        <HiddenDone hideDone={hideDone} onShow={toggleHideDone} />

        {wa.selectMode && (
          <BulkBar
            selCount={selCount}
            otherWaves={otherWaves}
            confirmDel={wa.confirmDel}
            onBulkMove={(w) => void wa.handleBulkMove(w)}
            onRequestDelete={wa.openConfirm}
            onConfirmDelete={() => void wa.handleBulkDelete()}
            onCancelDelete={wa.cancelConfirm}
          />
        )}
      </div>
    </SplitView>
  )
}
