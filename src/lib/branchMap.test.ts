import { describe, expect, it } from 'vitest'
import { branchGraph, edgeOnLineage, layoutBranch, lineage, orthoPath, ROOT, splitBranches, type MapItem } from './branchMap'

const item = (id: string, deps: string[] = [], closed = false, kind: MapItem['kind'] = 'issue'): MapItem => ({ id, kind, closed, deps })
const index = (items: MapItem[]) => Object.fromEntries(items.map((i) => [i.id, i]))
const DIMS = { nodeW: 240, nodeH: 64, gap: 72, vgap: 14, rootW: 52, rootH: 28 }

// Ramura din machetă: două închise → A; A → B, C; B → 3 copii; C → 4 copii.
const bushy = [
  item('X1', [], true), item('X2', [], true),
  item('A', ['X1', 'X2']),
  item('B', ['A']), item('C', ['A']),
  item('B1', ['B']), item('B2', ['B']), item('B3', ['B']),
  item('C1', ['C']), item('C2', ['C']), item('C3', ['C']), item('C4', ['C']),
]

describe('splitBranches', () => {
  it('o ramură = o componentă conexă; izolatele ies separat', () => {
    const s = splitBranches([item('Q1'), ...bushy, item('Q2'), item('D', [], true), item('E', ['D'], true)])
    expect(s.active.map((b) => b.rootId)).toEqual(['X1'])
    expect(s.active[0].ids).toHaveLength(12)
    expect(s.active[0].open).toBe(10)
    expect(s.finished.map((b) => b.ids)).toEqual([['D', 'E']])
    expect(s.loose).toEqual(['Q1', 'Q2'])
  })

  it('cele cu mai multe deschise primele, la egalitate ordinea de intrare', () => {
    const s = splitBranches([item('P'), item('P1', ['P']), item('R'), item('R1', ['R']), item('R2', ['R'])])
    expect(s.active.map((b) => b.rootId)).toEqual(['R', 'P'])
  })

  it('ignoră dependențele spre id-uri necunoscute și spre sine', () => {
    const s = splitBranches([item('A', ['nu-exista', 'A'])])
    expect(s.loose).toEqual(['A'])
  })

  it('un obstacol leagă tichetele ca orice dependență', () => {
    const s = splitBranches([item('O', [], false, 'obstacle'), item('T', ['O'])])
    expect(s.active[0].ids).toEqual(['O', 'T'])
  })
})

describe('branchGraph', () => {
  const s = splitBranches(bushy)
  const byId = index(bushy)

  it('implicit: închisele se strâng în rădăcină, care hrănește deschisele cu predecesor închis', () => {
    const g = branchGraph(s.active[0], byId, false)
    expect(g.nodes[0]).toEqual({ key: ROOT, kind: 'root', count: 2 })
    expect(g.nodes.map((n) => n.key)).not.toContain('X1')
    expect(g.edges.filter(([a]) => a === ROOT)).toEqual([[ROOT, 'A']]) // o singură muchie, nu câte una pe predecesor
    expect(g.edges).toContainEqual(['C', 'C4'])
  })

  it('„Arată și închise": graful întreg, fără rădăcină', () => {
    const g = branchGraph(s.active[0], byId, true)
    expect(g.nodes.map((n) => n.key)).toEqual(bushy.map((i) => i.id))
    expect(g.edges).toContainEqual(['X2', 'A'])
    expect(g.nodes.some((n) => n.kind === 'root')).toBe(false)
  })

  it('fără predecesori închiși nu există rădăcină', () => {
    const items = [item('A'), item('B', ['A'])]
    const g = branchGraph(splitBranches(items).active[0], index(items), false)
    expect(g.nodes.map((n) => n.key)).toEqual(['A', 'B'])
  })

  it('închisele de DUPĂ un deschis se ascund și ele', () => {
    const items = [item('A'), item('Z', ['A'], true)]
    const g = branchGraph(splitBranches(items).active[0], index(items), false)
    expect(g.nodes.map((n) => n.key)).toEqual(['A'])
    expect(g.edges).toEqual([])
  })
})

describe('layoutBranch', () => {
  const s = splitBranches(bushy)
  const byId = index(bushy)

  const overlaps = (boxes: Record<string, { x: number; y: number; w: number; h: number }>) => {
    const bs = Object.values(boxes)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true
    }
    return false
  }

  it('coloane de la stânga la dreapta după adâncime; nimic nu se suprapune', () => {
    const L = layoutBranch(branchGraph(s.active[0], byId, false), DIMS)
    expect(L.boxes[ROOT].x).toBe(0)
    expect(L.boxes.A.x).toBe(52 + 72)
    expect(L.boxes.B.x).toBe(L.boxes.C.x)
    expect(L.boxes.B1.x).toBeGreaterThan(L.boxes.B.x)
    expect(overlaps(L.boxes)).toBe(false)
    expect(overlaps(layoutBranch(branchGraph(s.active[0], byId, true), DIMS).boxes)).toBe(false)
  })

  it('copiii stau grupați lângă părintele lor, fără să se amestece', () => {
    const L = layoutBranch(branchGraph(s.active[0], byId, false), DIMS)
    const ys = (ids: string[]) => ids.map((id) => L.boxes[id].y)
    const bMax = Math.max(...ys(['B1', 'B2', 'B3'])), cMin = Math.min(...ys(['C1', 'C2', 'C3', 'C4']))
    const bMin = Math.min(...ys(['B1', 'B2', 'B3'])), cMax = Math.max(...ys(['C1', 'C2', 'C3', 'C4']))
    expect(bMax < cMin || cMax < bMin).toBe(true)
    // Între grupuri e mai mult loc decât între frați.
    const gapBetween = bMax < cMin ? cMin - (bMax + 64) : bMin - (cMax + 64)
    expect(gapBetween).toBeGreaterThan(14)
  })

  it('o muchie lungă ocolește coloana din mijloc prin culoar, nu prin carduri', () => {
    const items = [item('A'), item('M', ['A']), item('Z', ['A', 'M'])]
    const L = layoutBranch(branchGraph(splitBranches(items).active[0], index(items), true), DIMS)
    expect(L.boxes.Z.x).toBe(2 * (240 + 72))
    const az = L.paths.find((p) => p.from === 'A' && p.to === 'Z')!
    // Segmentul care traversează coloana lui M nu are voie să cadă în cardul lui M.
    const m = L.boxes.M
    const ys = [...az.d.matchAll(/M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)H(\d+(?:\.\d+)?)/g)]
      .filter((x) => Number(x[1]) === m.x).map((x) => Number(x[2]))
    expect(ys.length).toBe(1)
    expect(ys[0] < m.y || ys[0] > m.y + m.h).toBe(true)
  })

  it('un ciclu nu blochează așezarea', () => {
    const g = { nodes: [{ key: 'A', kind: 'item' as const }, { key: 'B', kind: 'item' as const }], edges: [['A', 'B'], ['B', 'A']] as [string, string][] }
    expect(() => layoutBranch(g, DIMS)).not.toThrow()
  })

  it('lățimea și înălțimea cuprind tot', () => {
    const L = layoutBranch(branchGraph(s.active[0], byId, false), DIMS)
    for (const b of Object.values(L.boxes)) {
      expect(b.x + b.w).toBeLessThanOrEqual(L.width)
      expect(b.y + b.h).toBeLessThanOrEqual(L.height)
    }
  })
})

describe('orthoPath', () => {
  it('drept când e pe același rând', () => expect(orthoPath(0, 10, 30, 10, 60)).toBe('M0 10H60'))
  it('în unghi drept, cu colțuri de 8px, pe magistrala dată', () =>
    expect(orthoPath(0, 0, 36, 100, 72)).toBe('M0 0H28Q36 0 36 8V92Q36 100 44 100H72'))
})

describe('lineage', () => {
  const g = branchGraph(splitBranches(bushy).active[0], index(bushy), false)
  it('în sus până la rădăcină, în jos până la frunze', () => {
    const l = lineage(g.edges, 'C')
    expect([...l.up].sort()).toEqual(['A', ROOT].sort())
    expect([...l.down].sort()).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
  it('muchiile aprinse sunt doar cele de pe lanț', () => {
    const l = lineage(g.edges, 'C')
    expect(edgeOnLineage('A', 'C', 'C', l)).toBe(true)
    expect(edgeOnLineage(ROOT, 'A', 'C', l)).toBe(true)
    expect(edgeOnLineage('C', 'C2', 'C', l)).toBe(true)
    expect(edgeOnLineage('A', 'B', 'C', l)).toBe(false)
    expect(edgeOnLineage('B', 'B1', 'C', l)).toBe(false)
  })
})
