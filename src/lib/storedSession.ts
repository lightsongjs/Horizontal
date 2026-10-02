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

export function resolveBootSession(r: { session: Session | null; error: unknown }, stored: () => Session | null): Session | null {
  if (r.session) return r.session
  if (r.error && isNetworkError(r.error)) return stored()
  return null
}
