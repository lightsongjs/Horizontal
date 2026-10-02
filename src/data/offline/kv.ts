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
      for (const q of rewrite) void tx.store.put(q)
      for (const s of remove) void tx.store.delete(s)
      await tx.done
    },
    async completeOp(seq, writes) {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      void tx.objectStore('outbox').delete(seq)
      for (const [k, v] of writes) void tx.objectStore('kv').put(v, k)
      await tx.done
    },
    async clear() {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      void tx.objectStore('outbox').clear()
      void tx.objectStore('kv').clear()
      await tx.done
    },
  }
}
