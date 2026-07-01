import { useHorizontal } from '../store'
import { useUI } from '../ui'

export function IssueSheet({ issueId }: { issueId: string }) {
  const { byId, waves, unblockedBy, themeOf, assignees, myAssigneeId } = useHorizontal()
  const { openEditIssue, pushSheet } = useUI()
  const it = byId[issueId]
  if (!it) return null

  const waveName = (n: number) => waves.find((w) => w.number === n)?.name ?? `Val ${n}`
  const theme = it.theme ? themeOf(it.theme) : undefined
  const deps = it.deps ?? []
  const permits = unblockedBy(issueId)
  const assignee = it.assigneeId ? assignees.find((a) => a.id === it.assigneeId) : null

  const navigateTo = (id: string) => pushSheet({ kind: 'issue', issueId: id })

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">
          {waveName(it.wave)}
          {theme && (
            <>
              {' · '}
              <span className="cdot" style={{ background: theme.color }} />
              {theme.name}
            </>
          )}
          {assignee && (
            <>
              {' · '}
              {'👤 '}{assignee.name}{assignee.id === myAssigneeId ? ' (eu)' : ''}
            </>
          )}
          {it.done && <>{' · '}<span style={{ color: 'var(--ok)' }}>✓ Gata</span></>}
        </div>
        <h2>{it.title}</h2>
        {it.desc && <p>{it.desc}</p>}
      </div>

      <div className="sheet-scroll">
        <button
          className="add-dep"
          style={{ borderStyle: 'solid', width: '100%', marginBottom: 12 }}
          onClick={() => openEditIssue(issueId)}
        >
          ✎ Editează
        </button>

        {deps.length > 0 && (
          <>
            <div className="sheet-section-t">Necesită</div>
            {deps.map((d) => {
              const dep = byId[d]
              if (!dep) return null
              const cross = dep.wave !== it.wave
              return (
                <button
                  key={d}
                  className={`dep-row ${cross ? 'cross' : ''}`}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => navigateTo(d)}
                >
                  <span className={`ic ${dep.done ? 'ok' : 'ext'}`}>{dep.done ? '✓' : '↳'}</span>
                  <span>{dep.title}</span>
                  <span className={`wtag ${dep.done ? '' : 'pending'}`}>
                    {waveName(dep.wave)}
                    {dep.done ? ' · ✓' : ''}
                  </span>
                </button>
              )
            })}
          </>
        )}

        {permits.length > 0 && (
          <>
            <div className="sheet-section-t">Permite</div>
            {permits.map((b) => (
              <button
                key={b.id}
                className="dep-row"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => navigateTo(b.id)}
              >
                <span className="ic ext">⌁</span>
                <span>{b.title}</span>
                <span className="wtag pending">{waveName(b.wave)}</span>
              </button>
            ))}
          </>
        )}

        {deps.length === 0 && permits.length === 0 && (
          <p className="dep-no-results">Nicio relație cu alte tichete.</p>
        )}
      </div>
    </>
  )
}
