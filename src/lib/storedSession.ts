// Pornirea offline cu tokenul expirat.
//
// supabase-js încearcă un refresh la `getSession()`; fără rețea, refresh-ul
// eșuează și primim `session: null` — deși sesiunea e intactă în storage și
// va merge la prima rețea. Tratat ca „delogat", omul ar ajunge la `Login`
// exact când n-are cum să se logheze, cu datele din cache la un pas. Deci:
// eroare de REȚEA → păstrăm sesiunea din storage; refuz de SERVER (token
// revocat) → chiar ești delogat.

import type { Session } from '@supabase/supabase-js'
import { isNetworkError } from '../data/offline/netError'
import type { AccessMap } from './access'

const KEY = /^sb-.+-auth-token$/

export function pickStoredSession(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): Session | null {
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k || !KEY.test(k)) continue
    try {
      const v = JSON.parse(storage.getItem(k) ?? '')
      if (v && typeof v.access_token === 'string' && v.user && typeof v.user.id === 'string') return v as Session
    } catch {
      // Valoare stricată — mai departe, poate e altă cheie.
    }
  }
  return null
}

// Un `null` venit fără SIGNED_OUT e un refresh eșuat, nu o delogare: delogarea
// reală vine mereu cu evenimentul ei. O sesiune nenulă se aplică oricând.
export function shouldApplyAuthEvent(event: string, session: Session | null): boolean {
  return session !== null || event === 'SIGNED_OUT'
}

// Harta de acces a ultimului fetch reușit, pe utilizator.
//
// Fără ea, un ne-admin care pornește offline păstrează sesiunea (de mai sus),
// dar `project_members` pică pe rețea și harta devine `{}` — iar
// `useCanWriteIn`/`useWritableProjects` cer `access[id] === 'write'`, deci
// interfața din cache ar fi doar-citire și selectorul de proiect gol: nicio
// creare sau editare offline pentru nimeni în afară de admin. O eroare de
// SERVER (RLS, rând șters) rămâne `{}`: acolo „n-ai acces" e adevărul.

const ACCESS_PREFIX = 'horizontal:access:'

export function readAccess(storage: Pick<Storage, 'getItem'>, userId: string): AccessMap | null {
  try {
    const v = JSON.parse(storage.getItem(ACCESS_PREFIX + userId) ?? 'null')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const map: AccessMap = {}
    for (const [k, role] of Object.entries(v)) if (role === 'read' || role === 'write') map[k] = role
    return map
  } catch {
    return null
  }
}

export function writeAccess(storage: Pick<Storage, 'setItem'>, userId: string, map: AccessMap): void {
  try {
    storage.setItem(ACCESS_PREFIX + userId, JSON.stringify(map))
  } catch {
    // Storage plin sau blocat — se pierde doar plasa offline.
  }
}

export function clearAccess(storage: Pick<Storage, 'removeItem'>, userId: string): void {
  try {
    storage.removeItem(ACCESS_PREFIX + userId)
  } catch {
    // Idem.
  }
}

/** Ce hartă folosim după fetch: cea proaspătă, cea păstrată (rețea) sau `{}` (server). */
export function resolveAccess(
  r: { map: AccessMap | null; error: unknown },
  persisted: () => AccessMap | null,
): AccessMap {
  if (!r.error && r.map) return r.map
  if (r.error && isNetworkError(r.error)) return persisted() ?? {}
  return {}
}

export function resolveBootSession(r: { session: Session | null; error: unknown }, stored: () => Session | null): Session | null {
  if (r.session) return r.session
  if (r.error && isNetworkError(r.error)) return stored()
  return null
}
