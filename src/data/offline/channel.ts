// Mai multe file (sau bara de captură de pe desktop, care pentru browser e tot
// o filă) au aceeași bază locală, dar câte un store React fiecare. Canalul le
// spune celorlalte ce s-a schimbat; lacătul face ca o singură filă să golească
// coada, ca o scriere să nu plece de două ori.

import type { SyncChannel } from './offlineRepository'
import type { SyncEvent } from './types'

export function createBroadcastSyncChannel(name = 'horizontal-sync'): SyncChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const ch = new BroadcastChannel(name)
  return {
    post: (e: SyncEvent) => ch.postMessage(e),
    onMessage: (fn) => { ch.onmessage = (m: MessageEvent<SyncEvent>) => fn(m.data) },
  }
}

export function webLock(name: string): ((fn: () => Promise<void>) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null
  return (fn) => navigator.locks.request(name, fn).then(() => undefined)
}
