// Minimal single-user auth via Supabase. No sign-up, no reset — the user is
// created manually in the Supabase dashboard. When Supabase isn't configured
// (local dev), auth is disabled and the app runs without a login gate.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

interface AuthState {
  /** True when a login is required (Supabase is configured). */
  enabled: boolean
  session: Session | null
  loading: boolean
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = supabase != null
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      enabled,
      session,
      loading,
      async signIn(email, password) {
        if (!supabase) return 'Auth indisponibil.'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? error.message : null
      },
      async signOut() {
        await supabase?.auth.signOut()
      },
    }),
    [enabled, session, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
