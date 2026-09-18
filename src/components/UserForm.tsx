// Foaia unui cont: nume, acces pe proiecte, parolă, ștergere. Randată de
// `SheetHost` ca orice altă foaie, deci primește gratis Back-ul, Escape și
// animația. Lista din spate (`UsersView`) și foaia asta citesc ACELAȘI store
// (`adminUsersStore`) — de-aia numele salvat aici apare în listă fără ca
// vreuna să i-l paseze celeilalte.
import { useEffect, useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useAdminUsers, reloadUsers } from '../lib/adminUsersStore'
import {
  createUser, setAccess, setName, resetPassword, deleteUser, type AccessEntry,
} from '../lib/adminUsers'
import { errorMessage } from '../lib/errorMessage'
import type { ProjectRole } from '../lib/access'
import type { Project } from '../lib/types'
import { Icon } from './Icon'

type Draft = Record<string, ProjectRole | undefined>

/**
 * Lungimea minimă a parolei, cea implicită din GoTrue. Dacă în Supabase e pusă
 * una mai mare, serverul refuză oricum, iar mesajul lui ajunge la ecran —
 * verificarea de aici scutește drumul dus-întors, nu îl înlocuiește.
 */
const MIN_PASSWORD = 6

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

/** Comutator cu trei stări: fără acces / read / write. */
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

export function UserForm({ userId }: { userId?: string }) {
  const { projects, refresh } = useHorizontal()
  const { closeSheet } = useUI()
  const { users } = useAdminUsers()
  const user = users.find((u) => u.id === userId)

  const current = useMemo<Draft>(() => {
    const m: Draft = {}
    for (const a of user?.access ?? []) m[a.project_id] = a.role
    return m
  }, [user])

  const [name, setNameField] = useState(user?.name ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<Draft>(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newPw, setNewPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwDone, setPwDone] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { setDraft(current) }, [current])

  const isNew = !userId
  const grantCount = Object.values(draft).filter(Boolean).length

  const accessChanged = useMemo(() => {
    const keys = new Set([...Object.keys(current), ...Object.keys(draft)])
    for (const k of keys) if ((current[k] ?? undefined) !== (draft[k] ?? undefined)) return true
    return false
  }, [current, draft])
  const nameChanged = name.trim() !== (user?.name ?? '')

  const canSave = isNew
    ? email.trim() !== '' && password.length >= MIN_PASSWORD && !busy
    : (nameChanged || accessChanged) && !busy

  async function save() {
    if (!canSave) return
    setBusy(true); setError(null)
    try {
      if (isNew) {
        await createUser(email.trim(), password, name, draftToAccess(draft))
      } else {
        // Numele întâi: dacă serverul îl refuză (gol pe un cont care are deja
        // unul), nu vrem accesul scris pe jumătate dintr-o salvare eșuată.
        if (nameChanged) await setName(userId!, name)
        if (accessChanged) await setAccess(userId!, draftToAccess(draft))
      }
      await reloadUsers()
      // Numele trăiește în `assignees`, adică în selectoarele întregii
      // aplicații — nu doar pe ecranul ăsta. Fără reîncărcare, „Assigned to"
      // ar arăta numele vechi până la următoarea pornire.
      if (nameChanged || isNew) void refresh()
      closeSheet()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    if (newPw.length < MIN_PASSWORD) {
      // Verificat aici, nu numai pe server: serverul răspunde corect, dar în
      // engleză și după un drum dus-întors, pentru o regulă știută dinainte.
      return setError(`Parola trebuie să aibă cel puțin ${MIN_PASSWORD} caractere.`)
    }
    setPwBusy(true); setError(null)
    try {
      await resetPassword(userId!, newPw)
      setNewPw(''); setPwDone(true)
    } catch (e) { setError(errorMessage(e)) } finally { setPwBusy(false) }
  }

  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await deleteUser(userId!)
      await reloadUsers()
      closeSheet()
    } catch (e) {
      setError(errorMessage(e)); setDeleting(false); setConfirmDelete(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow">
          <Icon name={isNew ? 'add' : 'people'} size={13} /> {isNew ? 'Cont nou' : 'Cont'}
        </div>
        <h2>{isNew ? 'Adaugă utilizator' : name.trim() || user?.email || 'Utilizator'}</h2>
        <p>
          {isNew
            ? 'Emailul e cel cu care se loghează. Numele e cel pe care îl vede toată lumea pe tichete.'
            : 'Numele apare peste tot unde contul e ales: „Assigned to”, carduri, fir.'}
        </p>
      </div>

      <div className="sheet-scroll">
        <div className="fld">
          <label>Nume</label>
          <input
            value={name}
            onChange={(e) => setNameField(e.target.value)}
            placeholder={user?.email ? user.email.split('@')[0] : 'ex. Mihai'}
            autoFocus={!isNew}
          />
          {!name.trim() && (
            <p className="fld-hint">
              Fără nume, apare partea din față a emailului{user?.email ? ` („${user.email.split('@')[0]}”)` : ''}.
            </p>
          )}
        </div>

        {isNew ? (
          <>
            <div className="fld">
              <label>Email</label>
              <input type="email" autoComplete="off" value={email} placeholder="nume@exemplu.com" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="fld">
              <label>Parolă inițială</label>
              <input
                type="text"
                autoComplete="off"
                value={password}
                placeholder={`minimum ${MIN_PASSWORD} caractere`}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="fld">
            <label>Email</label>
            <div className="fld-static">{user?.email}</div>
          </div>
        )}

        <div className="sheet-section-t row">
          <span>Acces la proiecte</span>
          {grantCount > 0 && <span className="grant-badge">{grantCount} alocate</span>}
        </div>
        <AccessGrid projects={projects} draft={draft} onSet={(id, v) => setDraft((d) => ({ ...d, [id]: v }))} />

        {error && <div className="banner">⚠ {error}</div>}

        <div className="save-bar">
          <button onClick={save} disabled={!canSave}>
            {busy ? 'Se salvează…' : isNew ? 'Creează utilizator' : 'Salvează'}
          </button>
        </div>

        {!isNew && (
          <>
            <div className="sheet-section-t" style={{ marginTop: 24 }}>Parolă</div>
            <div className="pw-row">
              <input
                type="text"
                autoComplete="off"
                value={newPw}
                placeholder={`parolă nouă (min. ${MIN_PASSWORD})`}
                onChange={(e) => { setNewPw(e.target.value); setPwDone(false) }}
              />
              <button className="btn-ghost" onClick={changePassword} disabled={pwBusy || newPw === ''}>
                {pwBusy ? 'Se schimbă…' : 'Schimbă'}
              </button>
            </div>
            {pwDone && <p className="fld-hint ok">Parolă schimbată.</p>}

            <div className="sheet-section-t" style={{ marginTop: 24, color: 'var(--blocked)' }}>Zonă periculoasă</div>
            <p className="fld-hint">
              {confirmDelete
                ? `Ești sigur? Contul ${user?.email} nu se mai poate loga. Tichetele rămân, cu numele lui.`
                : 'Ștergerea contului îi taie accesul definitiv.'}
            </p>
            <div className="save-bar" style={{ paddingTop: 0 }}>
              <button
                onClick={remove}
                disabled={deleting}
                style={{
                  background: confirmDelete ? 'var(--blocked)' : 'transparent',
                  border: '1px solid var(--blocked)',
                  color: confirmDelete ? '#fff' : 'var(--blocked)',
                }}
              >
                {deleting ? 'Se șterge…' : confirmDelete ? 'Confirmă ștergerea' : 'Șterge contul'}
              </button>
            </div>
            {confirmDelete && !deleting && (
              <div style={{ textAlign: 'center', marginTop: 6 }}>
                <button className="link-btn" onClick={() => setConfirmDelete(false)}>Anulează</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
