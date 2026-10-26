import { useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { errorMessage } from '../lib/errorMessage'
import { Icon } from './Icon'
import { PROJECT_ACCENTS as ACCENTS, autoPrefix, cleanPrefix as clean, prefixOwner } from '../lib/newProject'

export function ProjectForm() {
  const { projects, createProject, selectProject } = useHorizontal()
  const { closeSheet } = useUI()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [accent, setAccent] = useState<string>(ACCENTS[0])
  const [type, setType] = useState<'personal' | 'work'>('personal')

  const derivedPrefix = prefixTouched ? prefix : autoPrefix(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleanPrefix = clean(derivedPrefix)
  const taken = prefixOwner(projects, cleanPrefix) !== null
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
        type,
      })
      closeSheet()
      selectProject(created.id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* NEW HEADER */}
      <div className="sh-header">
        <button className="sh-close" onClick={closeSheet} aria-label="Închide"><Icon name="close" size={16} /></button>
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
          <Icon name="arrowUp" size={16} />
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
          <p style={{ fontSize: 'calc(11px * var(--text-scale))', color: 'var(--txt-faint)', marginTop: 6 }}>
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
