import { useDepFlow } from '../store'
import { useUI } from '../ui'

interface Props {
  id: string
  /** When set, deps in this wave are shown as same-wave; others as cross-wave. */
  contextWave?: number
}

export function TicketCard({ id, contextWave }: Props) {
  const { byId, themes, stateOf, toggleDone } = useDepFlow()
  const { openIssue } = useUI()
  const it = byId[id]
  if (!it) return null

  const theme = themes.find((t) => t.key === it.theme)
  const state = stateOf(id)
  const deps = it.deps ?? []
  const sameWave = contextWave == null ? deps : deps.filter((d) => byId[d]?.wave === contextWave)
  const crossWave = contextWave == null ? [] : deps.filter((d) => byId[d] && byId[d].wave !== contextWave)

  return (
    <button className={`tk ${state}`} onClick={() => openIssue(id)}>
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
          <span className="theme-dot" style={{ background: theme?.color ?? '#888' }} />
          <span className="tk-id">{id}</span>
          {it.type === 'epic' && <span className="type-badge">epic</span>}
          {it.type === 'external' && <span className="type-badge ext">extern</span>}
        </span>
        <h5>{it.title}</h5>
        {(sameWave.length > 0 || crossWave.length > 0 || it.type === 'epic') && (
          <span className="tk-sub">
            {sameWave.length > 0 && <span className="dep">↳ {sameWave.join(', ')}</span>}
            {crossWave.length > 0 && <span className="tk-children">+{crossWave.length} din alt val</span>}
            {it.type === 'epic' && it.children && (
              <span className="tk-children">epic · {it.children.length}</span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
