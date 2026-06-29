import { useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'

const ACCENTS = ['#6e7bff', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9']

export function ProjectSettings() {
  const { project, updateProject, deleteProject } = useDepFlow()
  const { closeSheet } = useUI()

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [accent, setAccent] = useState(project?.accent ?? ACCENTS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!project) return null

  const dirty = name.trim() !== project.name || description.trim() !== project.description || accent !== project.accent
  const valid = name.trim().length > 0

  const save = async () => {
    if (!valid || saving || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await updateProject(project.id, { name: name.trim(), description: description.trim(), accent })
      closeSheet()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">⚙ Setări proiect</div>
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
        <div className="chips" style={{ margin: '0 0 4px' }}>
          {ACCENTS.map((c) => (
            <button key={c} className={`chip ${accent === c ? 'on' : ''}`} onClick={() => setAccent(c)}>
              <span className="cdot" style={{ background: c }} />
              {c}
            </button>
          ))}
        </div>

        {error && <div className="banner">⚠ {error}</div>}

        <div className="save-bar">
          <button onClick={save} disabled={!valid || !dirty || saving}>
            {saving ? 'Se salvează…' : 'Salvează modificările'}
          </button>
        </div>

        <div className="sheet-section-t" style={{ marginTop: 28, color: 'var(--blocked)' }}>Zonă periculoasă</div>
        <div style={{ padding: '4px 0 8px', fontSize: 12, color: 'var(--txt-dim)', lineHeight: 1.5 }}>
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
              style={{ background: 'none', border: 'none', color: 'var(--txt-dim)', fontSize: 12, cursor: 'pointer' }}
            >
              Anulează
            </button>
          </div>
        )}
      </div>
    </>
  )
}
