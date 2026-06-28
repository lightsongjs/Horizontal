import { useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'

const ACCENTS = ['#6e7bff', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9']

export function ProjectForm() {
  const { projects, createProject, selectProject } = useDepFlow()
  const { closeSheet } = useUI()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prefix, setPrefix] = useState('')
  const [accent, setAccent] = useState(ACCENTS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
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
        prefix: cleanPrefix,
        accent,
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
      <div className="sheet-head">
        <div className="eyebrow">+ Proiect nou</div>
        <h2>Adaugă proiect</h2>
        <p>Nume, descriere și un prefix scurt pentru ID-urile tichetelor.</p>
      </div>
      <div className="sheet-scroll">
        <div className="fld">
          <label>Nume</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Aplicație Turism" autoFocus />
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
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Ex: TUR"
            autoComplete="off"
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

        <div className="save-bar">
          <button onClick={save} disabled={!valid || saving}>
            {saving ? 'Se salvează…' : 'Creează proiect'}
          </button>
        </div>
      </div>
    </>
  )
}
