import { useDepFlow } from '../store'
import { useUI } from '../ui'

interface Props {
  id: string
  /** Deps in this wave show inline; deps in other waves show as a count. */
  contextWave: number
}

export function TicketCard({ id, contextWave }: Props) {
  const { byId, stateOf, toggleDone, themeOf } = useDepFlow()
  const { openEditIssue } = useUI()
  const it = byId[id]
  if (!it) return null

  const state = stateOf(id)
  const theme = it.theme ? themeOf(it.theme) : undefined
  const deps = it.deps ?? []
  const sameWave = deps.filter((d) => byId[d]?.wave === contextWave)
  const crossWave = deps.filter((d) => byId[d] && byId[d].wave !== contextWave)

  return (
    <button className={`tk ${state}`} onClick={() => openEditIssue(id)}>
      <span
        className="check"
        role="checkbox"
        aria-checked={it.done}
        aria-label={it.done ? 'Marchează nefăcut' : 'Marchează gata'}
        onClick={(e) => {
          e.stopPropagation()
          void toggleDone(id)
        }}
      >
        {it.done ? '✓' : ''}
      </span>
      <span className="tk-body">
        <span className="tk-top">
          {theme && <span className="theme-dot" style={{ background: theme.color }} />}
          <span className="tk-id">{id}</span>
          {theme && <span className="tk-theme">{theme.name}</span>}
        </span>
        <h5>{it.title}</h5>
        {(sameWave.length > 0 || crossWave.length > 0) && (
          <span className="tk-sub">
            {sameWave.length > 0 && <span className="dep">↳ {sameWave.join(', ')}</span>}
            {crossWave.length > 0 && <span className="tk-children">+{crossWave.length} din alt val</span>}
          </span>
        )}
      </span>
    </button>
  )
}
