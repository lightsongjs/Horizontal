import { useHorizontal } from '../store'
import { useUI } from '../ui'

interface Props {
  id: string
  contextWave: number
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

export function TicketCard({ id, contextWave, selectMode, isSelected, onToggleSelect }: Props) {
  const { byId, stateOf, toggleDone, themeOf } = useHorizontal()
  const { openEditIssue } = useUI()
  const it = byId[id]
  if (!it) return null

  const state = stateOf(id)
  const theme = it.theme ? themeOf(it.theme) : undefined
  const deps = it.deps ?? []
  const sameWave = deps.filter((d) => byId[d]?.wave === contextWave)
  const crossWave = deps.filter((d) => byId[d] && byId[d].wave !== contextWave)

  const handleClick = () => {
    if (selectMode) onToggleSelect?.(id)
    else openEditIssue(id)
  }

  return (
    <button
      className={`tk ${state}${isSelected ? ' selected' : ''}${selectMode ? ' in-select' : ''}`}
      onClick={handleClick}
      data-title={it.title}
    >
      <span
        className="tk-check"
        role="checkbox"
        aria-checked={selectMode ? isSelected : it.done}
        aria-label={selectMode ? (isSelected ? 'Deselectează' : 'Selectează') : (it.done ? 'Marchează nefăcut' : 'Marchează gata')}
        onClick={(e) => {
          e.stopPropagation()
          if (selectMode) onToggleSelect?.(id)
          else void toggleDone(id)
        }}
      >
        {(selectMode ? isSelected : it.done) ? '✓' : ''}
      </span>
      <div className="tk-meta">
        {theme && <span className="theme-dot" style={{ background: theme.color }} />}
        <span className="tk-id">{id}</span>
        {theme && <span className="tk-theme">{theme.name}</span>}
      </div>
      <h5>{it.title}</h5>
      {(sameWave.length > 0 || crossWave.length > 0) && (
        <span className="tk-sub">
          {sameWave.length > 0 && <span className="dep">↳ {sameWave.join(', ')}</span>}
          {crossWave.length > 0 && <span className="tk-children">+{crossWave.length} din alt val</span>}
        </span>
      )}
    </button>
  )
}
