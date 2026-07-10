import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { WaveTabs } from './WaveTabs'
import { WaveActionsBar } from './WaveActionsBar'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav } from '../hooks'
import { LAYER_COLORS } from '../lib/layerColors'

export function ListView() {
  const { waves, activeWave, byId, stateOf, themeOf, toggleDone } = useHorizontal()
  const { openEditIssue } = useUI()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size
  const inSelect = !wa.treeViewActive && wa.selectMode

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
        orderedLayers.map((g, i) => (
          <div
            key={g.L}
            className="list-group"
            style={{ '--layer-color': LAYER_COLORS[i % LAYER_COLORS.length] } as React.CSSProperties}
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
              const treeClass = wa.treeViewActive
                ? wa.highlightedIds === null
                  ? ''
                  : wa.highlightedIds.has(id)
                    ? ' tree-highlight'
                    : ' tree-dim'
                : ''
              const cls =
                `list-row ${state}` +
                (isSelected ? ' selected' : '') +
                (inSelect ? ' in-select' : '') +
                treeClass +
                (focusedId === id ? ' vim-focused' : '')

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
                      else void toggleDone(id)
                    }}
                  >
                    {(inSelect ? isSelected : it.done) ? '✓' : ''}
                  </span>
                  {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                  <span className="list-id">{id}</span>
                  <span className="list-title">{it.title}</span>
                  {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
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
  )
}
