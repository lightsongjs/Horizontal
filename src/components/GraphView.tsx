import { useMemo } from 'react'
import { useDepFlow } from '../store'
import { useUI } from '../ui'
import type { Issue } from '../lib/types'

/** Global topological depth across ALL issues (wave-independent), for x-layout. */
function globalDepths(issues: Issue[]): Record<string, number> {
  const set = new Set(issues.map((i) => i.id))
  const byId: Record<string, Issue> = {}
  for (const i of issues) byId[i.id] = i
  const memo: Record<string, number> = {}
  const depth = (id: string, seen: Set<string>): number => {
    if (memo[id] != null) return memo[id]
    if (seen.has(id)) return 0 // cycle guard
    const deps = (byId[id]?.deps ?? []).filter((d) => set.has(d))
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, new Set(seen).add(id)))) : 0
    memo[id] = d
    return d
  }
  for (const i of issues) depth(i.id, new Set())
  return memo
}

const NW = 104
const NH = 46

export function GraphView() {
  const { issues, project, stateOf, themeOf } = useDepFlow()
  const { openIssue } = useUI()

  const { nodes, edges, W, H } = useMemo(() => {
    const depths = globalDepths(issues)
    const cols: Record<number, string[]> = {}
    for (const it of issues) (cols[depths[it.id]] ??= []).push(it.id)

    const colW = 132
    const rowH = 78
    const padX = 8
    const padY = 14
    const pos: Record<string, { x: number; y: number }> = {}
    for (const [d, ids] of Object.entries(cols)) {
      ids.forEach((id, row) => {
        pos[id] = { x: padX + Number(d) * colW, y: padY + row * rowH }
      })
    }
    const maxCol = Math.max(0, ...Object.keys(cols).map(Number))
    const maxRow = Math.max(0, ...Object.values(cols).map((c) => c.length - 1))
    const edges = issues.flatMap((it) =>
      (it.deps ?? []).filter((d) => pos[d]).map((d) => ({ from: d, to: it.id })),
    )
    return {
      nodes: issues.map((it) => ({ it, ...pos[it.id] })),
      edges,
      W: padX * 2 + (maxCol + 1) * colW,
      H: padY * 2 + (maxRow + 1) * rowH,
    }
  }, [issues])

  const accent = project?.accent ?? '#6e7bff'
  const colorOf = (it: Issue) => (it.theme ? themeOf(it.theme)?.color ?? accent : accent)

  if (issues.length === 0) {
    return (
      <div className="panel">
        <p className="empty">Niciun tichet de afișat în graf. Adaugă tichete în „Ordine".</p>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="graph-hint">Trage lateral pentru a vedea tot graful →</div>
      <div className="gwrap">
        <svg className="graph" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#5d6173" />
            </marker>
          </defs>
          {edges.map(({ from, to }) => {
            const a = nodes.find((n) => n.it.id === from)!
            const b = nodes.find((n) => n.it.id === to)!
            const x1 = a.x + NW
            const y1 = a.y + NH / 2
            const x2 = b.x
            const y2 = b.y + NH / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${from}-${to}`}
                d={`M${x1 - 2},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 3},${y2}`}
                stroke="#33364a"
                strokeWidth="1.6"
                fill="none"
                markerEnd="url(#ah)"
              />
            )
          })}
          {nodes.map(({ it, x, y }) => {
            const state = stateOf(it.id)
            const color = colorOf(it)
            const fill = state === 'done' ? color + '22' : '#14151c'
            const stroke = state === 'done' ? color : state === 'active' ? '#ffb454' : '#262833'
            const op = state === 'blocked' ? 0.55 : 1
            return (
              <g key={it.id} opacity={op} style={{ cursor: 'pointer' }} onClick={() => openIssue(it.id)}>
                <rect x={x} y={y} width={NW} height={NH} rx="10" fill={fill} stroke={stroke} strokeWidth="1.4" />
                <rect x={x} y={y} width="3.5" height={NH} rx="2" fill={color} />
                <text x={x + 12} y={y + 17} fontSize="8.5" fontWeight="700" fill="#5d6173" fontFamily="ui-monospace, monospace">
                  {it.id}
                </text>
                <text x={x + 12} y={y + 33} fontSize="11.5" fontWeight="600" fill="#e8e9ee">
                  {it.title.length > 13 ? it.title.slice(0, 12) + '…' : it.title}
                </text>
                {state === 'done' && (
                  <text x={x + NW - 15} y={y + 19} fontSize="11" fill={color}>
                    ✓
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
