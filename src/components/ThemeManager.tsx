import { useState } from 'react'
import { useHorizontal } from '../store'

const PALETTE = ['#0EA5E9', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9', '#f78fb3', '#9aa0b4']

export function ThemeManager() {
  const { themes, issues, createTheme, updateTheme, deleteTheme } = useHorizontal()
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const add = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await createTheme(name.trim(), color)
      setName('')
      setColor(PALETTE[(themes.length + 1) % PALETTE.length])
    } finally {
      setBusy(false)
    }
  }

  const count = (key: string) => issues.filter((i) => i.theme === key).length

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">⚙ Teme</div>
        <h2>Gestionează temele</h2>
        <p>Temele sunt categorii colorate pentru tichete. Adaugă, redenumește, recolorează sau șterge.</p>
      </div>
      <div className="sheet-scroll">
        <div className="sheet-section-t">Teme existente ({themes.length})</div>
        {themes.length === 0 && <p className="empty" style={{ padding: '8px 0' }}>Nicio temă încă.</p>}
        {themes.map((t) => (
          <div key={t.key} className="theme-edit">
            <button
              className="swatch"
              aria-label="Schimbă culoarea"
              style={{ background: t.color }}
              onClick={() => updateTheme(t.key, { color: nextColor(t.color) })}
            />
            <input
              defaultValue={t.name}
              aria-label="Nume temă"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== t.name) void updateTheme(t.key, { name: v })
              }}
            />
            <button
              className="wave-del"
              aria-label="Șterge tema"
              title={count(t.key) > 0 ? `${count(t.key)} tichete rămân fără temă` : 'Șterge'}
              onClick={() => (confirmDel === t.key ? void deleteTheme(t.key) : setConfirmDel(t.key))}
            >
              {confirmDel === t.key ? 'Sigur?' : '🗑'}
            </button>
          </div>
        ))}

        <div className="sheet-section-t">Adaugă temă nouă</div>
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`Culoare ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="inline-new">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Nume temă (ex: Auth)"
            autoComplete="off"
          />
          <button onClick={add} disabled={!name.trim() || busy}>
            Adaugă
          </button>
        </div>
      </div>
    </>
  )
}

/** Cycle a theme color to the next palette entry (simple recolor affordance). */
function nextColor(current: string): string {
  const i = PALETTE.indexOf(current)
  return PALETTE[(i + 1) % PALETTE.length]
}
