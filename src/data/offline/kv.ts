// Stocarea locală: un magazin cheie-valoare pentru bază și unul autoincrement
// pentru coadă. IndexedDB și nu SQLite: merge identic în browser, în Electron și
// în WebView-ul Capacitor, deci stratul se scrie o dată.

import { openDB } from 'idb'
import type { OutboxOp, QueuedOp } from './ops'

export interface Kv {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  keys(prefix: string): Promise<string[]>
  ops(): Promise<QueuedOp[]>
  append(op: OutboxOp): Promise<number>
  replaceOps(rewrite: QueuedOp[], remove: number[]): Promise<void>
  /**
   * Un element trimis cu succes: se scoate din coadă ȘI se scrie răspunsul
   * serverului în bază, atomic. Separat, între cele două ar exista o clipă în
   * care o citire vede și baza nouă, și patch-ul vechi — iar o bifă pe o
   * recurentă ar sări de două ori pe ecran.
   */
  completeOp(seq: number, writes: [string, unknown][]): Promise<void>
  clear(): Promise<void>
}

export async function openKv(name = 'horizontal-offline'): Promise<Kv> {
  const db = await openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore('kv')
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
    },
  })
  return {
    async get<T>(key: string) {
      return (await db.get('kv', key)) as T | undefined
    },
    async set(key, value) {
      await db.put('kv', value, key)
    },
    async keys(prefix) {
      return ((await db.getAllKeys('kv')) as string[]).filter((k) => k.startsWith(prefix))
    },
    async ops() {
      return (await db.getAll('outbox')) as QueuedOp[]
    },
    async append(op) {
      return (await db.add('outbox', { op, at: new Date().toISOString() })) as number
    },
    async replaceOps(rewrite, remove) {
      const tx = db.transaction('outbox', 'readwrite')
      let errorToThrow: unknown = null
      try {
        // Adună promisiunile cererilor: o eroare sincronă la put/delete ar duce la
        // auto-commit cu doar o parte din cererile aplicate fără abort explicit.
        const reqs = [
          ...rewrite.map((q) => tx.store.put(q)),
          ...remove.map((s) => tx.store.delete(s)),
          tx.done,
        ]
        await Promise.all(reqs)
      } catch (e) {
        // O cerere a picat: salvează eroarea și abortează tranzacția
        errorToThrow = (e as DOMException)?.name === 'AbortError' ? null : e
        tx.abort()
      }
      // Dacă e să-și încheie abortul, așteptă-l pentru a consuma AbortErrors
      if (errorToThrow === null) {
        try {
          await tx.done
        } catch {
          // Abort e gata, nicio problemă
        }
      } else {
        // Tranzacția e abortată, dar raportează eroarea inițială
        throw errorToThrow
      }
    },
    async completeOp(seq, writes) {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      let errorToThrow: unknown = null
      try {
        // Șterge op și scrie răspunsul atomic: o eroare la put ar lăsa op-ul în coadă
        // și răspunsul nescris, exact ce promite doc-comentariul.
        const reqs = [
          tx.objectStore('outbox').delete(seq),
          ...writes.map(([k, v]) => tx.objectStore('kv').put(v, k)),
          tx.done,
        ]
        await Promise.all(reqs)
      } catch (e) {
        // O cerere a picat: salvează eroarea și abortează tranzacția
        errorToThrow = (e as DOMException)?.name === 'AbortError' ? null : e
        tx.abort()
      }
      // Dacă e să-și încheie abortul, așteptă-l pentru a consuma AbortErrors
      if (errorToThrow === null) {
        try {
          await tx.done
        } catch {
          // Abort e gata, nicio problemă
        }
      } else {
        // Tranzacția e abortată, dar raportează eroarea inițială
        throw errorToThrow
      }
    },
    async clear() {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      let errorToThrow: unknown = null
      try {
        // Golește ambele magazine atomic: o eroare la orice clear ar duce la
        // auto-commit parțial fără abort explicit.
        const reqs = [
          tx.objectStore('outbox').clear(),
          tx.objectStore('kv').clear(),
          tx.done,
        ]
        await Promise.all(reqs)
      } catch (e) {
        // O cerere a picat: salvează eroarea și abortează tranzacția
        errorToThrow = (e as DOMException)?.name === 'AbortError' ? null : e
        tx.abort()
      }
      // Dacă e să-și încheie abortul, așteptă-l pentru a consuma AbortErrors
      if (errorToThrow === null) {
        try {
          await tx.done
        } catch {
          // Abort e gata, nicio problemă
        }
      } else {
        // Tranzacția e abortată, dar raportează eroarea inițială
        throw errorToThrow
      }
    },
  }
}
