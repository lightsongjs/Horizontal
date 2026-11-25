// „Hartă" ca ramuri: aritmetica pură a tabului, fără React și fără DOM, ca
// să se testeze singură (ca mapLayout.ts, pe care o înlocuiește).
//
// Decizia omului (2026-11-25, macheta `design/harta/`): dependențele se văd
// ca o organigramă de la stânga la dreapta, dar numai ce e DESCHIS, implicit.
// De aici trei idei, fiecare cu funcția ei mai jos:
//
// - O RAMURĂ e o componentă conexă a grafului (dependențe de tichete,
//   obstacole legate de tichete, dependențe între obstacole). Fiecare are
//   rândul ei; tot ce n-are nicio legătură iese din hartă, ca listă.
// - Închisele de dinaintea celor deschise se strâng într-o RĂDĂCINĂ („✓ 14"),
//   din care pornesc muchiile spre deschisele care au un predecesor închis.
//   „Arată și închise" pune graful întreg în loc.
// - Așezarea e Sugiyama în mic: coloana = cel mai lung drum din stânga,
//   muchiile lungi trec prin puncte intermediare (ca să nu taie un card),
//   ordinea în coloană din baricentre (mai puține încrucișări), iar muchiile
//   sunt în unghi drept, cu magistrala la jumătatea culoarului din fața
//   țintei — de-aia părinții multipli se unesc și copiii se ramifică din
//   același punct, ca la organigramă.

/** Un nod al hărții, înainte de așezare: tichet sau obstacol. */
export interface MapItem {
  id: string
  kind: 'issue' | 'obstacle'
  closed: boolean
  /** Predecesorii: dependențele tichetului + obstacolele legate de el;
   *  la un obstacol, obstacolele de care depinde. Id-urile necunoscute se ignoră. */
  deps: string[]
}

export interface Branch {
  /** Primul element (în ordinea de intrare) fără predecesori — numele ramurii. */
  rootId: string
  /** Toate elementele, în ordinea de intrare. */
  ids: string[]
  open: number
}

export interface MapSplit {
  /** Ramurile cu ceva deschis — cele mai multe deschise primele. */
  active: Branch[]
  /** Ramurile închise de tot (vizibile doar cu „Arată și închise"). */
  finished: Branch[]
  /** Elementele fără nicio legătură, în ordinea de intrare. */
  loose: string[]
}

export const ROOT = '@root'

/** Componentele conexe. Ordinea de intrare (`items`) e ordinea de afișare. */
export function splitBranches(items: MapItem[]): MapSplit {
  const index = new Map(items.map((it, i) => [it.id, i]))
  const nb = new Map<string, Set<string>>(items.map((it) => [it.id, new Set()]))
  for (const it of items) {
    for (const d of it.deps) {
      if (!index.has(d) || d === it.id) continue
      nb.get(it.id)!.add(d)
      nb.get(d)!.add(it.id)
    }
  }
  const byId = new Map(items.map((it) => [it.id, it]))
  const seen = new Set<string>()
  const branches: Branch[] = []
  const loose: string[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    if (nb.get(it.id)!.size === 0) { loose.push(it.id); seen.add(it.id); continue }
    const stack = [it.id]
    const ids: string[] = []
    seen.add(it.id)
    while (stack.length) {
      const v = stack.pop()!
      ids.push(v)
      for (const w of nb.get(v)!) if (!seen.has(w)) { seen.add(w); stack.push(w) }
    }
    ids.sort((a, b) => index.get(a)! - index.get(b)!)
    const inBranch = new Set(ids)
    const rootId = ids.find((id) => !byId.get(id)!.deps.some((d) => inBranch.has(d) && d !== id)) ?? ids[0]
    branches.push({ rootId, ids, open: ids.filter((id) => !byId.get(id)!.closed).length })
  }
  const active = branches.filter((b) => b.open > 0)
  // Stabil: la egalitate rămâne ordinea de intrare.
  active.sort((a, b) => b.open - a.open)
  return { active, finished: branches.filter((b) => b.open === 0), loose }
}

export interface GraphNode {
  key: string
  kind: 'item' | 'root'
  /** Doar la rădăcină: câte închise strânge. */
  count?: number
}

export interface BranchGraph {
  nodes: GraphNode[]
  /** `[de la, la]` — de la predecesor spre ce depinde de el. */
  edges: [string, string][]
}

/**
 * Ce se desenează dintr-o ramură. Implicit: deschisele, cu muchiile dintre
 * ele, plus rădăcina strânsă spre fiecare deschis care are un predecesor
 * DIRECT închis. Închisele de după un deschis (rare: bifate înainte de
 * dependența lor) se ascund și ele — sunt istorie, nu drum.
 */
export function branchGraph(branch: Branch, byId: Record<string, MapItem>, showAll: boolean): BranchGraph {
  const inBranch = new Set(branch.ids)
  const preds = (id: string) => [...new Set(byId[id].deps.filter((d) => inBranch.has(d) && d !== id))]
  if (showAll) {
    const edges: [string, string][] = []
    for (const id of branch.ids) for (const d of preds(id)) edges.push([d, id])
    return { nodes: branch.ids.map((key) => ({ key, kind: 'item' })), edges }
  }
  const open = branch.ids.filter((id) => !byId[id].closed)
  const edges: [string, string][] = []
  const fed = new Set<string>()
  for (const id of open) {
    for (const d of preds(id)) {
      if (!byId[d].closed) edges.push([d, id])
      else if (!fed.has(id)) { fed.add(id); edges.push([ROOT, id]) }
    }
  }
  const nodes: GraphNode[] = open.map((key) => ({ key, kind: 'item' }))
  if (fed.size) nodes.unshift({ key: ROOT, kind: 'root', count: branch.ids.length - open.length })
  return { nodes, edges }
}

export interface LayoutDims {
  nodeW: number
  nodeH: number
  /** Culoarul orizontal dintre coloane; magistrala muchiilor stă la jumătatea lui. */
  gap: number
  /** Spațiul vertical dintre frați; între grupuri cu părinți diferiți e de 2,5 ori. */
  vgap: number
  rootW: number
  rootH: number
}

export interface Box { x: number; y: number; w: number; h: number }

export interface BranchLayout {
  boxes: Record<string, Box>
  paths: { from: string; to: string; d: string }[]
  width: number
  height: number
}

/** Muchie în unghi drept, colțuri rotunjite (8px, `--r-s`). */
export function orthoPath(x0: number, y0: number, xb: number, y1: number, x1: number): string {
  if (Math.abs(y1 - y0) < 1) return `M${x0} ${y0}H${x1}`
  const s = y1 > y0 ? 1 : -1
  const r = Math.max(0, Math.min(8, Math.abs(y1 - y0) / 2, xb - x0, x1 - xb))
  return `M${x0} ${y0}H${xb - r}Q${xb} ${y0} ${xb} ${y0 + s * r}V${y1 - s * r}Q${xb} ${y1} ${xb + r} ${y1}H${x1}`
}

type Kind = 'item' | 'root' | 'dummy'

/** Așezarea unei ramuri. Nu aruncă: un ciclu (refuzat oricum la scriere) se rupe. */
export function layoutBranch(g: BranchGraph, dims: LayoutDims): BranchLayout {
  const { nodeW, nodeH, gap, vgap, rootW, rootH } = dims
  const kind = new Map<string, Kind>(g.nodes.map((n) => [n.key, n.kind]))
  const order = new Map(g.nodes.map((n, i) => [n.key, i]))
  const ins = new Map<string, string[]>(g.nodes.map((n) => [n.key, []]))
  for (const [a, b] of g.edges) if (kind.has(a) && kind.has(b)) ins.get(b)!.push(a)

  // Coloana = cel mai lung drum din stânga; `onStack` rupe un ciclu.
  const col = new Map<string, number>()
  const onStack = new Set<string>()
  const depth = (k: string): number => {
    const known = col.get(k)
    if (known !== undefined) return known
    if (onStack.has(k)) return 0
    onStack.add(k)
    const ps = ins.get(k)!
    const d = ps.length ? 1 + Math.max(...ps.map(depth)) : 0
    onStack.delete(k)
    col.set(k, d)
    return d
  }
  for (const n of g.nodes) depth(n.key)

  // Muchiile lungi trec prin puncte intermediare, câte unul pe coloană.
  const chains: { from: string; to: string; pts: string[] }[] = []
  let dn = 0
  for (const [a, b] of g.edges) {
    if (!kind.has(a) || !kind.has(b) || col.get(b)! <= col.get(a)!) continue
    const pts = [a]
    for (let c = col.get(a)! + 1; c < col.get(b)!; c++) {
      const k = `~${dn++}`
      kind.set(k, 'dummy'); col.set(k, c); order.set(k, order.get(a)! + 0.5)
      pts.push(k)
    }
    pts.push(b)
    chains.push({ from: a, to: b, pts })
  }
  const left = new Map<string, string[]>(), right = new Map<string, string[]>()
  for (const k of kind.keys()) { left.set(k, []); right.set(k, []) }
  for (const ch of chains) {
    for (let i = 0; i + 1 < ch.pts.length; i++) {
      right.get(ch.pts[i])!.push(ch.pts[i + 1])
      left.get(ch.pts[i + 1])!.push(ch.pts[i])
    }
  }

  const nCols = kind.size ? Math.max(...col.values()) + 1 : 0
  const cols: string[][] = Array.from({ length: nCols }, () => [])
  for (const k of kind.keys()) cols[col.get(k)!].push(k)
  for (const c of cols) c.sort((a, b) => order.get(a)! - order.get(b)!)

  // Ordinea în coloană: baricentrul vecinilor, treceri alternative →/←.
  const pos = new Map<string, number>()
  cols.forEach((c) => c.forEach((k, i) => pos.set(k, i)))
  for (let it = 0; it < 8; it++) {
    const back = it % 2 === 1
    const adj = back ? right : left
    const range = back ? [...cols.keys()].reverse() : [...cols.keys()]
    for (const ci of range) {
      const bc = (k: string) => {
        const ns = adj.get(k)!
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(k)!
      }
      const score = new Map(cols[ci].map((k) => [k, bc(k)]))
      cols[ci].sort((a, b) => score.get(a)! - score.get(b)! || order.get(a)! - order.get(b)!)
      cols[ci].forEach((k, i) => pos.set(k, i))
    }
  }

  // Pozițiile verticale: fiecare nod spre media vecinilor, fără suprapuneri.
  const h = (k: string) => kind.get(k) === 'item' ? nodeH : kind.get(k) === 'root' ? rootH : 0
  const y = new Map<string, number>()
  for (const c of cols) { let t = 0; for (const k of c) { y.set(k, t); t += h(k) + vgap } }
  const cy = (k: string) => y.get(k)! + h(k) / 2
  for (let it = 0; it < 6; it++) {
    const back = it % 2 === 1
    const adj = back ? right : left
    const range = back ? [...cols.keys()].reverse() : [...cols.keys()]
    for (const ci of range) {
      let bottom = -Infinity
      let prev: string | null = null
      for (const k of cols[ci]) {
        const ns = adj.get(k)!
        const want = ns.length ? ns.reduce((s, n) => s + cy(n), 0) / ns.length - h(k) / 2 : y.get(k)!
        // Copiii altui părinte încep după un spațiu mai mare: grupurile se citesc separat.
        const sib = prev !== null && left.get(k)!.join() === left.get(prev)!.join()
        const minY = bottom === -Infinity ? -Infinity : bottom + (sib ? vgap : vgap * 2.5)
        y.set(k, Math.max(want, minY))
        bottom = y.get(k)! + h(k)
        prev = k
      }
    }
  }
  const minY = kind.size ? Math.min(...[...kind.keys()].map((k) => y.get(k)!)) : 0
  for (const k of kind.keys()) y.set(k, y.get(k)! - minY)

  const colW = cols.map((c) => c.some((k) => kind.get(k) === 'item') ? nodeW : c.some((k) => kind.get(k) === 'root') ? rootW : 0)
  const colX: number[] = []
  colW.reduce((x, w, i) => { colX[i] = x; return x + w + gap }, 0)

  const boxes: Record<string, Box> = {}
  for (const k of kind.keys()) {
    const kk = kind.get(k)!
    if (kk === 'dummy') continue
    boxes[k] = { x: colX[col.get(k)!], y: y.get(k)!, w: kk === 'item' ? nodeW : rootW, h: h(k) }
  }
  const rightEdge = (k: string) =>
    kind.get(k) === 'dummy' ? colX[col.get(k)!] + colW[col.get(k)!] : boxes[k].x + boxes[k].w
  const paths = chains.map((ch) => {
    let d = ''
    for (let i = 0; i + 1 < ch.pts.length; i++) {
      const a = ch.pts[i], b = ch.pts[i + 1]
      const x1 = colX[col.get(b)!]
      const y1 = cy(b)
      d += orthoPath(rightEdge(a), cy(a), x1 - gap / 2, y1, x1)
      if (kind.get(b) === 'dummy') d += `M${x1} ${y1}H${rightEdge(b)}`
    }
    return { from: ch.from, to: ch.to, d }
  })

  const width = nCols ? colX[nCols - 1] + colW[nCols - 1] : 0
  const height = kind.size ? Math.max(...[...kind.keys()].map((k) => y.get(k)! + h(k))) : 0
  return { boxes, paths, width, height }
}

/** Tot lanțul unui nod: ce îl blochează (în sus) și ce deblochează (în jos). */
export function lineage(edges: [string, string][], key: string): { up: Set<string>; down: Set<string> } {
  const ins = new Map<string, string[]>(), outs = new Map<string, string[]>()
  for (const [a, b] of edges) {
    if (!ins.has(b)) ins.set(b, [])
    if (!outs.has(a)) outs.set(a, [])
    ins.get(b)!.push(a)
    outs.get(a)!.push(b)
  }
  const walk = (start: string, next: Map<string, string[]>) => {
    const out = new Set<string>()
    const stack = [start]
    while (stack.length) for (const n of next.get(stack.pop()!) ?? []) if (!out.has(n) && n !== key) { out.add(n); stack.push(n) }
    return out
  }
  return { up: walk(key, ins), down: walk(key, outs) }
}

/** O muchie face parte din lanțul aprins al lui `key`. */
export function edgeOnLineage(from: string, to: string, key: string, l: { up: Set<string>; down: Set<string> }): boolean {
  return (l.up.has(from) && (to === key || l.up.has(to))) || ((from === key || l.down.has(from)) && l.down.has(to))
}
