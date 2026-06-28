import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Null until VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set in .env. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
    )
  }
  return supabase
}
