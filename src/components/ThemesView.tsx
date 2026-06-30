import { useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'

export function ThemesView() {
  const { themes, issues, stateOf } = useHorizontal()
  const { openIssue, openThemeManage } = useUI()
  const [active, setActive] = useState<string>('all')

  // "all" shows every theme group plus an "Fără temă" bucket for untagged issues.
  const groups: { key: string; name: string; color: string }[] =
    active === 'all'
      ? [...themes.map((t) => ({ key: t.key, name: t.name, color: t.color }))]
      : themes.filter((t) => t.key === active).map((t) => ({ key: t.key, name: t.name, color: t.color }))

  const untagged = issues.filter((i) => !i.theme || !themes.some((t) => t.key === i.theme))
  const showUntagged = active === 'all' && untagged.length > 0

  return (
    <div className="panel">
      <div className="chips">
        <button className={`chip ${active === 'all' ? 'on' : ''}`} onClick={() => setActive('all')}>
          Toate
        </button>
        {themes.map((t) => (
          <button key={t.key} className={`chip ${active === t.key ? 'on' : ''}`} onClick={() => setActive(t.key)}>
            <span className="cdot" style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
        <button className="chip add" onClick={openThemeManage}>
          ⚙ Gestionează
        </button>
      </div>

      {themes.length === 0 && (
        <p className="empty">Nicio temă încă. Apasă „⚙ Gestionează" ca să adaugi.</p>
      )}

      {groups.map((g) => {
        const list = issues.filter((i) => i.theme === g.key)
        if (list.length === 0 && active === 'all') return null
        return (
          <div key={g.key}>
            <div className="layer-head" style={{ margin: '18px 0 10px' }}>
              <span className="theme-dot" style={{ width: 10, height: 10, background: g.color }} />
              <h4 style={{ fontSize: 13 }}>{g.name}</h4>
              <div className="sub" style={{ marginLeft: 'auto' }}>
                {list.length} tichete
              </div>
            </div>
            {list.length === 0 ? (
              <p className="empty" style={{ padding: '8px 0' }}>Niciun tichet pe tema asta.</p>
            ) : (
              list.map((it) => <ThemeIssueRow key={it.id} id={it.id} color={g.color} />)
            )}
          </div>
        )
      })}

      {showUntagged && (
        <div>
          <div className="layer-head" style={{ margin: '18px 0 10px' }}>
            <span className="theme-dot" style={{ width: 10, height: 10, background: 'var(--txt-faint)' }} />
            <h4 style={{ fontSize: 13 }}>Fără temă</h4>
            <div className="sub" style={{ marginLeft: 'auto' }}>{untagged.length} tichete</div>
          </div>
          {untagged.map((it) => (
            <button key={it.id} className={`tk ${stateOf(it.id)}`} onClick={() => openIssue(it.id)}>
              <span className="check">{it.done ? '✓' : ''}</span>
              <span className="tk-body">
                <span className="tk-top">
                  <span className="tk-id">{it.id}</span>
                </span>
                <h5>{it.title}</h5>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeIssueRow({ id, color }: { id: string; color: string }) {
  const { byId, stateOf } = useHorizontal()
  const { openIssue } = useUI()
  const it = byId[id]
  if (!it) return null
  return (
    <button className={`tk ${stateOf(id)}`} onClick={() => openIssue(id)}>
      <span className="check">{it.done ? '✓' : ''}</span>
      <span className="tk-body">
        <span className="tk-top">
          <span className="theme-dot" style={{ background: color }} />
          <span className="tk-id">{id}</span>
        </span>
        <h5>{it.title}</h5>
      </span>
    </button>
  )
}
