import { describe, expect, it } from 'vitest'
import { createMemoryPort, type HistorySnapshot } from './historyPort'

const sync = (fn: () => void) => fn()

describe('createMemoryPort', () => {
  it('pornește din intrarea dată', () => {
    const h = createMemoryPort({ initial: { state: { hzDepth: 0 }, path: '/' }, defer: sync })
    expect(h.pathname).toBe('/')
    expect(h.state).toEqual({ hzDepth: 0 })
  })

  it('push taie înainte, replace rescrie doar intrarea curentă', () => {
    const h = createMemoryPort({ initial: { state: 0, path: '/' }, defer: sync })
    h.pushState(1, '/a')
    h.pushState(2, '/b')
    h.back()
    h.pushState(3, '/c')
    h.forward() // nu mai e nimic înainte: /b a fost tăiat
    expect(h.pathname).toBe('/c')
    h.replaceState(4, '/d')
    h.back()
    expect([h.pathname, h.state]).toEqual(['/a', 1])
    h.forward()
    expect([h.pathname, h.state]).toEqual(['/d', 4])
  })

  it('go e asincron, ca la browser: popstate vine după apel', async () => {
    const h = createMemoryPort({ initial: { state: 0, path: '/' } })
    h.pushState(1, '/a')
    const seen: string[] = []
    h.onPop(() => seen.push(h.pathname))
    h.back()
    expect(h.pathname).toBe('/a')
    expect(seen).toEqual([])
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['/'])
  })

  it('go(-n) sare peste mai multe intrări cu un singur popstate', () => {
    const h = createMemoryPort({ initial: { state: 0, path: '/' }, defer: sync })
    h.pushState(1, '/a'); h.pushState(2, '/b'); h.pushState(3, '/c')
    let pops = 0
    h.onPop(() => { pops += 1 })
    h.go(-3)
    expect([h.pathname, pops]).toEqual(['/', 1])
  })

  it('în afara stivei și go(0) nu fac nimic, nici popstate — pe rădăcină Back nu iese nicăieri', () => {
    const h = createMemoryPort({ initial: { state: 0, path: '/' }, defer: sync })
    let pops = 0
    h.onPop(() => { pops += 1 })
    h.back(); h.go(0); h.go(5); h.go(-2)
    expect([h.pathname, pops]).toEqual(['/', 0])
  })

  it('dispatchPop anunță fără să traverseze; dezabonarea oprește ascultătorul', () => {
    const h = createMemoryPort({ initial: { state: 0, path: '/' }, defer: sync })
    h.pushState(null, '/HZ-1')
    let pops = 0
    const off = h.onPop(() => { pops += 1 })
    h.dispatchPop()
    expect([h.pathname, pops]).toEqual(['/HZ-1', 1])
    off()
    h.dispatchPop()
    expect(pops).toBe(1)
  })

  it('stiva supraviețuiește unei „reîncărcări" prin persist', () => {
    let disk: HistorySnapshot | null = null
    const persist = { load: () => disk, save: (s: HistorySnapshot) => { disk = s } }
    const a = createMemoryPort({ initial: { state: 0, path: '/' }, persist, defer: sync })
    a.pushState({ hzDepth: 1 }, '/project/x')
    a.pushState({ hzDepth: 2 }, '/HZ-3')
    a.back()
    const b = createMemoryPort({ initial: { state: 0, path: '/' }, persist, defer: sync })
    expect(b.pathname).toBe('/project/x')
    b.forward()
    expect(b.pathname).toBe('/HZ-3')
  })

  it('o poză salvată stricată e ignorată, nu crapă pornirea', () => {
    const bad = [null, { entries: [], index: 0 }, { entries: [{ state: 0, path: '/' }], index: 3 }, { entries: [{ state: 0 }], index: 0 }]
    for (const s of bad) {
      const h = createMemoryPort({ initial: { state: 9, path: '/start' }, persist: { load: () => s as HistorySnapshot | null, save: () => {} }, defer: sync })
      expect(h.pathname).toBe('/start')
    }
  })
})

describe('istoricul trece numai prin port', () => {
  // Un `window.history` direct într-un panou ar ajunge în istoricul comun al
  // filei (iframe) — exact ce portul există să împiedice. `calendar.tsx`
  // curăță URL-ul REAL al documentului de sus la întoarcerea din OAuth, iar
  // `main.tsx` ramifică bara de captură după calea reală, înainte de orice port.
  const ALLOWED = new Set(['./historyPort.ts', '../calendar.tsx', '../main.tsx'])
  it('niciun fișier din src nu atinge window.history / popstate direct', () => {
    const files = {
      ...import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>
    const bad = Object.entries(files)
      .filter(([f]) => !ALLOWED.has(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('/sw.ts'))
      .filter(([, src]) => /window\.history|(?<![\w.])history\.(pushState|replaceState|back|go|forward|state)\b|['"]popstate['"]|location\.pathname/.test(src.replace(/^\s*(\/\/|\/?\*).*$/gm, '')))
      .map(([f]) => f)
    expect(bad).toEqual([])
  })
})
