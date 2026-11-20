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
//
// Invalidat NU înseamnă șters (2026-11-20, `docs/agent/viteza-deschidere.md`):
// rândul stă DEASUPRA descrierii, deci unul care apărea abia după o rundă la
// server împingea descrierea în jos (~80px pe telefon) la fiecare deschidere
// de după un `refresh()` — adică după orice revenire în tab. Valoarea veche
// rămâne pe ecran cât se cere cea nouă, care o înlocuiește pe loc. Numai
// pentru rând: `loadThreadSummary` (vizita, pentru separatorul „nou" din fir)
// nu întoarce niciodată o valoare veche. Iar dacă cererea pică (offline),
// valoarea veche pleacă — regula de mai sus rămâne.
//
// Prima deschidere a unui tichet din listă nu mai așteaptă nici ea: lista își
// cere rezumatele în lot (`prefetchThreadSummaries`, `sheetPrefetch.ts`).
import { useEffect, useState } from 'react'
import { repository } from '.'
import type { ThreadSummary } from '../lib/thread'

const cache = new Map<string, ThreadSummary>()
/** Intrările invalidate: se arată, dar se cer din nou. */
const stale = new Set<string>()
const inflight = new Map<string, Promise<ThreadSummary | null>>()
const listeners = new Set<() => void>()
/** Crește la fiecare invalidare: un răspuns plecat înainte nu mai intră în cache. */
let generation = 0

const notify = () => { for (const fn of listeners) fn() }

/** Ce se poate arăta acum — și o valoare invalidată, cât vine cea nouă. */
export function peekThreadSummary(issueId: string): ThreadSummary | undefined {
  return cache.get(issueId)
}

const fresh = (issueId: string) => cache.has(issueId) && !stale.has(issueId)

/** `null` = nu se știe (offline, eroare). Nu se ține minte, ca să se reîncerce. */
export function loadThreadSummary(issueId: string): Promise<ThreadSummary | null> {
  if (fresh(issueId)) return Promise.resolve(cache.get(issueId)!)
  const pending = inflight.get(issueId)
  if (pending) return pending
  const gen = generation
  const p = repository.threadSummary(issueId)
    .then((s) => {
      if (gen === generation) {
        cache.set(issueId, s)
        stale.delete(issueId)
        notify()
      }
      return s
    })
    .catch(() => {
      // Offline: fără rând, nu cu unul vechi (vezi sus).
      if (gen === generation && stale.has(issueId)) { cache.delete(issueId); stale.delete(issueId); notify() }
      return null
    })
    .finally(() => { if (inflight.get(issueId) === p) inflight.delete(issueId) })
  inflight.set(issueId, p)
  return p
}

/**
 * Rezumatele unei liste, într-un singur drum (`threadSummaries`). Doar ce nu
 * e deja proaspăt sau pe drum; un eșec e tăcut — foaia își cere rândul
 * singură la deschidere, ca înainte.
 */
export function prefetchThreadSummaries(ids: readonly string[]): Promise<void> {
  const want = ids.filter((id) => !fresh(id) && !inflight.has(id))
  if (!want.length) return Promise.resolve()
  const gen = generation
  const batch = repository.threadSummaries(want)
  for (const id of want) {
    const one = batch.then((all) => all[id] ?? null, () => null)
      .finally(() => { if (inflight.get(id) === one) inflight.delete(id) })
    inflight.set(id, one)
  }
  return batch.then((all) => {
    if (gen !== generation) return
    for (const [id, s] of Object.entries(all)) { cache.set(id, s); stale.delete(id) }
    notify()
  }, () => {})
}

/** Fără argument: tot (reîmprospătarea din store). */
export function invalidateThreadSummary(issueId?: string): void {
  generation++
  if (issueId === undefined) {
    for (const id of cache.keys()) stale.add(id)
    inflight.clear()
  } else {
    if (cache.has(issueId)) stale.add(issueId)
    inflight.delete(issueId)
  }
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
      if (hit) setState(hit)
      else setState((prev) => (prev === null ? null : undefined))
      if (fresh(issueId)) return
      void loadThreadSummary(issueId).then((s) => { if (alive && !peekThreadSummary(issueId)) setState(s) })
    }
    sync()
    listeners.add(sync)
    return () => { alive = false; listeners.delete(sync) }
  }, [issueId])
  return state
}
