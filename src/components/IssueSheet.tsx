import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { Attachments } from './Attachments'
import { Icon } from './Icon'

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
              {assignee.name}{assignee.id === myAssigneeId ? ' (eu)' : ''}
            </>
          )}
          {it.done && <>{' · '}<span className="sheet-done"><Icon name="check" size={13} /> Gata</span></>}
        </div>
        <h2>{it.title}</h2>
      </div>

      <div className="sheet-scroll">
        {/* Descrierea stă în zona care se derulează, nu în `.sheet-head`.
            Headerul e fix: o descriere de douăzeci de rânduri l-ar fi umflat
            până când dependențele și atașamentele de mai jos rămâneau o fâșie
            de câțiva pixeli. Aici crește cât are nevoie și folosește toată
            înălțimea modalului. */}
        {it.desc && <p className="issue-desc">{it.desc}</p>}
        <button
          className="add-dep"
          style={{ borderStyle: 'solid', width: '100%', marginBottom: 12 }}
          onClick={() => openEditIssue(issueId)}
        >
          <Icon name="edit" size={15} /> Editează
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
                  <span className={`ic ${dep.done ? 'ok' : 'ext'}`}><Icon name={dep.done ? 'check' : 'dep'} size={14} /></span>
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
                <span className="ic ext"><Icon name="external" size={14} /></span>
                <span>{b.title}</span>
                <span className="wtag pending">{waveName(b.wave)}</span>
              </button>
            ))}
          </>
        )}

        <Attachments issueId={issueId} projectId={it.projectId} readOnly />

        {deps.length === 0 && permits.length === 0 && (
          <p className="dep-no-results">Nicio relație cu alte tichete.</p>
        )}
      </div>
    </>
  )
}
