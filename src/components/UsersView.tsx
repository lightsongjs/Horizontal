import { useEffect, useState } from 'react'
import { useHorizontal } from '../store'
import {
  listUsers, createUser, setAccess, resetPassword, deleteUser,
  type AdminUser, type AccessEntry,
} from '../lib/adminUsers'
import type { ProjectRole } from '../lib/access'
import type { Project } from '../lib/types'

export function UsersView() {
  const { projects } = useHorizontal()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<Record<string, ProjectRole | undefined>>({})

  async function reload() {
    try { setUsers(await listUsers()) } catch (e) { setError(String(e)) }
  }
  useEffect(() => { void reload() }, [])

  function draftToAccess(d: Record<string, ProjectRole | undefined>): AccessEntry[] {
    return Object.entries(d)
      .filter(([, role]) => role)
      .map(([project_id, role]) => ({ project_id, role: role as ProjectRole }))
  }

  async function onAdd() {
    setBusy(true); setError(null)
    try {
      await createUser(email, password, draftToAccess(draft))
      setEmail(''); setPassword(''); setDraft({})
      await reload()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="view users-view">
      <div className="section-label">
        Utilizatori <span className="cnt">{users.length}</span>
      </div>
      {error && <div className="banner">⚠ {error}</div>}

      <section className="user-add">
        <div className="section-label">Adaugă utilizator</div>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="parolă" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ul className="access-list">
          {projects.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <select
                value={draft[p.id] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: (e.target.value || undefined) as ProjectRole | undefined }))}
              >
                <option value="">— fără acces —</option>
                <option value="read">read</option>
                <option value="write">write</option>
              </select>
            </li>
          ))}
        </ul>
        <button disabled={busy || !email || !password} onClick={onAdd}>Creează</button>
      </section>

      <section className="user-list">
        <div className="section-label">Utilizatori existenți</div>
        {users.map((u) => (
          <UserRow key={u.id} user={u} projects={projects} onChanged={reload} onError={setError} />
        ))}
      </section>
    </div>
  )
}

function UserRow({
  user, projects, onChanged, onError,
}: {
  user: AdminUser
  projects: Project[]
  onChanged: () => Promise<void>
  onError: (m: string) => void
}) {
  const current: Record<string, ProjectRole> = {}
  for (const a of user.access) current[a.project_id] = a.role
  const [draft, setDraft] = useState<Record<string, ProjectRole | undefined>>(current)

  async function save() {
    try {
      const access: AccessEntry[] = Object.entries(draft)
        .filter(([, r]) => r)
        .map(([project_id, r]) => ({ project_id, role: r as ProjectRole }))
      await setAccess(user.id, access)
      await onChanged()
    } catch (e) { onError(String(e)) }
  }
  async function resetPw() {
    const pw = prompt(`Parolă nouă pentru ${user.email}`)
    if (!pw) return
    try { await resetPassword(user.id, pw); alert('Parolă schimbată') } catch (e) { onError(String(e)) }
  }
  async function remove() {
    if (!confirm(`Ștergi ${user.email}?`)) return
    try { await deleteUser(user.id); await onChanged() } catch (e) { onError(String(e)) }
  }

  return (
    <div className="user-row">
      <strong>{user.email}</strong>
      <ul className="access-list">
        {projects.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <select
              value={draft[p.id] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: (e.target.value || undefined) as ProjectRole | undefined }))}
            >
              <option value="">— fără —</option>
              <option value="read">read</option>
              <option value="write">write</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="user-actions">
        <button onClick={save}>Salvează acces</button>
        <button onClick={resetPw}>Reset parolă</button>
        <button onClick={remove}>Șterge</button>
      </div>
    </div>
  )
}
