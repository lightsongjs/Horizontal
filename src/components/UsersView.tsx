// Ecranul de administrare a conturilor: o listă, atât. Tot ce se poate face
// cu un cont stă în foaia lui (`UserForm`) — același tipar ca un tichet în
// „Listă". Înainte, fiecare cont era un card cu toate comutatoarele de acces
// deschise: cu treisprezece proiecte, ecranul era un perete de butoane în
// care nu se vedea cine sunt oamenii.
import { useEffect } from 'react'
import { useAuth } from '../auth'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useAdminUsers, reloadUsers } from '../lib/adminUsersStore'
import { memberDisplayName } from '../lib/assigneeOptions'
import type { AdminUser } from '../lib/adminUsers'
import { Icon } from './Icon'

/** Ce scrie pe rând în dreapta: accesul, pe scurt. */
function accessLabel(user: AdminUser): string {
  if (user.admin) return 'toate proiectele'
  const n = user.access.length
  if (n === 0) return 'fără acces'
  return `${n} proiect${n === 1 ? '' : 'e'}`
}

export function UsersView() {
  const { projects } = useHorizontal()
  const { session } = useAuth()
  const { openUserForm } = useUI()
  const { users, loading, error } = useAdminUsers()

  // Contul care se uită la ecran nu apare în listă. Nu e o ascunzătoare, e
  // absența unei decizii: accesul propriu nu se administrează de aici. Un
  // admin vede și scrie tot prin `is_admin()`, care ocolește complet
  // `project_members` — comutatoarele de pe rândul propriu n-ar fi schimbat
  // nimic, iar „Șterge contul" ar fi fost singurul buton din aplicație care
  // îți taie ție accesul, fără nimeni care să ți-l dea înapoi.
  const others = users.filter((u) => u.id !== session?.user.id)

  useEffect(() => { void reloadUsers() }, [])

  return (
    <div className="view users-view">
      <header className="users-head">
        <div>
          <h1 className="users-title">Utilizatori</h1>
          <p className="users-sub">Cine mai intră în aplicație, în afară de tine.</p>
        </div>
        <button className="btn-primary sm" onClick={() => openUserForm()}>
          <Icon name="add" size={14} /> Adaugă
        </button>
      </header>

      {error && <div className="banner">⚠ {error}</div>}

      {loading ? (
        <p className="users-empty">Se încarcă…</p>
      ) : others.length === 0 ? (
        <p className="users-empty">Niciun alt cont. Adaugă unul cu butonul de sus.</p>
      ) : (
        <div className="user-list">
          {others.map((u) => {
            const display = u.name ?? memberDisplayName(u.email)
            return (
              <button key={u.id} className="user-row" onClick={() => openUserForm(u.id)}>
                <span className="user-avatar" aria-hidden>{display[0]?.toUpperCase() ?? '?'}</span>
                <span className="user-id">
                  <span className="user-name">
                    {display}
                    {/* Fără nume propriu, rândul arată tot ceva — dar spune că
                        e o cădere pe email, nu un nume pus de cineva. */}
                    {!u.name && <span className="user-unnamed">fără nume</span>}
                  </span>
                  <span className="user-email">{u.email}</span>
                </span>
                <span className="user-access">{accessLabel(u)}</span>
                <Icon name="expand" size={16} className="user-chev" />
              </button>
            )
          })}
        </div>
      )}

      {projects.length === 0 && (
        <p className="users-empty sm" style={{ marginTop: 14 }}>
          Niciun proiect de alocat încă.
        </p>
      )}
    </div>
  )
}
