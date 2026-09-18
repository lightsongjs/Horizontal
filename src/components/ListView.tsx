import { useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { WaveTabs } from './WaveTabs'
import { WaveActionsBar } from './WaveActionsBar'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav, useCanWrite } from '../hooks'
import { layerVar } from '../lib/layerColors'
import { DueChip } from './DueChip'
import { ObstacleChip } from './ObstacleChip'
import { Icon } from './Icon'
import { SplitView } from './SplitView'

export function ListView() {
  const { waves, activeWave, byId, stateOf, themeOf, toggleDone, blockedByObstacle, assignees } = useHorizontal()
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

  const visibleLayers = useMemo(() => {
    const matches = (id: string) => {
      if (personFilter === null) return true
      const aid = byId[id]?.assigneeId
      if (personFilter === 'none') return !aid
      return aid === personFilter
    }
    return orderedLayers
      .map((g) => ({ ...g, ids: g.ids.filter(matches) }))
      .filter((g) => g.ids.length > 0)
  }, [orderedLayers, personFilter, byId])
  const flatLayers = useMemo(() => visibleLayers.map((g) => g.ids), [visibleLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size
  const inSelect = !wa.treeViewActive && wa.selectMode

  return (
    <SplitView>
      <div className="panel">
        <div className="wave-sel">
          <WaveTabs onWaveChange={wa.exitSelectMode} canWrite={canWrite} />
          <WaveActionsBar
            treeViewActive={wa.treeViewActive}
            onToggleTree={wa.toggleTree}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
            selectMode={wa.selectMode}
            onEnterSelect={wa.enterSelectMode}
            onExitSelect={wa.exitSelectMode}
            canWrite={canWrite}
          />
        </div>

        {/* Frate al `.wave-sel`, nu al treilea copil: acolo `.wave-tabs` are
            flex:1 și un al treilea copil ar fura din taburile de val.
            Poarta e `holders.length > 0`, NU `showUnassignedChip` — fără ea,
            un proiect fără NICIUN assignee real (starea de azi în producție:
            `assignees` aproape goală) arăta „Toți N" și „Nepasate N" cu
            aceleași cifre, pe fiecare proiect: un filtru fără oameni de
            filtrat e zgomot, nu funcționalitate. */}
        {holders.length > 0 && (
          <div className="who-bar">
            <button
              type="button"
              className={`who-chip ${personFilter === null ? 'on' : ''}`}
              onClick={() => setPersonFilter(null)}
            >
              Toți <span className="n">{allIds.length}</span>
            </button>
            {showUnassignedChip && (
              <button
                type="button"
                className={`who-chip ${personFilter === 'none' ? 'on' : ''}`}
                onClick={() => setPersonFilter('none')}
              >
                Nepasate <span className="n">{unassignedCount}</span>
              </button>
            )}
            {holders.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`who-chip ${personFilter === a.id ? 'on' : ''}`}
                onClick={() => setPersonFilter(a.id)}
              >
                {a.name} <span className="n">{countFor.get(a.id) ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {waves.length === 0 ? (
          <p className="empty">Niciun val încă. Apasă rotița din bara de valuri ca să adaugi primul (sprint).</p>
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

                return (
                  <button type="button" key={id} className={cls} onClick={handleClick} data-issue-id={id}>
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
                      <Icon name={(inSelect ? isSelected : it.done) ? 'done' : 'notDone'} size={17} />
                    </span>
                    {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                    <span className="list-id">{id}</span>
                    <span className="list-title">{it.title}</span>
                    {/* Coada rândului: aceeași ordine ca `.t-tail` din TaskRow. */}
                    <span className="row-tail">
                      {it.urgent && <span className="tk-urgent" title="Urgent"><Icon name="urgent" size={13} /></span>}
                      <DueChip issue={it} />
                      <ObstacleChip issueId={id} />
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )}

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
