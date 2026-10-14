import { useCallback, useMemo, useRef } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { TicketCard } from './TicketCard'
import { WaveGate } from './WaveGate'
import { WaveTabs } from './WaveTabs'
import { NoWaves } from './NoWaves'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav } from '../hooks'
import { layerVar } from '../lib/layerColors'

export function OrdineView() {
  const { waves, activeWave, blockedByObstacle, byId, project } = useHorizontal()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)
  // Stabil, ca `TicketCard` (memo) să nu se randeze din nou la fiecare foaie.
  const { openEditIssue } = useUI()
  const openRef = useRef(openEditIssue)
  openRef.current = openEditIssue
  const openCard = useCallback((id: string) => openRef.current(id), [])

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size

  return (
    // Culoarea proiectului ajunge la bifele cardurilor prin `--pc`, fără prop
    // nou pe `TicketCard` (memo — vezi „Listele lungi nu se randează").
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
        }}
      />

      <WaveGate />

      {!waves.some((w) => w.number !== 0) && orderedLayers.length === 0 ? (
        <NoWaves />
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => {
          const ready = i === 0
          const color = layerVar(i)
          // „Se poate începe" e o afirmație despre lucru de luat ACUM — un
          // tichet bifat nu mai e asta. `blockedBy` deja îl omite din hartă
          // (vezi lib/obstacles.ts), dar contorul îl număra ca „liber" în
          // loc să-l scoată din calcul; îl scoatem din ambele numere. Când
          // `hideDone` e pornit, `g.ids` deja nu conține tichete bifate, deci
          // filtrul de mai jos e un no-op — nu numără de două ori și nu dă
          // „0 din 0".
          const liveIds = g.ids.filter((id) => !byId[id]?.done)
          const freeCount = liveIds.filter((id) => !blockedByObstacle[id]?.length).length
          return (
            <div key={g.L} className={`layer ${ready ? 'ready' : ''}`} style={{ '--layer-color': color } as React.CSSProperties}>
              <div className="layer-head">
                <div className="layer-num">{g.L + 1}</div>
                <div>
                  <h4>{ready ? 'Începe aici' : `Layer ${g.L + 1}`}</h4>
                  <div className="sub">
                    {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${g.L}`} ·{' '}
                    {freeCount < liveIds.length ? `se poate începe · ${freeCount} din ${liveIds.length}` : `${g.ids.length} tichete`}
                  </div>
                </div>
                {ready && <span className="badge-now">Acum</span>}
              </div>
              {g.ids.map((id) => (
                <TicketCard
                  key={id}
                  id={id}
                  contextWave={activeWave}
                  selectMode={!wa.treeViewActive && wa.selectMode}
                  isSelected={wa.selectedIds.has(id)}
                  onToggleSelect={wa.toggleSelected}
                  treeMode={wa.treeViewActive}
                  highlighted={wa.highlightedIds ? wa.highlightedIds.has(id) : undefined}
                  onTreeSelect={wa.handleTreeSelect}
                  focused={focusedId === id}
                  onOpen={openCard}
                />
              ))}
            </div>
          )
        })
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
  )
}
