import { useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { errorMessage } from '../lib/errorMessage'
import { Icon } from './Icon'

const ACCENTS = ['#0EA5E9', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9']

export function ProjectSettings() {
  const { project, updateProject, deleteProject } = useHorizontal()
  const { closeSheet } = useUI()

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [accent, setAccent] = useState(project?.accent ?? ACCENTS[0])
  const [remindersOnly, setRemindersOnly] = useState(project?.remindersOnly ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!project) return null

  const dirty = name.trim() !== project.name || description.trim() !== project.description || accent !== project.accent
    || remindersOnly !== (project.remindersOnly ?? false)
  const valid = name.trim().length > 0

  const save = async () => {
    if (!valid || saving || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await updateProject(project.id, {
        name: name.trim(), description: description.trim(), accent,
        ...(remindersOnly !== (project.remindersOnly ?? false) ? { remindersOnly } : {}),
      })
      closeSheet()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await deleteProject(project.id)
      closeSheet()
    } catch (e) {
      setError(errorMessage(e))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow"><Icon name="settings" size={13} /> Setări proiect</div>
        <h2>{project.name}</h2>
        <p>Modifică detaliile proiectului sau șterge-l definitiv.</p>
      </div>
      <div className="sheet-scroll">
        <div className="fld">
          <label>Nume</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="fld">
          <label>Descriere</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="sheet-section-t">Culoare accent</div>
        <div className="chips color-chips" style={{ margin: '0 0 4px' }}>
          {ACCENTS.map((c) => (
            <button key={c} className={`chip ${accent === c ? 'on' : ''}`} onClick={() => setAccent(c)}>
              <span className="cdot" style={{ background: c }} />
              {c}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">În „Azi" și pe widget</div>
        <div className="chips" style={{ margin: '0 0 4px' }}>
          <button className={`chip ${!remindersOnly ? 'on' : ''}`} onClick={() => setRemindersOnly(false)}>Ca orice sarcină</button>
          <button className={`chip ${remindersOnly ? 'on' : ''}`} onClick={() => setRemindersOnly(true)}>Doar după ce sună</button>
        </div>
        <p style={{ fontSize: 'calc(11px * var(--text-scale))', color: 'var(--txt-faint)', margin: '6px 0 12px', lineHeight: 1.5 }}>
          Pentru rutine (vasele, mașina de spălat): tichetele stau ascunse până la memento și apar doar dacă nu le-ai bifat.
        </p>

        {error && <div className="banner">⚠ {error}</div>}

        <div className="save-bar">
          <button onClick={save} disabled={!valid || !dirty || saving}>
            {saving ? 'Se salvează…' : 'Salvează modificările'}
          </button>
        </div>

        <div className="sheet-section-t" style={{ marginTop: 28, color: 'var(--blocked)' }}>Zonă periculoasă</div>
        <div style={{ padding: '4px 0 8px', fontSize: 'calc(12px * var(--text-scale))', color: 'var(--txt-dim)', lineHeight: 1.5 }}>
          {confirmDelete
            ? `Ești sigur? Aceasta va șterge „${project.name}" și toate tichetele sale. Acțiunea este ireversibilă.`
            : 'Ștergerea proiectului va elimina toate wave-urile, temele și tichetele asociate.'}
        </div>
        <div className="save-bar" style={{ paddingTop: 0 }}>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              background: confirmDelete ? 'var(--blocked)' : 'transparent',
              border: `1px solid var(--blocked)`,
              color: confirmDelete ? '#fff' : 'var(--blocked)',
            }}
          >
            {deleting ? 'Se șterge…' : confirmDelete ? 'Confirmă ștergerea' : 'Șterge proiectul'}
          </button>
        </div>
        {confirmDelete && !deleting && (
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ background: 'none', border: 'none', color: 'var(--txt-dim)', fontSize: 'calc(12px * var(--text-scale))', cursor: 'pointer' }}
            >
              Anulează
            </button>
          </div>
        )}
      </div>
    </>
  )
}
