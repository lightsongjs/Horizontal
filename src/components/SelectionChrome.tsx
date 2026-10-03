import { Icon } from './Icon'
import { urgentActionFor, useTaskActions } from './TaskActions'

/**
 * Antetul modului de selecție de pe telefon, în locul celui obișnuit: săgeata
 * înapoi iese din selecție, numărul spune pe câte se va acționa, „Toate" alege
 * tot ce e pe ecran.
 */
export function SelectionHeader() {
  const ta = useTaskActions()
  const n = ta.selectedIds.size
  return (
    <header className="sel-head">
      <button className="back" aria-label="Ieși din selecție" onClick={ta.exitSelectMode}>
        <Icon name="back" size={20} />
      </button>
      <h1 className="sel-count" aria-live="polite">
        <span className="sel-num">{n}</span> {n === 1 ? 'selectată' : 'selectate'}
      </h1>
      <button type="button" className="sel-all" onClick={ta.selectAllVisible}>Toate</button>
    </header>
  )
}

/**
 * Bara de jos a selecției, în locul barei de tab-uri: în selecție, bara spune
 * CE faci, nu UNDE ești. Fiecare acțiune iese din selecție după ce rulează.
 */
export function SelectionBar() {
  const ta = useTaskActions()
  const ids = [...ta.selectedIds]
  const none = ids.length === 0
  return (
    <nav className="tabbar sel-bar" aria-label="Acțiuni pe selecție">
      <button type="button" className="primary" disabled={none} onClick={() => ta.openSheet('date', ids)}>
        <span className="tb-ico"><Icon name="due" size={21} /></span>Dată
      </button>
      <button type="button" disabled={none} onClick={() => void ta.run(urgentActionFor(ta.issuesOf(ids)), ids)}>
        <span className="tb-ico"><Icon name="urgent" size={21} /></span>Urgent
      </button>
      <button type="button" disabled={none} onClick={() => void ta.run({ kind: 'done' }, ids)}>
        <span className="tb-ico"><Icon name="check" size={21} /></span>Gata
      </button>
      <button type="button" className="danger" disabled={none} onClick={() => ta.remove(ids)}>
        <span className="tb-ico"><Icon name="delete" size={21} /></span>Șterge
      </button>
      <button type="button" disabled={none} onClick={() => ta.openSheet('bulk-more', ids)}>
        <span className="tb-ico"><Icon name="menu" size={21} /></span>Mai mult
      </button>
    </nav>
  )
}
