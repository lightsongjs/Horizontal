import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { TicketCard } from './TicketCard'
import { WaveTabs } from './WaveTabs'
import { WaveActionsBar } from './WaveActionsBar'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav } from '../hooks'
import { LAYER_COLORS } from '../lib/layerColors'

export function OrdineView() {
  const { waves, activeWave } = useHorizontal()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size

  return (
    <div className="panel">
      <div className="wave-sel">
        <WaveTabs onWaveChange={wa.exitSelectMode} />
        <WaveActionsBar
          treeViewActive={wa.treeViewActive}
          onToggleTree={wa.toggleTree}
          hideDone={hideDone}
          onToggleHideDone={toggleHideDone}
          selectMode={wa.selectMode}
          onEnterSelect={wa.enterSelectMode}
          onExitSelect={wa.exitSelectMode}
        />
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => {
          const ready = i === 0
          const color = LAYER_COLORS[i % LAYER_COLORS.length]
          return (
            <div key={g.L} className={`layer ${ready ? 'ready' : ''}`} style={{ '--layer-color': color } as React.CSSProperties}>
              <div className="layer-head">
                <div className="layer-num">{g.L + 1}</div>
                <div>
                  <h4>{ready ? 'Începe aici' : `Layer ${g.L + 1}`}</h4>
                  <div className="sub">
                    {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${g.L}`} · {g.ids.length}{' '}
                    tichete
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
                  onToggleSelect={wa.toggleItem}
                  treeMode={wa.treeViewActive}
                  highlighted={wa.highlightedIds ? wa.highlightedIds.has(id) : undefined}
                  onTreeSelect={wa.handleTreeSelect}
                  focused={focusedId === id}
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
