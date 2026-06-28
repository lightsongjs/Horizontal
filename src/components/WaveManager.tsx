import { useState } from 'react'
import { useDepFlow } from '../store'

export function WaveManager() {
  const { waves, issues, createWave, renameWave, deleteWave } = useDepFlow()
  const [newName, setNewName] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const add = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await createWave(name, newLabel.trim())
      setNewName('')
      setNewLabel('')
    } finally {
      setBusy(false)
    }
  }

  const count = (n: number) => issues.filter((i) => i.wave === n).length

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">⚙ Valuri</div>
        <h2>Gestionează valurile</h2>
        <p>Valurile sunt sprinturile proiectului. Adaugă, redenumește sau șterge.</p>
      </div>
      <div className="sheet-scroll">
        <div className="sheet-section-t">Valuri existente ({waves.length})</div>
        {waves.length === 0 && <p className="empty" style={{ padding: '8px 0' }}>Niciun val încă.</p>}
        {waves.map((w) => (
          <div key={w.number} className="wave-edit">
            <input
              defaultValue={w.name}
              aria-label="Nume val"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== w.name) void renameWave(w.number, v, w.label)
              }}
            />
            <input
              defaultValue={w.label}
              aria-label="Sub-etichetă"
              placeholder="etichetă"
              onBlur={(e) => {
                if (e.target.value !== w.label) void renameWave(w.number, w.name, e.target.value.trim())
              }}
            />
            <button
              className="wave-del"
              aria-label="Șterge val"
              title={count(w.number) > 0 ? `${count(w.number)} tichete rămân fără val valid` : 'Șterge'}
              onClick={() => (confirmDel === w.number ? void deleteWave(w.number) : setConfirmDel(w.number))}
            >
              {confirmDel === w.number ? 'Sigur?' : '🗑'}
            </button>
          </div>
        ))}

        <div className="sheet-section-t">Adaugă val nou</div>
        <div className="inline-new">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nume (ex: Val 2)" />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="etichetă (opțional)"
          />
          <button onClick={add} disabled={!newName.trim() || busy}>
            Adaugă
          </button>
        </div>
      </div>
    </>
  )
}
