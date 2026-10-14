// Rezumatul firului (rândul din foaia de telefon), ținut în memorie pe tichet.
//
// Nu e în store: e o citire leneșă, cerută la deschiderea unei foi, iar un
// câmp în contextul store-ului ar fi randat din nou toate listele la fiecare
// sosire. Nu e nici pe disc: offline rândul lipsește, deliberat — un rând
// dintr-un cache vechi ar putea spune „citit" despre un fir care între timp a
// primit un comentariu.
//
// Se invalidează la scrierea în fir (`postToThread`, `updateComment`) și la
// `refresh()` din store; vizita (`markSeen`) doar mută `seenAt` pe loc.

import { useEffect, useState } from 'react'
import { repository } from '.'
import type { ThreadSummary } from '../lib/thread'

const cache = new Map<string, ThreadSummary>()
const inflight = new Map<string, Promise<ThreadSummary | null>>()
const listeners = new Set<() => void>()
/** Crește la fiecare invalidare: un răspuns plecat înainte nu mai intră în cache. */
let generation = 0

const notify = () => { for (const fn of listeners) fn() }

export function peekThreadSummary(issueId: string): ThreadSummary | undefined {
  return cache.get(issueId)
}

/** `null` = nu se știe (offline, eroare). Nu se ține minte, ca să se reîncerce. */
export function loadThreadSummary(issueId: string): Promise<ThreadSummary | null> {
  const hit = cache.get(issueId)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(issueId)
  if (pending) return pending
  const gen = generation
  const p = repository.threadSummary(issueId)
    .then((s) => {
      if (gen === generation) {
        cache.set(issueId, s)
        notify()
      }
      return s
    })
    .catch(() => null)
    .finally(() => { if (inflight.get(issueId) === p) inflight.delete(issueId) })
  inflight.set(issueId, p)
  return p
}

/** Fără argument: tot (reîmprospătarea din store). */
export function invalidateThreadSummary(issueId?: string): void {
  generation++
  if (issueId === undefined) { cache.clear(); inflight.clear() }
  else { cache.delete(issueId); inflight.delete(issueId) }
  notify()
}

/** Firul a fost citit acum: rândul trece pe „citit" fără o cerere nouă. */
export function noteThreadSeen(issueId: string, at = new Date().toISOString()): void {
  const s = cache.get(issueId)
  if (!s) return
  cache.set(issueId, { ...s, seenAt: at })
  notify()
}

/**
 * Rezumatul unui tichet, cerut la montare. `undefined` = pe drum, `null` = nu
 * se știe. Un tichet provizoriu sau o foaie fără drept de citire n-au ce cere.
 */
export function useThreadSummary(issueId: string): ThreadSummary | null | undefined {
  const [state, setState] = useState<ThreadSummary | null | undefined>(() => peekThreadSummary(issueId))
  useEffect(() => {
    let alive = true
    const sync = () => {
      const hit = peekThreadSummary(issueId)
      if (hit) { setState(hit); return }
      setState((prev) => (prev === null ? null : undefined))
      void loadThreadSummary(issueId).then((s) => { if (alive && !peekThreadSummary(issueId)) setState(s) })
    }
    sync()
    listeners.add(sync)
    return () => { alive = false; listeners.delete(sync) }
  }, [issueId])
  return state
}
