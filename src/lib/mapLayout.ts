// Layout pur pentru „Hartă": aritmetica pixelilor, separată de componentă, ca
// să se poată testa fără JSX. Fără I/O, fără React — ca engine.ts, schedule.ts,
// parseDue.ts și obstacles.ts.
//
// Coloana unui tichet e adâncimea lui în graful de dependențe (globalDepths,
// mutat aici din vechiul GraphView). Coloana unui obstacol pornește de la
// regula #2 din plan — „min(coloana tichetelor blocate) - 1, cel puțin 0" —
// dar aplicată literal, clamp-ul intră în conflict cu propriul test al
// planului: un obstacol care blochează un tichet de adâncime 0 ar clampa la
// aceeași coloană cu tichetul, nu una înainte. Soluția (ruling-ul
// controller-ului): se calculează coloane BRUTE, care pot ieși negative, apoi
// tot graful se normalizează scăzând minimul global — coloana cea mai din
// stânga iese mereu 0, iar „cel puțin 0" din regula #2 se citește după
// normalizare, nu înainte de ea.
//
// Coloana brută a unui obstacol e max(
//   min(coloana tichetelor pe care le blochează) - 1,
//   max(coloana obstacolelor de care depinde) + 1,
// ) — cu fiecare termen absent dacă legătura corespunzătoare lipsește, și 0
// dacă lipsesc amândouă. Cele două jumătăți ale acelui max pot intra în
// conflict (un obstacol care depinde de altul ȘI blochează un tichet timpuriu);
// max rezolvă în favoarea lanțului de dependențe, fiindcă o dependență e o
// ordine tare, iar „înainte de ce blochează" e doar o preferință de citire.

import { deriveState, indexById } from './engine'
import { openObstacles } from './obstacles'
import type { Issue, IssueState, Obstacle, ObstacleLink, ObstacleState, Wave } from './types'

export const NODE_W = 196
export const NODE_H = 52
export const COL_GAP = 68
export const ROW_GAP = 24
export const PAD = 36
export const TOP = 112

export interface MapNode {
  id: string
  kind: 'issue' | 'obstacle'
  title: string
  owner: string
  state: IssueState | ObstacleState
  bypass: string | null
  x: number
  y: number
}

export interface MapEdge {
  from: string
  to: string
  tone: 'dep' | 'blk' | 'don'
}

export interface MapBand {
  x1: number
  x2: number
  label: string
}

export interface MapLayout {
  nodes: MapNode[]
  edges: MapEdge[]
  bands: MapBand[]
  todayX: number
  width: number
  height: number
}

export interface MapLayoutInput {
  issues: Issue[]
  obstacles: Obstacle[]
  links: ObstacleLink[]
  waves: Wave[]
}

/** Adâncimea unui tichet în graful global de dependențe. Cycle-safe (un `seen`
 * care se repetă întoarce 0) și ignoră deps care ies din setul dat. */
function issueRawColumns(issues: Issue[]): Record<string, number> {
  const set = new Set(issues.map((i) => i.id))
  const byId: Record<string, Issue> = {}
  for (const i of issues) byId[i.id] = i
  const memo: Record<string, number> = {}
  const depth = (id: string, seen: Set<string>): number => {
    if (memo[id] != null) return memo[id]
    if (seen.has(id)) return 0
    const deps = (byId[id]?.deps ?? []).filter((d) => set.has(d))
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, new Set(seen).add(id)))) : 0
    memo[id] = d
    return d
  }
  for (const i of issues) depth(i.id, new Set())
  return memo
}

/** Coloana brută a fiecărui obstacol, per ruling-ul din antetul fișierului.
 * Cycle-safe la fel ca issueRawColumns: un `seen` care se repetă întoarce 0. */
function obstacleRawColumns(
  obstacles: Obstacle[],
  links: ObstacleLink[],
  issueCol: Record<string, number>,
): Record<string, number> {
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o
  const blockedIssuesOf: Record<string, string[]> = {}
  for (const l of links) (blockedIssuesOf[l.obstacleId] ??= []).push(l.issueId)

  const memo: Record<string, number> = {}
  const rawCol = (id: string, seen: Set<string>): number => {
    if (memo[id] != null) return memo[id]
    if (seen.has(id)) return 0
    const o = byId[id]
    if (!o) return 0
    const nextSeen = new Set(seen).add(id)

    const blockedCols = (blockedIssuesOf[id] ?? [])
      .map((iid) => issueCol[iid])
      .filter((c): c is number => c != null)
    const fromIssues = blockedCols.length ? Math.min(...blockedCols) - 1 : null

    const depIds = (o.deps ?? []).filter((d) => byId[d])
    const fromDeps = depIds.length ? Math.max(...depIds.map((d) => rawCol(d, nextSeen))) + 1 : null

    const col =
      fromIssues == null && fromDeps == null
        ? 0
        : fromIssues == null
          ? fromDeps!
          : fromDeps == null
            ? fromIssues
            : Math.max(fromIssues, fromDeps)
    memo[id] = col
    return col
  }

  const out: Record<string, number> = {}
  for (const o of obstacles) out[o.id] = rawCol(o.id, new Set())
  return out
}

/** Layout complet — nu aruncă niciodată, indiferent de date. */
export function layoutMap({ issues, obstacles, links, waves }: MapLayoutInput): MapLayout {
  const issueRaw = issueRawColumns(issues)
  const obstacleRaw = obstacleRawColumns(obstacles, links, issueRaw)

  const allRaw = [...Object.values(issueRaw), ...Object.values(obstacleRaw)]
  const shift = allRaw.length ? -Math.min(...allRaw) : 0

  const issueCol: Record<string, number> = {}
  for (const [id, c] of Object.entries(issueRaw)) issueCol[id] = c + shift
  const obstacleCol: Record<string, number> = {}
  for (const [id, c] of Object.entries(obstacleRaw)) obstacleCol[id] = c + shift

  // Rândul = ordinea de intrare în coloană, obstacolele înaintea tichetelor.
  const byCol: Record<number, string[]> = {}
  for (const o of obstacles) (byCol[obstacleCol[o.id]] ??= []).push(o.id)
  for (const it of issues) (byCol[issueCol[it.id]] ??= []).push(it.id)
  const rowOf: Record<string, number> = {}
  for (const ids of Object.values(byCol)) ids.forEach((id, row) => { rowOf[id] = row })

  const xOf = (col: number) => PAD + col * (NODE_W + COL_GAP)
  const yOf = (row: number) => TOP + row * (NODE_H + ROW_GAP)

  const byId = indexById(issues)
  const obstacleById: Record<string, Obstacle> = {}
  for (const o of obstacles) obstacleById[o.id] = o
  const openSet = openObstacles(obstacles)

  const isClosed = (kind: 'issue' | 'obstacle', id: string): boolean =>
    kind === 'issue' ? (byId[id]?.done ?? false) : !openSet.has(id)

  // Un obstacol deschis dar `blocking: false` nu oprește nimic — muchia lui
  // nu are voie să pretindă `blk`. Cade pe `dep`, tonul neutru existent,
  // fiindcă nu e nici blocant, nici închis; nu se adaugă un al patrulea ton.
  const toneFrom = (kind: 'issue' | 'obstacle', id: string): MapEdge['tone'] => {
    if (kind === 'obstacle' && openSet.has(id) && (obstacleById[id]?.blocking ?? true)) return 'blk'
    if (isClosed(kind, id)) return 'don'
    return 'dep'
  }

  const nodes: MapNode[] = []
  for (const it of issues) {
    nodes.push({
      id: it.id,
      kind: 'issue',
      title: it.title,
      owner: '',
      state: deriveState(it, byId),
      bypass: null,
      x: xOf(issueCol[it.id]),
      y: yOf(rowOf[it.id]),
    })
  }
  for (const o of obstacles) {
    nodes.push({
      id: o.id,
      kind: 'obstacle',
      title: o.title,
      owner: o.owner,
      state: o.state,
      bypass: o.bypass,
      x: xOf(obstacleCol[o.id]),
      y: yOf(rowOf[o.id]),
    })
  }

  const edges: MapEdge[] = []
  for (const it of issues) {
    for (const d of it.deps ?? []) {
      if (!byId[d]) continue
      edges.push({ from: d, to: it.id, tone: toneFrom('issue', d) })
    }
  }
  for (const l of links) {
    if (!byId[l.issueId] || !obstacleById[l.obstacleId]) continue
    edges.push({ from: l.obstacleId, to: l.issueId, tone: toneFrom('obstacle', l.obstacleId) })
  }
  for (const o of obstacles) {
    for (const d of o.deps ?? []) {
      if (!obstacleById[d]) continue
      edges.push({ from: d, to: o.id, tone: toneFrom('obstacle', d) })
    }
  }

  // „Azi" — mijlocul spațiului dintre ultima coloană complet închisă și prima
  // cu ceva deschis. Fără o asemenea graniță, linia stă înaintea a tot.
  const colsPresent = new Set<number>()
  for (const it of issues) colsPresent.add(issueCol[it.id])
  for (const o of obstacles) colsPresent.add(obstacleCol[o.id])
  const sortedCols = [...colsPresent].sort((a, b) => a - b)

  let lastAllClosedCol: number | null = null
  let firstOpenCol: number | null = null
  for (const c of sortedCols) {
    const closedFlags: boolean[] = []
    for (const it of issues) if (issueCol[it.id] === c) closedFlags.push(isClosed('issue', it.id))
    for (const o of obstacles) if (obstacleCol[o.id] === c) closedFlags.push(isClosed('obstacle', o.id))
    if (closedFlags.length > 0 && closedFlags.every(Boolean)) lastAllClosedCol = c
    if (firstOpenCol === null && closedFlags.some((closed) => !closed)) firstOpenCol = c
  }

  const todayX =
    lastAllClosedCol != null && firstOpenCol != null && firstOpenCol > lastAllClosedCol
      ? (xOf(lastAllClosedCol) + NODE_W + xOf(firstOpenCol)) / 2
      : PAD - 12

  // Benzile de val — una per val prezent în `issues`, în ordinea din `waves`.
  const bands: MapBand[] = []
  for (const w of waves) {
    const waveIssueIds = issues.filter((it) => it.wave === w.number).map((it) => it.id)
    if (waveIssueIds.length === 0) continue
    const cols = waveIssueIds.map((id) => issueCol[id])
    const x1 = xOf(Math.min(...cols)) - 20
    const x2 = xOf(Math.max(...cols)) + NODE_W + 20
    bands.push({ x1, x2, label: w.name })
  }

  const maxCol = sortedCols.length ? Math.max(...sortedCols) : 0
  const maxRows = Math.max(1, ...Object.values(byCol).map((ids) => ids.length))
  const width = PAD * 2 + maxCol * (NODE_W + COL_GAP) + NODE_W
  const height = TOP + maxRows * (NODE_H + ROW_GAP) + PAD

  return { nodes, edges, bands, todayX, width, height }
}
