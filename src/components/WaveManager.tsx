import { useState } from 'react'
import { toRoman } from '../lib/roman'
import { useHorizontal } from '../store'

export function WaveManager() {
  const { waves, issues, createWave, renameWave, deleteWave } = useHorizontal()
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<number | null>(null)

  // Scratchpad (wave 0) is not a delivery wave — it never appears here.
  const deliveryWaves = waves.filter((w) => w.number !== 0)
  const nextRoman = toRoman(deliveryWaves.length + 1)

  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      // The name is the auto-assigned Roman numeral; the label is the optional sub-text.
      await createWave(nextRoman, newLabel.trim())
      setNewLabel('')
    } finally {
      setBusy(false)
    }
  }

  const count = (n: number) => issues.filter((i) => i.wave === n).length

  const onDelete = (n: number) => {
    if (count(n) > 0) {
      // Deleting a wave with tickets would orphan them — block and explain.
      setBlocked(n)
      setConfirmDel(null)
      return
    }
    setBlocked(null)
    if (confirmDel === n) void deleteWave(n)
    else setConfirmDel(n)
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">⚙ Valuri</div>
        <h2>Gestionează valurile</h2>
        <p>Valurile sunt sprinturile proiectului. Numerotarea (I, II, III…) e automată; eticheta e opțională.</p>
      </div>
      <div className="sheet-scroll">
        <div className="sheet-section-t">Valuri existente ({deliveryWaves.length})</div>
        {deliveryWaves.length === 0 && (
          <p className="empty" style={{ padding: '8px 0' }}>Niciun val încă.</p>
        )}
        {deliveryWaves.map((w, i) => (
          <div key={w.number} className="wave-edit">
            <span className="wave-roman" aria-label={`Valul ${toRoman(i + 1)}`}>{toRoman(i + 1)}</span>
            <input
              defaultValue={w.label}
              aria-label="Sub-etichetă"
              placeholder="etichetă (opțional)"
              onBlur={(e) => {
                if (e.target.value !== w.label) void renameWave(w.number, w.name, e.target.value.trim())
              }}
            />
            <button
              className="wave-del"
              aria-label="Șterge val"
              title={count(w.number) > 0 ? `${count(w.number)} tichete în acest val` : 'Șterge'}
              onClick={() => onDelete(w.number)}
            >
              {confirmDel === w.number ? 'Sigur?' : '🗑'}
            </button>
          </div>
        ))}
        {blocked !== null && (
          <div className="banner">
            ⚠ Valul are {count(blocked)} tichete. Mută-le pe alt val (din editarea tichetului)
            înainte să-l poți șterge.
          </div>
        )}

        <div className="sheet-section-t">Adaugă val nou</div>
        <div className="inline-new">
          <span className="wave-roman" aria-label={`Următorul val: ${nextRoman}`}>{nextRoman}</span>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="etichetă (opțional)"
          />
          <button onClick={add} disabled={busy}>
            Adaugă
          </button>
        </div>
      </div>
    </>
  )
}
