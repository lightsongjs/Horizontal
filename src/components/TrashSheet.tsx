// Coșul de gunoi: tichetele șterse în ultimele 30 de zile, cu „Restaurează"
// și „Șterge definitiv". Foaie împinsă peste rotița de setări, nu ecran nou:
// se deschide rar (o ștergere din greșeală), deci n-are ce căuta în bara
// laterală sau în URL.
//
// Datele nu stau în store: lista se cere la deschidere, direct din
// `repository` (ca `threadSummary`), iar o restaurare cere apoi un
// `refresh()` — tichetul revine în liste pe drumul obișnuit.
// Spec: docs/superpowers/specs/2026-10-26-cos-de-gunoi-design.md
import { useCallback, useEffect, useState } from 'react'
import { repository } from '../data'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { errorMessage } from '../lib/errorMessage'
import { displayIssueId } from '../lib/issueId'
import { expiryLabel, restoreNotice, trashMeta, TRASH_DAYS, type TrashItem } from '../lib/trash'
import { Icon } from './Icon'

export function TrashSheet() {
  const { projects, refresh } = useHorizontal()
  const { showToast } = useUI()
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // „Șterge definitiv" cere două atingeri, ca `.sh-delete`: e singurul gest
  // din aplicație fără drum înapoi.
  const [confirming, setConfirming] = useState<string | null>(null)
  const now = new Date()

  const load = useCallback(async () => {
    try {
      setItems(await repository.listTrash())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
      setItems((cur) => cur ?? [])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const restore = async (t: TrashItem) => {
    setBusy(t.id)
    try {
      const r = await repository.restoreFromTrash(t.id)
      setItems((cur) => cur?.filter((x) => x.id !== t.id) ?? null)
      showToast(restoreNotice(r))
      void refresh()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (t: TrashItem) => {
    if (confirming !== t.id) { setConfirming(t.id); return }
    setConfirming(null)
    setBusy(t.id)
    try {
      await repository.purgeFromTrash(t.id)
      setItems((cur) => cur?.filter((x) => x.id !== t.id) ?? null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow"><Icon name="trash" size={13} /> Tichete șterse</div>
        <h2>Coș</h2>
      </div>
      <div className="sheet-scroll trash">
        <p className="trash-note">Un tichet șters stă aici {TRASH_DAYS} de zile, cu firul și fișierele lui, apoi pleacă definitiv.</p>
        {error && <div className="banner">⚠ {error}</div>}
        {items === null ? (
          <p className="trash-empty">Se încarcă…</p>
        ) : items.length === 0 ? (
          <p className="trash-empty">Coșul e gol.</p>
        ) : (
          <ul className="trash-list">
            {items.map((t) => (
              <li key={t.id} className="trash-row" data-trash-id={t.id} title={expiryLabel(t.deletedAt, now)}>
                <span className="trash-text">
                  <span className="trash-title">{t.title}</span>
                  <span className="trash-meta">
                    <span className="trash-id">{displayIssueId(t.issueId)}</span>
                    {' · '}{trashMeta(t, projectName(t.projectId), now)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-ghost trash-restore"
                  disabled={busy !== null}
                  onClick={() => void restore(t)}
                  aria-label={`Restaurează ${displayIssueId(t.issueId)}`}
                >
                  <Icon name="restore" size={14} /> <span className="trash-restore-label">Restaurează</span>
                </button>
                <button
                  type="button"
                  className={`sh-delete trash-purge${confirming === t.id ? ' confirming' : ''}`}
                  disabled={busy !== null}
                  onClick={() => void purge(t)}
                  onBlur={() => setTimeout(() => setConfirming((c) => (c === t.id ? null : c)), 200)}
                  title={confirming === t.id ? 'Apasă din nou: se șterge definitiv' : 'Șterge definitiv'}
                  aria-label={confirming === t.id ? 'Confirmă ștergerea definitivă' : 'Șterge definitiv'}
                >
                  <Icon name={confirming === t.id ? 'danger' : 'delete'} size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
