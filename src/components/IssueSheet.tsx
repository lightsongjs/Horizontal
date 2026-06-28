import { useDepFlow } from '../store'
import { useUI } from '../ui'

export function IssueSheet({ issueId }: { issueId: string }) {
  const { byId, waves, toggleDone, unblockedBy } = useDepFlow()
  const { openIssue, openEditIssue } = useUI()
  const it = byId[issueId]
  if (!it) return null

  const waveName = (n: number) => waves.find((w) => w.number === n)?.name ?? `Val ${n}`
  const typeLabel = it.type === 'epic' ? 'Epic' : it.type === 'external' ? 'Extern' : 'Task'
  const deps = it.deps ?? []
  const unblocks = unblockedBy(issueId)

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">
          {waveName(it.wave)} · {typeLabel}
        </div>
        <h2>{it.title}</h2>
        {it.desc && <p>{it.desc}</p>}
      </div>
      <div className="sheet-scroll">
        <div style={{ display: 'flex', gap: 7, marginBottom: 4 }}>
          <button
            className="add-dep"
            style={{ borderStyle: 'solid', flex: 1 }}
            onClick={() => void toggleDone(issueId)}
          >
            {it.done ? '↺ Marchează ca nefăcut' : '✓ Marchează ca gata'}
          </button>
          <button
            className="add-dep"
            style={{ borderStyle: 'solid', width: 'auto', padding: '10px 14px' }}
            onClick={() => openEditIssue(issueId)}
          >
            ✎ Editează
          </button>
        </div>

        {deps.length > 0 && (
          <>
            <div className="sheet-section-t">Depinde de (toate valurile)</div>
            {deps.map((d) => {
              const dep = byId[d]
              if (!dep) return null
              const cross = dep.wave !== it.wave
              return (
                <button
                  key={d}
                  className={`dep-row ${cross ? 'cross' : ''}`}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => openIssue(d)}
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

        {it.type === 'epic' && it.children && it.children.length > 0 && (
          <>
            <div className="sheet-section-t">Sub-tichete ({it.children.length})</div>
            {it.children.map((c) => (
              <div key={c.id} className="dep-row">
                <span className="ic ext">○</span>
                <span>{c.title}</span>
                <span className="tk-id" style={{ marginLeft: 'auto' }}>
                  {c.id}
                </span>
              </div>
            ))}
          </>
        )}

        {unblocks.length > 0 && (
          <>
            <div className="sheet-section-t">Deblochează</div>
            {unblocks.map((b) => (
              <button
                key={b.id}
                className="dep-row"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => openIssue(b.id)}
              >
                <span className="ic ok">⌁</span>
                <span>{b.title}</span>
                <span className="wtag pending">{waveName(b.wave)}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  )
}
