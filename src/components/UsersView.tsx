import { useEffect, useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import {
  listUsers, createUser, setAccess, resetPassword, deleteUser,
  type AdminUser, type AccessEntry,
} from '../lib/adminUsers'
import type { ProjectRole } from '../lib/access'
import type { Project } from '../lib/types'

type Draft = Record<string, ProjectRole | undefined>

const ROLE_OPTIONS: { value: ProjectRole | undefined; label: string }[] = [
  { value: undefined, label: 'Fără' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
]

function draftToAccess(d: Draft): AccessEntry[] {
  return Object.entries(d)
    .filter(([, role]) => role)
    .map(([project_id, role]) => ({ project_id, role: role as ProjectRole }))
}

/** Three-way segmented control: no access / read / write. */
function AccessToggle({ value, onChange }: { value: ProjectRole | undefined; onChange: (v: ProjectRole | undefined) => void }) {
  return (
    <div className="acc-toggle" role="group" aria-label="Nivel de acces">
      {ROLE_OPTIONS.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.label}
            type="button"
            className={`acc-opt ${on ? 'on' : ''} ${o.value ? `is-${o.value}` : 'is-none'}`}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Per-project access rows shared by the add form and each user card. */
function AccessGrid({ projects, draft, onSet }: { projects: Project[]; draft: Draft; onSet: (id: string, v: ProjectRole | undefined) => void }) {
  if (projects.length === 0) return <p className="users-empty sm">Niciun proiect de alocat.</p>
  return (
    <div className="acc-grid">
      {projects.map((p) => (
        <div className="acc-row" key={p.id}>
          <span className="acc-dot" style={{ background: p.accent || 'var(--txt-faint)' }} />
          <span className="acc-name">{p.name}</span>
          <AccessToggle value={draft[p.id]} onChange={(v) => onSet(p.id, v)} />
        </div>
      ))}
    </div>
  )
}

export function UsersView() {
  const { projects } = useHorizontal()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<Draft>({})

  async function reload() {
    try { setUsers(await listUsers()) } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  const grantCount = useMemo(() => Object.values(draft).filter(Boolean).length, [draft])
  const canSubmit = email.trim() !== '' && password.trim() !== '' && !busy

  async function onAdd() {
    setBusy(true); setError(null)
    try {
      await createUser(email.trim(), password, draftToAccess(draft))
      setEmail(''); setPassword(''); setDraft({})
      await reload()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="view users-view">
      <header className="users-head">
        <div>
          <h1 className="users-title">Utilizatori</h1>
          <p className="users-sub">Gestionează conturile și accesul lor pe proiecte.</p>
        </div>
        <span className="users-count">{users.length}</span>
      </header>

      {error && <div className="banner">⚠ {error}</div>}

      <section className="users-card users-add" style={{ animationDelay: '40ms' }}>
        <div className="users-card-title">
          <span className="ttl-ico" aria-hidden>＋</span> Adaugă utilizator
        </div>

        <div className="users-fields">
          <label className="users-field">
            <span className="users-flabel">Email</span>
            <input
              className="users-input"
              type="email"
              autoComplete="off"
              placeholder="nume@exemplu.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="users-field">
            <span className="users-flabel">Parolă</span>
            <input
              className="users-input"
              type="text"
              autoComplete="off"
              placeholder="parola inițială"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <div className="users-access-block">
          <div className="users-flabel row">
            <span>Acces la proiecte</span>
            {grantCount > 0 && <span className="grant-badge">{grantCount} alocate</span>}
          </div>
          <AccessGrid projects={projects} draft={draft} onSet={(id, v) => setDraft((d) => ({ ...d, [id]: v }))} />
        </div>

        <div className="users-add-foot">
          <button className="btn-primary" disabled={!canSubmit} onClick={onAdd}>
            {busy ? 'Se creează…' : 'Creează utilizator'}
          </button>
        </div>
      </section>

      <div className="users-section-label">Utilizatori existenți</div>

      {loading ? (
        <p className="users-empty">Se încarcă…</p>
      ) : users.length === 0 ? (
        <p className="users-empty">Niciun utilizator încă. Adaugă primul mai sus.</p>
      ) : (
        <div className="users-grid">
          {users.map((u, i) => (
            <UserCard key={u.id} user={u} projects={projects} index={i} onChanged={reload} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function UserCard({
  user, projects, index, onChanged, onError,
}: {
  user: AdminUser
  projects: Project[]
  index: number
  onChanged: () => Promise<void>
  onError: (m: string) => void
}) {
  const current = useMemo<Draft>(() => {
    const m: Draft = {}
    for (const a of user.access) m[a.project_id] = a.role
    return m
  }, [user.access])

  const [draft, setDraft] = useState<Draft>(current)
  const [busy, setBusy] = useState(false)

  // Reset local draft if the underlying user data changes (e.g. after reload).
  useEffect(() => { setDraft(current) }, [current])

  const changed = useMemo(() => {
    const keys = new Set([...Object.keys(current), ...Object.keys(draft)])
    for (const k of keys) if ((current[k] ?? undefined) !== (draft[k] ?? undefined)) return true
    return false
  }, [current, draft])

  const grantCount = Object.values(draft).filter(Boolean).length
  const initial = (user.email?.[0] ?? '?').toUpperCase()

  async function save() {
    setBusy(true)
    try { await setAccess(user.id, draftToAccess(draft)); await onChanged() }
    catch (e) { onError(String(e)) } finally { setBusy(false) }
  }
  async function resetPw() {
    const pw = prompt(`Parolă nouă pentru ${user.email}`)
    if (!pw) return
    try { await resetPassword(user.id, pw); alert('Parolă schimbată.') } catch (e) { onError(String(e)) }
  }
  async function remove() {
    if (!confirm(`Ștergi definitiv ${user.email}?`)) return
    try { await deleteUser(user.id); await onChanged() } catch (e) { onError(String(e)) }
  }

  return (
    <div className="user-card" style={{ animationDelay: `${80 + index * 45}ms` }}>
      <div className="user-card-head">
        <span className="user-avatar" aria-hidden>{initial}</span>
        <div className="user-id">
          <span className="user-email">{user.email}</span>
          <span className="user-meta">{grantCount === 0 ? 'Niciun proiect' : `${grantCount} proiect${grantCount === 1 ? '' : 'e'}`}</span>
        </div>
        <div className="user-actions">
          <button className="btn-ghost" onClick={resetPw}>Reset parolă</button>
          <button className="btn-danger" onClick={remove}>Șterge</button>
        </div>
      </div>

      <AccessGrid projects={projects} draft={draft} onSet={(id, v) => setDraft((d) => ({ ...d, [id]: v }))} />

      <div className="user-card-foot">
        <button className="btn-primary sm" disabled={!changed || busy} onClick={save}>
          {busy ? 'Se salvează…' : changed ? 'Salvează acces' : 'Salvat'}
        </button>
      </div>
    </div>
  )
}
