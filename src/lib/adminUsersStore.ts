// Lista de conturi, ținută în afara arborelui React.
//
// De ce un store extern și nu state în `UsersView`: foaia de utilizator e
// randată de `SheetHost`, care stă la nivelul lui `App` — în afara
// `UsersView`. Fără un loc comun, foaia ar trebui să-și ceară singură lista
// (încă un drum către funcția edge) și tot n-ar putea împrospăta lista din
// spate după salvare. Nu intră în `store.tsx`: acolo stau datele de care
// depinde toată aplicația, pe când astea se citesc doar pe un ecran de admin
// și numai de un admin.
import { useSyncExternalStore } from 'react'
import { listUsers } from './adminUsers'
import type { AdminUser } from './adminUsers'
import { errorMessage } from './errorMessage'

export interface AdminUsersState {
  users: AdminUser[]
  /** `true` doar la PRIMA încărcare — o reîncărcare păstrează lista pe ecran. */
  loading: boolean
  error: string | null
}

let state: AdminUsersState = { users: [], loading: true, error: null }
const subscribers = new Set<() => void>()

function set(next: Partial<AdminUsersState>) {
  state = { ...state, ...next }
  for (const fn of subscribers) fn()
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

export function useAdminUsers(): AdminUsersState {
  return useSyncExternalStore(subscribe, () => state)
}

export async function reloadUsers(): Promise<void> {
  try {
    set({ users: await listUsers(), error: null })
  } catch (e) {
    set({ error: errorMessage(e) })
  } finally {
    set({ loading: false })
  }
}
