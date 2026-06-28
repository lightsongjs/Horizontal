import { useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'

/** Create (no issueId) or edit (issueId given) an issue, with delete. */
export function IssueForm({ issueId }: { issueId?: string }) {
  const { project, waves, issues, byId, activeWave, createIssue, updateIssue, deleteIssue } = useDepFlow()
  const { closeSheet } = useUI()
  const existing = issueId ? byId[issueId] : undefined
  const isEdit = !!existing

  const [title, setTitle] = useState(existing?.title ?? '')
  const [desc, setDesc] = useState(existing?.desc ?? '')
  const [wave, setWave] = useState<number>(existing?.wave ?? activeWave)
  const [deps, setDeps] = useState<string[]>(existing?.deps ?? [])
  // "blochează" = issues that depend on THIS one (reverse edges).
  const [blocks, setBlocks] = useState<string[]>(
    existing ? issues.filter((i) => i.deps?.includes(existing.id)).map((i) => i.id) : [],
  )
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  if (!project) return null

  const candidates = issues.filter((i) => i.id !== issueId)
  const toggle = (set: string[], setSet: (v: string[]) => void, id: string) =>
    setSet(set.includes(id) ? set.filter((x) => x !== id) : [...set, id])

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const targetId = isEdit
        ? (await updateIssue(existing!.id, { title: title.trim(), desc: desc.trim(), wave, deps }), existing!.id)
        : (await createIssue({ projectId: project.id, title: title.trim(), desc: desc.trim(), wave, deps })).id

      // Apply "blochează": ensure each selected issue B depends on targetId,
      // and remove targetId from any that were deselected.
      const currentBlockers = issues.filter((i) => i.deps?.includes(targetId)).map((i) => i.id)
      const toAdd = blocks.filter((b) => !currentBlockers.includes(b))
      const toRemove = currentBlockers.filter((b) => !blocks.includes(b))
      for (const b of toAdd) {
        const bi = byId[b]
        if (bi) await updateIssue(b, { deps: [...(bi.deps ?? []), targetId] })
      }
      for (const b of toRemove) {
        const bi = byId[b]
        if (bi) await updateIssue(b, { deps: (bi.deps ?? []).filter((d) => d !== targetId) })
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

  const depRow = (id: string, set: string[], setSet: (v: string[]) => void) => {
    const i = byId[id]
    if (!i) return null
    const on = set.includes(id)
    return (
      <button
        key={id}
        className="dep-row"
        style={{ width: '100%', textAlign: 'left' }}
        onClick={() => toggle(set, setSet, id)}
      >
        <span className={`ic ${on ? 'ok' : 'ext'}`}>{on ? '✓' : '+'}</span>
        <span>{i.title}</span>
        <span className="tk-id" style={{ marginLeft: 'auto' }}>
          {id}
        </span>
      </button>
    )
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">{isEdit ? `✎ ${existing!.id}` : '+ Tichet nou'}</div>
        <h2>{isEdit ? 'Editează tichet' : 'Adaugă tichet'}</h2>
        <p>Titlu, descriere, val și dependențe.</p>
      </div>
      <div className="sheet-scroll">
        <div className="fld">
          <label>Titlu</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Pagina de înregistrare" autoComplete="off" />
        </div>
        <div className="fld">
          <label>Detalii / descriere</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Cerințe, notițe…" />
        </div>

        <div className="sheet-section-t">Val (sprint)</div>
        {waves.length === 0 ? (
          <p className="empty" style={{ padding: '8px 0' }}>Adaugă întâi un val (⚙ în ecranul Ordine).</p>
        ) : (
          <div className="chips" style={{ margin: '0 0 4px' }}>
            {waves.map((w) => (
              <button key={w.number} className={`chip ${wave === w.number ? 'on' : ''}`} onClick={() => setWave(w.number)}>
                {w.name}
              </button>
            ))}
          </div>
        )}

        <div className="sheet-section-t">Depinde de</div>
        {candidates.length === 0 ? (
          <p className="empty" style={{ padding: '8px 0' }}>Niciun alt tichet.</p>
        ) : (
          candidates.map((i) => depRow(i.id, deps, setDeps))
        )}

        <div className="sheet-section-t">Blochează (astea depind de el)</div>
        {candidates.length === 0 ? (
          <p className="empty" style={{ padding: '8px 0' }}>Niciun alt tichet.</p>
        ) : (
          candidates.map((i) => depRow(i.id, blocks, setBlocks))
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
          <button onClick={save} disabled={!title.trim() || saving || waves.length === 0}>
            {saving ? 'Se salvează…' : isEdit ? 'Salvează modificările' : 'Salvează tichet'}
          </button>
        </div>
      </div>
    </>
  )
}
