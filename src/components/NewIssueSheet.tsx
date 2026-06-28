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

export function NewIssueSheet() {
  const { project, themes, waves, issues, activeWave, createIssue, createTheme } = useDepFlow()
  const { closeSheet } = useUI()

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState<IssueType>('task')
  const [theme, setTheme] = useState<string>(themes[0]?.key ?? '')
  const [wave, setWave] = useState<number>(activeWave)
  const [deps, setDeps] = useState<string[]>([])
  const [newTheme, setNewTheme] = useState('')
  const [saving, setSaving] = useState(false)

  if (!project) return null

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
      await createIssue({
        projectId: project.id,
        title: title.trim(),
        desc: desc.trim(),
        type,
        theme,
        wave,
        deps,
      })
      closeSheet()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">+ Tichet nou</div>
        <h2>Adaugă tichet</h2>
        <p>Titlu, detalii, temă, val și dependențe — toate într-un loc.</p>
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
        {issues.length === 0 ? (
          <p className="empty" style={{ padding: '12px 0' }}>
            Niciun alt tichet de selectat.
          </p>
        ) : (
          issues.map((i) => (
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

        <div className="save-bar">
          <button onClick={save} disabled={!title.trim() || saving}>
            {saving ? 'Se salvează…' : 'Salvează tichet'}
          </button>
        </div>
      </div>
    </>
  )
}
