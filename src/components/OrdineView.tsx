import { useState, useCallback, useEffect } from 'react'
import { layerKeys } from '../lib/engine'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { TicketCard } from './TicketCard'
import { getRelatedIds } from '../lib/treeTraversal'

const LAYER_COLORS = [
  '#3ecf8e', // 0 — green (start here)
  '#6e7bff', // 1 — indigo
  '#ffb454', // 2 — amber
  '#a06eff', // 3 — purple
  '#46d1d9', // 4 — cyan
  '#f78fb3', // 5 — pink
  '#ff6b6b', // 6 — coral
  '#38bdf8', // 7 — sky blue
]

export function OrdineView() {
  const { waves, issues, activeWave, setActiveWave, layers, deleteIssue, updateIssue, byId } = useHorizontal()
  const { openWaveManage } = useUI()
  const keys = layerKeys(layers)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [treeViewActive, setTreeViewActive] = useState(false)
  const [treeHighlightId, setTreeHighlightId] = useState<string | null>(null)

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmDel(false)
  }, [])

  const exitTreeView = useCallback(() => {
    setTreeViewActive(false)
    setTreeHighlightId(null)
  }, [])

  const handleTreeSelect = useCallback((id: string) => {
    setTreeHighlightId((prev) => (prev === id ? null : id))
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDel) { setConfirmDel(false); return }
        if (treeViewActive) { exitTreeView(); return }
        if (selectMode) exitSelectMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, confirmDel, treeViewActive, exitSelectMode, exitTreeView])

  useEffect(() => { exitTreeView() }, [activeWave]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBulkMove = async (targetWave: number) => {
    await Promise.all([...selectedIds].map((id) => updateIssue(id, { wave: targetWave })))
    exitSelectMode()
  }

  const handleBulkDelete = async () => {
    await Promise.all([...selectedIds].map((id) => deleteIssue(id)))
    exitSelectMode()
  }

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = selectedIds.size

  const highlightedIds: Set<string> | null = treeHighlightId
    ? new Set([treeHighlightId, ...getRelatedIds(treeHighlightId, byId)])
    : null

  return (
    <div className="panel">
      <div className="wave-sel">
        <div className="wave-tabs">
          {waves.map((w) => {
            const cnt = issues.filter((i) => i.wave === w.number).length
            return (
              <button
                key={w.number}
                className={`wbtn ${w.number === activeWave ? 'on' : ''}`}
                onClick={() => { setActiveWave(w.number); exitSelectMode() }}
              >
                <span className="wname">{w.name}</span>
                <span className="wsub">
                  {w.label ? `${w.label} · ` : ''}
                  {cnt}
                </span>
              </button>
            )
          })}
          <button className="wbtn wmanage" aria-label="Gestionează valuri" onClick={openWaveManage}>
            <span className="wname">⚙</span>
            <span className="wsub">valuri</span>
          </button>
        </div>
        <div className="wave-actions">
          <button
            className={`btn-hide-done ${hideDone ? 'active' : ''}`}
            onClick={() => setHideDone((h) => !h)}
            title={hideDone ? 'Arată toate tichetele' : 'Ascunde tichetele finalizate'}
          >
            {hideDone ? 'Arată tot' : 'Ascunde ✓'}
          </button>
          <button
            className={`btn-tree-view ${treeViewActive ? 'active' : ''}`}
            onClick={() => {
              if (treeViewActive) exitTreeView()
              else { setTreeViewActive(true); exitSelectMode() }
            }}
            title={treeViewActive ? 'Ieși din Tree View' : 'Tree View — explorează dependențe'}
          >
            {treeViewActive ? '✕ Tree' : '⋱ Tree'}
          </button>
          <button
            className={`btn-bulk-select ${selectMode ? 'active' : ''}`}
            onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
          >
            {selectMode ? '✕' : '☐'}
          </button>
        </div>
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : (
        <>
          {keys.length === 0 ? (
            <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
          ) : (
            keys.map((L, i) => {
              const ids = layers[L]
              const visibleIds = hideDone
                ? ids.filter((id) => !issues.find((iss) => iss.id === id)?.done)
                : ids
              if (hideDone && visibleIds.length === 0) return null
              const ready = i === 0
              const color = LAYER_COLORS[i % LAYER_COLORS.length]
              return (
                <div key={L} className={`layer ${ready ? 'ready' : ''}`} style={{ '--layer-color': color } as React.CSSProperties}>
                  <div className="layer-head">
                    <div className="layer-num">{L + 1}</div>
                    <div>
                      <h4>{ready ? 'Începe aici' : `Layer ${L + 1}`}</h4>
                      <div className="sub">
                        {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${L}`} · {ids.length}{' '}
                        tichete
                      </div>
                    </div>
                    {ready && <span className="badge-now">Acum</span>}
                  </div>
                  {visibleIds.map((id) => (
                    <TicketCard
                      key={id}
                      id={id}
                      contextWave={activeWave}
                      selectMode={!treeViewActive && selectMode}
                      isSelected={selectedIds.has(id)}
                      onToggleSelect={toggleSelect}
                      treeMode={treeViewActive}
                      highlighted={highlightedIds ? highlightedIds.has(id) : undefined}
                      onTreeSelect={handleTreeSelect}
                    />
                  ))}
                </div>
              )
            })
          )}
        </>
      )}

      {/* Bulk action bar */}
      {selectMode && selCount > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count"><strong>{selCount}</strong> selectate</span>
          <div className="bulk-actions">
            {otherWaves.length > 0 && (
              <>
                <span className="bulk-label">Mută pe</span>
                <select
                  className="bulk-wave-select"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) void handleBulkMove(Number(e.target.value)) }}
                >
                  <option value="">— val —</option>
                  {otherWaves.map((w) => (
                    <option key={w.number} value={w.number}>{w.name}</option>
                  ))}
                </select>
              </>
            )}
            <div className="bulk-sep" />
            <button className="bulk-btn danger" onClick={() => setConfirmDel(true)}>
              🗑 Șterge
            </button>
          </div>
        </div>
      )}

      {/* Confirm delete overlay */}
      {confirmDel && (
        <div className="bulk-confirm-overlay" onClick={() => setConfirmDel(false)}>
          <div className="bulk-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>Ștergi {selCount} {selCount === 1 ? 'tichet' : 'tichete'}?</h3>
            <p>Acțiunea este ireversibilă. Dependențele legate de aceste tichete vor fi scoase automat.</p>
            <div className="bulk-confirm-actions">
              <button className="bulk-confirm-cancel" onClick={() => setConfirmDel(false)}>Anulează</button>
              <button className="bulk-confirm-del" onClick={() => void handleBulkDelete()}>Șterge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
