// Panoul dublu: cine e realm-ul ăsta — aplicația obișnuită (sau gazda), ori
// unul dintre cele două panouri (un `<iframe src="/?pane=L|R">`).
// Spec: docs/superpowers/specs/2026-10-22-split-pane-design.md.
//
// Un panou e aplicația întreagă, dar:
// - istoricul e în memorie (`createMemoryPort`), persistat aici, în
//   `sessionStorage` — al FILEI, deci comun cu gazda și cu celălalt panou,
//   de-aia cheile poartă id-ul panoului;
// - ecranul memorat (`LAST_VIEW_KEY`, ultimul proiect, ultimul tab) e al
//   panoului (`viewStore`), nu al dispozitivului: două panouri care scriu
//   aceeași cheie din `localStorage` și-ar fi călcat ecranul la fiecare pornire;
// - nimic din ce are un singur executant pe dispozitiv nu pornește (PWA,
//   punțile native, mementourile, clopoțelul) — gazda le ține.

import type { HistorySnapshot } from './historyPort'

export type PaneId = 'L' | 'R'

export const isPaneId = (v: unknown): v is PaneId => v === 'L' || v === 'R'

/** Pur: id-ul panoului din `location.search`, sau null pentru aplicația obișnuită. */
export function paneIdFromSearch(search: string): PaneId | null {
  const v = new URLSearchParams(search).get('pane')
  return isPaneId(v) ? v : null
}

let current: PaneId | null | undefined

/** Panoul în care rulăm, sau null. Citit o dată: `src`-ul unui iframe nu se schimbă. */
export function paneId(): PaneId | null {
  if (current === undefined) {
    // Doar într-un cadru: un `/?pane=L` deschis direct într-o filă nu are gazdă.
    const framed = typeof window !== 'undefined' && window.parent !== window
    current = framed ? paneIdFromSearch(window.location.search) : null
  }
  return current
}

export const isPane = (): boolean => paneId() !== null

/** Stiva de istoric a unui panou, în `sessionStorage`. */
export const paneStackKey = (id: PaneId) => `horizontal:pane:${id}`
/** Ecranul memorat al unui panou (`viewStore`). */
export const paneViewKey = (id: PaneId, key: string) => `${key}:pane:${id}`

function safe<T>(f: () => T, fallback: T): T {
  try { return f() } catch { return fallback }
}

export function loadPaneStack(id: PaneId): HistorySnapshot | null {
  return safe(() => {
    const raw = sessionStorage.getItem(paneStackKey(id))
    return raw ? JSON.parse(raw) as HistorySnapshot : null
  }, null)
}

export function savePaneStack(id: PaneId, s: HistorySnapshot): void {
  safe(() => sessionStorage.setItem(paneStackKey(id), JSON.stringify(s)), undefined)
}

/** Ce scrie gazda înainte de a crea un panou: de unde pornește (o singură intrare) și ecranul lui. */
export interface PaneSeed {
  path: string
  state: unknown
  /** `LAST_VIEW_KEY` al panoului (`smart:today`…), sau null pe un proiect. */
  lastView: string | null
  /** `horizontal:last-project` al panoului (slug), sau null. */
  lastProject: string | null
}

const LAST_VIEW = 'horizontal:last-view'
const LAST_PROJECT = 'horizontal:last-project'

export function seedPane(id: PaneId, seed: PaneSeed): void {
  savePaneStack(id, { entries: [{ path: seed.path, state: seed.state }], index: 0 })
  safe(() => {
    const set = (k: string, v: string | null) => v === null
      ? sessionStorage.removeItem(paneViewKey(id, k))
      : sessionStorage.setItem(paneViewKey(id, k), v)
    set(LAST_VIEW, seed.lastView)
    set(LAST_PROJECT, seed.lastProject)
  }, undefined)
}

export function forgetPane(id: PaneId): void {
  safe(() => {
    sessionStorage.removeItem(paneStackKey(id))
    for (const k of [LAST_VIEW, LAST_PROJECT, 'horizontal:last-tab']) sessionStorage.removeItem(paneViewKey(id, k))
  }, undefined)
}

/** Ce a memorat un panou despre ecranul lui (citit de gazdă când panoul rămas devine aplicația). */
export function readPaneView(id: PaneId): { lastView: string | null; lastProject: string | null } {
  return safe(() => ({
    lastView: sessionStorage.getItem(paneViewKey(id, LAST_VIEW)),
    lastProject: sessionStorage.getItem(paneViewKey(id, LAST_PROJECT)),
  }), { lastView: null, lastProject: null })
}

/**
 * Ecranul memorat: `localStorage` pentru aplicația obișnuită (ca înainte, cheie
 * cu cheie), `sessionStorage` cu id-ul panoului într-un panou.
 */
export const viewStore = {
  get(key: string): string | null {
    const id = paneId()
    return safe(() => (id ? sessionStorage.getItem(paneViewKey(id, key)) : localStorage.getItem(key)), null)
  },
  set(key: string, value: string): void {
    const id = paneId()
    safe(() => (id ? sessionStorage.setItem(paneViewKey(id, key), value) : localStorage.setItem(key, value)), undefined)
  },
  remove(key: string): void {
    const id = paneId()
    safe(() => (id ? sessionStorage.removeItem(paneViewKey(id, key)) : localStorage.removeItem(key)), undefined)
  },
}
