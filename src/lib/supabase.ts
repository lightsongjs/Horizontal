import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * postgrest-js reîncearcă singur orice citire căzută pe rețea, de trei ori, cu
 * 1 + 2 + 4 s între ele. Pentru un client care are propria plasă (cache-ul și
 * coada din `src/data/offline/`) asta înseamnă că fiecare citire offline
 * „eșuează" abia după ~7 s: o pornire fără rețea arăta atât timp „se trimite"
 * și refuza captura. Eșecul trebuie să vină din prima, ca să cadă pe cache.
 * supabase-js nu trece opțiunea `retry` mai departe, deci o punem direct pe
 * clientul REST; `supabase.test.ts` pică dacă o versiune nouă mută câmpul.
 */
export function withoutReadRetries(client: SupabaseClient): SupabaseClient {
  ;(client as unknown as { rest: { retry?: boolean } }).rest.retry = false
  return client
}

/** Null until VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set in .env. */
export const supabase: SupabaseClient | null =
  url && anonKey ? withoutReadRetries(createClient(url, anonKey)) : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
    )
  }
  return supabase
}
