import { useState, useCallback, useEffect, useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { TicketCard } from './TicketCard'
import { WaveTabs } from './WaveTabs'
import { getRelatedIds } from '../lib/treeTraversal'
import { useHideDone, useOrderedLayers } from '../hooks'
import { LAYER_COLORS } from '../lib/layerColors'

export function OrdineView() {
  const { waves, activeWave, deleteIssue, updateIssue, byId } = useHorizontal()
  const { openEditIssue, sheet } = useUI()

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [hideDone, toggleHideDone] = useHideDone()
  const [treeViewActive, setTreeViewActive] = useState(false)
  const [treeHighlightId, setTreeHighlightId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)

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
        return
      }

      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sheet.kind !== 'none') return  // don't toggle behind an open sheet

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        if (treeViewActive) exitTreeView()
        else { setTreeViewActive(true); exitSelectMode() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, confirmDel, treeViewActive, exitSelectMode, exitTreeView, sheet.kind])

  useEffect(() => { exitTreeView(); setFocusedId(null) }, [activeWave]) // eslint-disable-line react-hooks/exhaustive-deps

  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  // Scroll focused card into view
  useEffect(() => {
    if (!focusedId) return
    document.querySelector(`[data-issue-id="${focusedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedId])

  // Vim keyboard navigation: H/J/K/L + Enter + Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sheet.kind !== 'none') return

      const key = e.key.toLowerCase()
      if (!['h', 'j', 'k', 'l', 'enter', 'escape'].includes(key)) return

      if (key === 'escape') {
        if (focusedId) { e.preventDefault(); setFocusedId(null) }
        return
      }

      if (key === 'enter' && focusedId) {
        e.preventDefault()
        openEditIssue(focusedId)
        return
      }

      if (!['h', 'j', 'k', 'l'].includes(key)) return
      e.preventDefault()

      // First press — enter nav mode on first visible ticket
      if (!focusedId) {
        const firstId = flatLayers[0]?.[0]
        if (firstId) setFocusedId(firstId)
        return
      }

      // Find current position
      let layerIdx = -1, posInLayer = -1
      for (let li = 0; li < flatLayers.length; li++) {
        const pi = flatLayers[li].indexOf(focusedId)
        if (pi !== -1) { layerIdx = li; posInLayer = pi; break }
      }
      if (layerIdx === -1) return

      if (key === 'j') {
        if (layerIdx + 1 < flatLayers.length) {
          const next = flatLayers[layerIdx + 1]
          setFocusedId(next[Math.min(posInLayer, next.length - 1)])
        }
      } else if (key === 'k') {
        if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[Math.min(posInLayer, prev.length - 1)])
        }
      } else if (key === 'l') {
        const layer = flatLayers[layerIdx]
        if (posInLayer + 1 < layer.length) {
          setFocusedId(layer[posInLayer + 1])
        } else if (layerIdx + 1 < flatLayers.length) {
          setFocusedId(flatLayers[layerIdx + 1][0])
        }
      } else if (key === 'h') {
        if (posInLayer > 0) {
          setFocusedId(flatLayers[layerIdx][posInLayer - 1])
        } else if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[prev.length - 1])
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, flatLayers, sheet, openEditIssue])

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
        <WaveTabs onWaveChange={exitSelectMode} />
        <div className="wave-actions">
          <button
            className={`wave-action-btn ${treeViewActive ? 'active' : ''}`}
            onClick={() => { if (treeViewActive) exitTreeView(); else { setTreeViewActive(true); exitSelectMode() } }}
            title={treeViewActive ? 'Ieși din Tree View' : 'Tree View — explorează dependențe'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
              <line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="13" x2="5" y2="17"/><line x1="12" y1="13" x2="19" y2="17"/>
            </svg>
            <span>Tree</span>
          </button>
          <button
            className={`wave-action-btn ${hideDone ? 'active' : ''}`}
            onClick={toggleHideDone}
            title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
          >
            {hideDone ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            )}
            <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
          </button>
          <button
            className={`wave-action-btn ${selectMode ? 'active' : ''}`}
            onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
            title={selectMode ? 'Ieși din Select Mode' : 'Select Mode'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              {selectMode && <polyline points="9 12 11 14 15 10"/>}
            </svg>
            <span>Select</span>
          </button>
        </div>
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : (
        <>
          {orderedLayers.length === 0 ? (
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
                      selectMode={!treeViewActive && selectMode}
                      isSelected={selectedIds.has(id)}
                      onToggleSelect={toggleSelect}
                      treeMode={treeViewActive}
                      highlighted={highlightedIds ? highlightedIds.has(id) : undefined}
                      onTreeSelect={handleTreeSelect}
                      focused={focusedId === id}
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
