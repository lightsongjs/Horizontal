import type { Wave } from '../lib/types'

interface Props {
  selCount: number
  otherWaves: Wave[]
  confirmDel: boolean
  onBulkMove: (targetWave: number) => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export function BulkBar({
  selCount, otherWaves, confirmDel,
  onBulkMove, onRequestDelete, onConfirmDelete, onCancelDelete,
}: Props) {
  return (
    <>
      {selCount > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count"><strong>{selCount}</strong> selectate</span>
          <div className="bulk-actions">
            {otherWaves.length > 0 && (
              <>
                <span className="bulk-label">Mută pe</span>
                <select
                  className="bulk-wave-select"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) onBulkMove(Number(e.target.value)) }}
                >
                  <option value="">— val —</option>
                  {otherWaves.map((w) => (
                    <option key={w.number} value={w.number}>{w.name}</option>
                  ))}
                </select>
              </>
            )}
            <div className="bulk-sep" />
            <button className="bulk-btn danger" onClick={onRequestDelete}>
              🗑 Șterge
            </button>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="bulk-confirm-overlay" onClick={onCancelDelete}>
          <div className="bulk-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>Ștergi {selCount} {selCount === 1 ? 'tichet' : 'tichete'}?</h3>
            <p>Acțiunea este ireversibilă. Dependențele legate de aceste tichete vor fi scoase automat.</p>
            <div className="bulk-confirm-actions">
              <button className="bulk-confirm-cancel" onClick={onCancelDelete}>Anulează</button>
              <button className="bulk-confirm-del" onClick={onConfirmDelete}>Șterge</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
