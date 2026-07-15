import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWrite } from '../hooks'

interface Props {
  id: string
  contextWave: number
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  treeMode?: boolean
  highlighted?: boolean
  onTreeSelect?: (id: string) => void
  focused?: boolean
}

export function TicketCard({ id, contextWave, selectMode, isSelected, onToggleSelect, treeMode, highlighted, onTreeSelect, focused }: Props) {
  const { byId, stateOf, toggleDone, themeOf } = useHorizontal()
  const { openEditIssue } = useUI()
  const canWrite = useCanWrite()
  const it = byId[id]
  if (!it) return null

  const state = stateOf(id)
  const theme = it.theme ? themeOf(it.theme) : undefined
  const deps = it.deps ?? []
  const sameWave = deps.filter((d) => byId[d]?.wave === contextWave)
  const crossWave = deps.filter((d) => byId[d] && byId[d].wave !== contextWave)

  const handleClick = () => {
    if (treeMode) {
      onTreeSelect?.(id)
    } else if (selectMode) {
      onToggleSelect?.(id)
    } else {
      openEditIssue(id)
    }
  }

  const treeClass = treeMode
    ? highlighted === undefined
      ? ''
      : highlighted
        ? ' tree-highlight'
        : ' tree-dim'
    : ''

  return (
    <button
      // Same class grammar as ListView.tsx (row variant) — keep in sync.
      className={`tk ${state}${isSelected ? ' selected' : ''}${selectMode ? ' in-select' : ''}${treeClass}${focused ? ' vim-focused' : ''}`}
      onClick={handleClick}
      data-title={it.title}
      data-issue-id={id}
    >
      <span
        className="tk-check"
        role="checkbox"
        aria-checked={selectMode ? isSelected : it.done}
        aria-label={selectMode ? (isSelected ? 'Deselectează' : 'Selectează') : (it.done ? 'Marchează nefăcut' : 'Marchează gata')}
        onClick={(e) => {
          e.stopPropagation()
          if (treeMode) return
          if (selectMode) onToggleSelect?.(id)
          else if (canWrite) void toggleDone(id)
        }}
      >
        {(selectMode ? isSelected : it.done) ? '✓' : ''}
      </span>
      <div className="tk-meta">
        {theme && <span className="theme-dot" style={{ background: theme.color }} />}
        <span className="tk-id">{id}</span>
        {theme && <span className="tk-theme">{theme.name}</span>}
        {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
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
