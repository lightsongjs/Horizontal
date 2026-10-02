// Minimal single-user auth via Supabase. No sign-up, no reset — the user is
// created manually in the Supabase dashboard. When Supabase isn't configured
// (local dev), auth is disabled and the app runs without a login gate.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  clearAccess,
  pickStoredSession,
  readAccess,
  resolveAccess,
  resolveBootSession,
  shouldApplyAuthEvent,
  writeAccess,
} from './lib/storedSession'
import { isAdminSession, buildAccessMap, type AccessMap } from './lib/access'

interface AuthState {
  /** True when a login is required (Supabase is configured). */
  enabled: boolean
  session: Session | null
  loading: boolean
  /** True when the signed-in user is the global admin. */
  isAdmin: boolean
  /** projectId -> role for the signed-in user (empty for admin). */
  access: import('./lib/access').AccessMap
  signIn(email: string, password: string): Promise<string | null>
  /** Mesajul erorii, sau null dacă sesiunea chiar s-a încheiat. */
  signOut(): Promise<string | null>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = supabase != null
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [access, setAccess] = useState<AccessMap>({})
  const isAdmin = isAdminSession(session)
  // Cine era logat, ca SIGNED_OUT (care vine cu sesiune null) să știe ce cheie șterge.
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const stored = () => (typeof localStorage === 'undefined' ? null : pickStoredSession(localStorage))
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(resolveBootSession({ session: data.session, error }, stored))
      setLoading(false)
    })
    // Un `null` venit fără SIGNED_OUT e un refresh eșuat, nu o delogare — vezi
    // `storedSession.ts`. Delogarea reală vine mereu cu evenimentul ei.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!shouldApplyAuthEvent(event, s)) return
      // La delogare harta păstrată pleacă odată cu sesiunea: următorul om de
      // pe acest dispozitiv n-are de ce să moștenească drepturi.
      if (!s && userIdRef.current && typeof localStorage !== 'undefined') clearAccess(localStorage, userIdRef.current)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    userIdRef.current = session?.user.id ?? userIdRef.current
    if (!supabase || !session || isAdmin) {
      setAccess({})
      return
    }
    const uid = session.user.id
    const store = typeof localStorage === 'undefined' ? null : localStorage
    let ignore = false
    supabase
      .from('project_members')
      .select('project_id, role')
      .then(
        ({ data, error }) => {
          if (ignore) return
          const map = error ? null : buildAccessMap(data ?? [])
          // Doar o hartă proaspătă și bună se păstrează; o eroare nu o atinge.
          if (map && store) writeAccess(store, uid, map)
          setAccess(resolveAccess({ map, error }, () => (store ? readAccess(store, uid) : null)))
        },
        (err) => {
          if (ignore) return
          setAccess(resolveAccess({ map: null, error: err }, () => (store ? readAccess(store, uid) : null)))
        },
      )
    return () => { ignore = true }
  }, [session, isAdmin])

  const value = useMemo<AuthState>(
    () => ({
      enabled,
      session,
      loading,
      isAdmin,
      access,
      async signIn(email, password) {
        if (!supabase) return 'Auth indisponibil.'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? error.message : null
      },
      async signOut() {
        const { error } = (await supabase?.auth.signOut()) ?? { error: null }
        return error ? error.message : null
      },
    }),
    [enabled, session, loading, isAdmin, access],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
