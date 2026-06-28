import { useState } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'

export function ThemesTab() {
  const { themes, issues, stateOf } = useDepFlow()
  const { openIssue } = useUI()
  const [active, setActive] = useState<string>('all')

  const keys = active === 'all' ? themes.map((t) => t.key) : [active]

  return (
    <div className="panel">
      <div className="chips">
        <button className={`chip ${active === 'all' ? 'on' : ''}`} onClick={() => setActive('all')}>
          Toate
        </button>
        {themes.map((t) => (
          <button
            key={t.key}
            className={`chip ${active === t.key ? 'on' : ''}`}
            onClick={() => setActive(t.key)}
          >
            <span className="cdot" style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
      </div>

      {keys.every((k) => issues.filter((i) => i.theme === k).length === 0) ? (
        <p className="empty">Nimic pe tema asta.</p>
      ) : (
        keys.map((k) => {
          const theme = themes.find((t) => t.key === k)
          const list = issues.filter((i) => i.theme === k)
          if (!theme || list.length === 0) return null
          return (
            <div key={k}>
              <div className="layer-head" style={{ margin: '18px 0 10px' }}>
                <span className="theme-dot" style={{ width: 10, height: 10, background: theme.color }} />
                <h4 style={{ fontSize: 13 }}>{theme.name}</h4>
                <div className="sub" style={{ marginLeft: 'auto' }}>
                  {list.length} tichete
                </div>
              </div>
              {list.map((it) => {
                const state = stateOf(it.id)
                return (
                  <button key={it.id} className={`tk ${state}`} onClick={() => openIssue(it.id)}>
                    <span className="check">{it.done ? '✓' : ''}</span>
                    <span className="tk-body">
                      <span className="tk-top">
                        <span className="theme-dot" style={{ background: theme.color }} />
                        <span className="tk-id">{it.id}</span>
                      </span>
                      <h5>{it.title}</h5>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
