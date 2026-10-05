// Stocarea locală: un magazin cheie-valoare pentru bază și unul autoincrement
// pentru coadă. IndexedDB și nu SQLite: merge identic în browser, în Electron și
// în WebView-ul Capacitor, deci stratul se scrie o dată.

import { openDB } from 'idb'
import type { OutboxOp, QueuedOp } from './ops'

/**
 * Execută cererile IndexedDB atomic: fie toate reușesc, fie nici una nu-și lasă
 * urmă. Promisiunile deja create sunt suprimate dacă build() cade.
 *
 * Cererile create dar neprocesate încă la eroare vor fi respinse de abort() cu
 * AbortError — trebuie prinse să nu devină respingeri neprinse. Dacă build()
 * aruncă, suppressul abort-ului previne respingeri neprinse; dacă tx.done ar
 * fi respins din altă cauză, metoda tot rejectează (indiferent dacă am cerut
 * noi abortul).
 */
async function atomic(
  tx: { done: Promise<void>; abort(): void },
  build: (track: (p: Promise<unknown>) => void) => void
) {
  const reqs: Promise<unknown>[] = []
  const track = (p: Promise<unknown>) => {
    p.catch(() => {})
    reqs.push(p)
  }
  try {
    build(track)
  } catch (e) {
    // build() a aruncat. Promisiunile deja create vor fi respinse de abort.
    // Suprimi done pentru a evita respingeri neprinse din abort.
    tx.done.catch(() => {})
    try {
      tx.abort()
    } catch {
      // Tranzacția e deja încheiată
    }
    throw e
  }
  // Așteptă pe toate; dacă tx.done rejectează (eroare sau abort), metoda rejectează.
  await Promise.all([...reqs, tx.done])
}

export interface Kv {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  keys(prefix: string): Promise<string[]>
  remove(keys: string[]): Promise<void>
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
    async remove(keys) {
      const tx = db.transaction('kv', 'readwrite')
      await atomic(tx, (track) => keys.forEach((k) => track(tx.store.delete(k))))
    },
    async ops() {
      return (await db.getAll('outbox')) as QueuedOp[]
    },
    async append(op) {
      return (await db.add('outbox', { op, at: new Date().toISOString() })) as number
    },
    async replaceOps(rewrite, remove) {
      const tx = db.transaction('outbox', 'readwrite')
      // Adună promisiunile cererilor: o eroare sincronă la put/delete ar duce la
      // auto-commit cu doar o parte din cererile aplicate fără abort explicit.
      await atomic(tx, (track) => {
        rewrite.forEach((q) => track(tx.store.put(q)))
        remove.forEach((s) => track(tx.store.delete(s)))
      })
    },
    async completeOp(seq, writes) {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      // Șterge op și scrie răspunsul atomic: o eroare la put ar lăsa op-ul în coadă
      // și răspunsul nescris, exact ce promite doc-comentariul.
      await atomic(tx, (track) => {
        track(tx.objectStore('outbox').delete(seq))
        writes.forEach(([k, v]) => track(tx.objectStore('kv').put(v, k)))
      })
    },
    async clear() {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      // Golește ambele magazine atomic: o eroare la orice clear ar duce la
      // auto-commit parțial fără abort explicit.
      await atomic(tx, (track) => {
        track(tx.objectStore('outbox').clear())
        track(tx.objectStore('kv').clear())
      })
    },
  }
}
