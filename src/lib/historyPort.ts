// Istoricul aplicației printr-un port, nu direct prin `window.history`.
//
// De ce: în panoul dublu (spec `docs/superpowers/specs/2026-10-22-split-pane-design.md`)
// fiecare panou e aplicația întreagă într-un `<iframe>`, iar istoricul unui
// iframe e comun cu al filei — un `go(-n)` din `goTop` ar desface pașii
// celuilalt panou, iar Back-ul browserului ar lucra pe panoul care a navigat
// ultimul. Acolo portul e `createMemoryPort`; fără panouri e `browserPort`,
// adică exact apelurile de dinainte, unu la unu.
//
// Un singur port pe realm (`appHistory`): fiecare iframe are modulele lui, deci
// un context React n-ar adăuga nimic. Se alege o dată, înainte de randare
// (`setHistoryPort`), și nu se schimbă cât trăiește pagina.

export interface HistoryPort {
  /** `history.state` al intrării curente. */
  readonly state: unknown
  /** `location.pathname` al intrării curente. */
  readonly pathname: string
  pushState(state: unknown, path: string): void
  replaceState(state: unknown, path: string): void
  back(): void
  forward(): void
  /** Asincron, ca la browser: `popstate` vine după, nu în timpul apelului. */
  go(delta: number): void
  /** Ascultă `popstate`. Întoarce dezabonarea. */
  onPop(fn: () => void): () => void
  /** Un `popstate` ca al browserului, fără traversare (deep link-ul unei notificări). */
  dispatchPop(): void
}

/** `window.history` / `window.location`, fără nicio diferență de comportament. */
export const browserPort: HistoryPort = {
  get state() { return window.history.state },
  get pathname() { return window.location.pathname },
  pushState: (state, path) => window.history.pushState(state, '', path),
  replaceState: (state, path) => window.history.replaceState(state, '', path),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  go: (delta) => window.history.go(delta),
  onPop(fn) {
    window.addEventListener('popstate', fn)
    return () => window.removeEventListener('popstate', fn)
  },
  dispatchPop: () => { window.dispatchEvent(new PopStateEvent('popstate')) },
}

export interface HistoryEntry { state: unknown; path: string }
export interface HistorySnapshot { entries: HistoryEntry[]; index: number }

export interface MemoryPortOptions {
  /** Intrarea de pornire, dacă nu există nimic salvat. */
  initial: HistoryEntry
  /** Stiva supraviețuiește reîncărcării: `load` la creare, `save` după fiecare schimbare. */
  persist?: { load(): HistorySnapshot | null; save(s: HistorySnapshot): void }
  /** Cum se amână `popstate` (implicit `setTimeout(…, 0)`); testele îl pot face sincron. */
  defer?: (fn: () => void) => void
}

const validSnapshot = (s: HistorySnapshot | null): s is HistorySnapshot =>
  !!s && Array.isArray(s.entries) && s.entries.length > 0 &&
  Number.isInteger(s.index) && s.index >= 0 && s.index < s.entries.length &&
  s.entries.every((e) => e && typeof e.path === 'string')

/**
 * O stivă în memorie cu semantica browserului: `push` taie ce era înainte,
 * `go` în afara stivei nu face nimic (nici `popstate`), `go(0)` nu face nimic
 * (la browser ar reîncărca — aici n-are ce). Pe rădăcină `back()` nu iese
 * nicăieri: un panou nu are „afară".
 */
export function createMemoryPort(opts: MemoryPortOptions): HistoryPort {
  const saved = opts.persist?.load() ?? null
  let entries: HistoryEntry[] = validSnapshot(saved) ? saved.entries.map((e) => ({ ...e })) : [{ ...opts.initial }]
  let index = validSnapshot(saved) ? saved.index : 0
  const listeners = new Set<() => void>()
  const defer = opts.defer ?? ((fn: () => void) => { setTimeout(fn, 0) })
  const save = () => opts.persist?.save({ entries: entries.map((e) => ({ ...e })), index })
  const emit = () => { for (const fn of [...listeners]) fn() }

  const port: HistoryPort = {
    get state() { return entries[index].state },
    get pathname() { return entries[index].path },
    pushState(state, path) {
      entries = [...entries.slice(0, index + 1), { state, path }]
      index = entries.length - 1
      save()
    },
    replaceState(state, path) {
      entries = entries.map((e, i) => (i === index ? { state, path } : e))
      save()
    },
    back: () => port.go(-1),
    forward: () => port.go(1),
    go(delta) {
      if (!Number.isInteger(delta) || delta === 0) return
      defer(() => {
        const to = index + delta
        if (to < 0 || to >= entries.length) return
        index = to
        save()
        emit()
      })
    },
    onPop(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    dispatchPop: () => emit(),
  }
  return port
}

let current: HistoryPort | null = null

/** Alege portul realm-ului. O dată, înainte de prima randare. */
export function setHistoryPort(p: HistoryPort): void { current = p }

const port = (): HistoryPort => current ?? browserPort

/** Istoricul aplicației. Nimic din `src/` nu atinge `window.history` direct (test: `historyPort.test.ts`). */
export const appHistory: HistoryPort = {
  get state() { return port().state },
  get pathname() { return port().pathname },
  pushState: (s, p) => port().pushState(s, p),
  replaceState: (s, p) => port().replaceState(s, p),
  back: () => port().back(),
  forward: () => port().forward(),
  go: (d) => port().go(d),
  onPop: (fn) => port().onPop(fn),
  dispatchPop: () => port().dispatchPop(),
}
