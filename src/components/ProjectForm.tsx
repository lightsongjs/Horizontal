import { useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'

const ACCENTS = ['#6e7bff', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9']

export function ProjectForm() {
  const { projects, createProject, selectProject } = useHorizontal()
  const { closeSheet } = useUI()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [accent, setAccent] = useState(ACCENTS[0])
  const [type, setType] = useState<'personal' | 'work'>('personal')

  const autoPrefix = (n: string) =>
    n.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 6) ||
    n.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

  const derivedPrefix = prefixTouched ? prefix : autoPrefix(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleanPrefix = derivedPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  const taken = projects.some((p) => p.id === cleanPrefix.toLowerCase())
  const valid = name.trim() && cleanPrefix && !taken

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await createProject({
        name: name.trim(),
        description: description.trim(),
        prefix: cleanPrefix || name.trim().slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, ''),
        accent,
        type,
      })
      closeSheet()
      selectProject(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* NEW HEADER */}
      <div className="sh-header">
        <button className="sh-close" onClick={closeSheet} aria-label="Închide">✕</button>
        <input
          className="sh-title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Titlu proiect…"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          inputMode="text"
          spellCheck={false}
        />
        <button
          className="sh-save"
          onClick={save}
          disabled={!valid || saving}
          title={saving ? 'Se salvează…' : 'Salvează'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>

      <div className="sheet-scroll">
        <div className="sheet-section-t">Tip proiect</div>
        <div className="chips" style={{ margin: '0 0 16px' }}>
          <button className={`chip ${type === 'personal' ? 'on' : ''}`} onClick={() => setType('personal')}>Personal</button>
          <button className={`chip ${type === 'work' ? 'on' : ''}`} onClick={() => setType('work')}>Serviciu</button>
        </div>

        <div className="fld">
          <label>Descriere</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Pe scurt, despre ce e proiectul…"
          />
        </div>
        <div className="fld">
          <label>Prefix ID tichete</label>
          <input
            value={prefixTouched ? prefix : cleanPrefix}
            onChange={(e) => { setPrefixTouched(true); setPrefix(e.target.value) }}
            placeholder="Ex: TUR"
            autoComplete="off"
            autoCorrect="off"
            inputMode="text"
          />
          <p style={{ fontSize: 11, color: 'var(--txt-faint)', marginTop: 6 }}>
            Tichetele vor fi {cleanPrefix || 'XXX'}-01, {cleanPrefix || 'XXX'}-02…
            {taken && <span style={{ color: 'var(--blocked)' }}> · prefix deja folosit</span>}
          </p>
        </div>

        <div className="sheet-section-t">Culoare</div>
        <div className="chips" style={{ margin: '0 0 4px' }}>
          {ACCENTS.map((c) => (
            <button
              key={c}
              className={`chip ${accent === c ? 'on' : ''}`}
              onClick={() => setAccent(c)}
            >
              <span className="cdot" style={{ background: c }} />
              {c}
            </button>
          ))}
        </div>

        {error && <div className="banner">⚠ {error}</div>}
      </div>
    </>
  )
}
