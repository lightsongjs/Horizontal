import { useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'
import type { IssueType } from '../lib/types'

const PALETTE = ['#6e7bff', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9', '#f78fb3']
const TYPES: { key: IssueType; label: string }[] = [
  { key: 'task', label: 'Task' },
  { key: 'epic', label: 'Epic' },
  { key: 'external', label: 'Extern' },
]

/** Create (no issueId) or edit (issueId given) an issue, with delete. */
export function IssueForm({ issueId }: { issueId?: string }) {
  const { project, themes, waves, issues, byId, activeWave, createIssue, updateIssue, deleteIssue, createTheme } =
    useDepFlow()
  const { closeSheet } = useUI()
  const existing = issueId ? byId[issueId] : undefined
  const isEdit = !!existing

  const [title, setTitle] = useState(existing?.title ?? '')
  const [desc, setDesc] = useState(existing?.desc ?? '')
  const [type, setType] = useState<IssueType>(existing?.type ?? 'task')
  const [theme, setTheme] = useState<string>(existing?.theme ?? themes[0]?.key ?? '')
  const [wave, setWave] = useState<number>(existing?.wave ?? activeWave)
  const [deps, setDeps] = useState<string[]>(existing?.deps ?? [])
  const [newTheme, setNewTheme] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  if (!project) return null

  // Selectable deps: every other issue in the project (can't depend on self).
  const candidates = issues.filter((i) => i.id !== issueId)

  const toggleDep = (id: string) =>
    setDeps((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))

  const addTheme = async () => {
    const name = newTheme.trim()
    if (!name) return
    const key = name.toLowerCase().replace(/\s+/g, '-').slice(0, 24)
    const color = PALETTE[themes.length % PALETTE.length]
    await createTheme({ key, name, color })
    setTheme(key)
    setNewTheme('')
  }

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      if (isEdit && existing) {
        await updateIssue(existing.id, {
          title: title.trim(),
          desc: desc.trim(),
          type,
          theme,
          wave,
          deps,
        })
      } else {
        await createIssue({ projectId: project.id, title: title.trim(), desc: desc.trim(), type, theme, wave, deps })
      }
      closeSheet()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing || saving) return
    setSaving(true)
    try {
      await deleteIssue(existing.id)
      closeSheet()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">{isEdit ? `✎ ${existing!.id}` : '+ Tichet nou'}</div>
        <h2>{isEdit ? 'Editează tichet' : 'Adaugă tichet'}</h2>
        <p>Titlu, detalii, tip, temă, val și dependențe.</p>
      </div>
      <div className="sheet-scroll">
        <div className="fld">
          <label>Titlu</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Pagină resetare parolă"
            autoComplete="off"
          />
        </div>
        <div className="fld">
          <label>Detalii / descriere</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Cerințe, notițe, ce trebuie să conțină tichetul…"
          />
        </div>

        <div className="sheet-section-t">Tip</div>
        <div className="chips" style={{ margin: '0 0 4px' }}>
          {TYPES.map((t) => (
            <button key={t.key} className={`chip ${type === t.key ? 'on' : ''}`} onClick={() => setType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Temă</div>
        <div className="chips" style={{ margin: '0 0 4px' }}>
          {themes.map((t) => (
            <button
              key={t.key}
              className={`chip ${theme === t.key ? 'on' : ''}`}
              onClick={() => setTheme(t.key)}
            >
              <span className="cdot" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
        <div className="inline-new">
          <input
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTheme()}
            placeholder="+ Temă nouă"
            autoComplete="off"
          />
          <button onClick={addTheme}>OK</button>
        </div>

        <div className="sheet-section-t">Val (sprint)</div>
        <div className="chips" style={{ margin: '0 0 4px' }}>
          {waves.map((w) => (
            <button
              key={w.number}
              className={`chip ${wave === w.number ? 'on' : ''}`}
              onClick={() => setWave(w.number)}
            >
              {w.name} · {w.label}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Depinde de</div>
        {candidates.length === 0 ? (
          <p className="empty" style={{ padding: '12px 0' }}>
            Niciun alt tichet de selectat.
          </p>
        ) : (
          candidates.map((i) => (
            <button
              key={i.id}
              className="dep-row"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => toggleDep(i.id)}
            >
              <span className={`ic ${deps.includes(i.id) ? 'ok' : 'ext'}`}>
                {deps.includes(i.id) ? '✓' : '+'}
              </span>
              <span>{i.title}</span>
              <span className="tk-id" style={{ marginLeft: 'auto' }}>
                {i.id}
              </span>
            </button>
          ))
        )}

        {isEdit && (
          <button
            className="add-dep"
            style={{ marginTop: 14, borderColor: '#ff6b6b55', color: 'var(--blocked)' }}
            onClick={() => (confirmDel ? void remove() : setConfirmDel(true))}
          >
            {confirmDel ? '⚠ Apasă din nou ca să confirmi ștergerea' : '🗑 Șterge tichetul'}
          </button>
        )}

        <div className="save-bar">
          <button onClick={save} disabled={!title.trim() || saving}>
            {saving ? 'Se salvează…' : isEdit ? 'Salvează modificările' : 'Salvează tichet'}
          </button>
        </div>
      </div>
    </>
  )
}
