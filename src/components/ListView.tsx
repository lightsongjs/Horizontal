import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { WaveTabs } from './WaveTabs'
import { useHideDone, useOrderedLayers } from '../hooks'

export function ListView() {
  const { waves, byId, stateOf, themeOf, toggleDone } = useHorizontal()
  const { openEditIssue } = useUI()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)

  return (
    <div className="panel">
      <div className="wave-sel">
        <WaveTabs />
        <div className="wave-actions">
          <button
            className={`wave-action-btn ${hideDone ? 'active' : ''}`}
            onClick={toggleHideDone}
            title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
          >
            <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
          </button>
        </div>
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => (
          <div key={g.L} className="list-group">
            <div className="list-group-head">
              <span className="list-group-num">{g.L + 1}</span>
              <span className="list-group-label">{i === 0 ? 'Începe aici' : `Layer ${g.L + 1}`}</span>
              <span className="list-group-count">{g.ids.length}</span>
            </div>
            {g.ids.map((id) => {
              const it = byId[id]
              if (!it) return null
              const state = stateOf(id)
              const theme = it.theme ? themeOf(it.theme) : undefined
              return (
                <button type="button" key={id} className={`list-row ${state}`} onClick={() => openEditIssue(id)}>
                  <span
                    className="list-check"
                    role="checkbox"
                    aria-checked={it.done}
                    aria-label={it.done ? 'Marchează nefăcut' : 'Marchează gata'}
                    onClick={(e) => { e.stopPropagation(); void toggleDone(id) }}
                  >
                    {it.done ? '✓' : ''}
                  </span>
                  {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                  <span className="list-id">{id}</span>
                  <span className="list-title">{it.title}</span>
                  {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
                </button>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
