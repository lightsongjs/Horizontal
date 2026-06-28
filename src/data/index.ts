// Picks the data backend. Set VITE_DATA_SOURCE=supabase (with credentials) to
// use the live DB; anything else falls back to the local seeded store.

import { supabase } from '../lib/supabase'
import { createLocalRepository } from './localRepository'
import { createSupabaseRepository } from './supabaseRepository'
import type { Repository } from './repository'

function pick(): Repository {
  const source = import.meta.env.VITE_DATA_SOURCE
  if (source === 'supabase' && supabase) return createSupabaseRepository()
  return createLocalRepository()
}

export const repository: Repository = pick()
export type { Repository } from './repository'
