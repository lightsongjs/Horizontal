// Picks the data backend. Set VITE_DATA_SOURCE=supabase (with credentials) to
// use the live DB; anything else falls back to the local seeded store.
//
// Pe Supabase, repository-ul e învelit de stratul offline (bază locală + coadă
// de scrieri, vezi `src/data/offline/`). Fără IndexedDB (fereastră privată pe
// unele browsere) învelișul trece direct la server, ca înainte.

import { supabase } from '../lib/supabase'
import { createLocalRepository } from './localRepository'
import { createSupabaseRepository } from './supabaseRepository'
import { createOfflineRepository } from './offline/offlineRepository'
import { openKv } from './offline/kv'
import { createBroadcastSyncChannel, webLock } from './offline/channel'
import type { Repository } from './repository'

let currentUserId: string | null = null
supabase?.auth.onAuthStateChange((_e, s) => { currentUserId = s?.user.id ?? null })

function pick(): Repository {
  const source = import.meta.env.VITE_DATA_SOURCE
  if (source === 'supabase' && supabase) {
    const kv = typeof indexedDB === 'undefined' ? Promise.resolve(null) : openKv().catch(() => null)
    return createOfflineRepository(createSupabaseRepository(), kv, {
      userId: () => currentUserId,
      channel: createBroadcastSyncChannel(),
      lock: webLock('horizontal-outbox') ?? undefined,
    })
  }
  return createLocalRepository()
}

export const repository: Repository = pick()
export type { Repository } from './repository'
