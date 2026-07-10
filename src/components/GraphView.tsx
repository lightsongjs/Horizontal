import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import type { Issue } from '../lib/types'

function globalDepths(issues: Issue[]): Record<string, number> {
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

const NW = 148
const NH = 60

export function GraphView() {
  const { issues, project, stateOf, themeOf } = useHorizontal()
  const { openIssue } = useUI()

  const { nodes, edges, W, H } = useMemo(() => {
    const depths = globalDepths(issues)
    const cols: Record<number, string[]> = {}
    for (const it of issues) (cols[depths[it.id]] ??= []).push(it.id)

    const colW = 192
    const rowH = 88
    const padX = 28
    const padY = 32

    const maxColSize = Math.max(1, ...Object.values(cols).map((c) => c.length))
    const totalH = padY * 2 + maxColSize * rowH

    const pos: Record<string, { x: number; y: number }> = {}
    for (const [d, ids] of Object.entries(cols)) {
      const colHeight = ids.length * rowH
      const startY = (totalH - colHeight) / 2
      ids.forEach((id, row) => {
        pos[id] = { x: padX + Number(d) * colW, y: startY + row * rowH }
      })
    }

    const maxCol = Math.max(0, ...Object.keys(cols).map(Number))
    const edges = issues.flatMap((it) =>
      (it.deps ?? []).filter((d) => pos[d]).map((d) => ({ from: d, to: it.id })),
    )
    return {
      nodes: issues.map((it) => ({ it, ...pos[it.id] })),
      edges,
      W: padX * 2 + (maxCol + 1) * colW,
      H: totalH,
    }
  }, [issues])

  const accent = project?.accent ?? '#0EA5E9'
  const colorOf = (it: Issue) => (it.theme ? themeOf(it.theme)?.color ?? accent : accent)

  if (issues.length === 0) {
    return (
      <div className="panel">
        <p className="empty">Niciun tichet de afișat în graf. Adaugă tichete în „Cards".</p>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="graph-hint">Trage lateral pentru a vedea tot graful →</div>
      <div className="gwrap">
        <svg className="graph" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,1 L6.5,4 L0,7 Z" fill="var(--txt-faint)" />
            </marker>
            <filter id="glow-done" x="-30%" y="-40%" width="160%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#3ecf8e" floodOpacity="0.3" />
            </filter>
            <filter id="glow-active" x="-30%" y="-40%" width="160%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#ffb454" floodOpacity="0.35" />
            </filter>
          </defs>

          {/* Edges */}
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
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 1},${y2}`}
                stroke="var(--line)"
                strokeWidth="1.5"
                fill="none"
                markerEnd="url(#ah)"
              />
            )
          })}

          {/* Nodes */}
          {nodes.map(({ it, x, y }) => {
            const state = stateOf(it.id)
            const color = colorOf(it)

            const bgFill =
              state === 'done' ? 'var(--done-soft)' :
              state === 'active' ? 'var(--active-soft)' :
              'var(--surface-2)'

            const borderStroke =
              state === 'done' ? 'var(--done)' :
              state === 'active' ? 'var(--active)' :
              'var(--line)'

            const borderWidth = (state === 'done' || state === 'active') ? '1.5' : '1'
            const glowFilter =
              state === 'done' ? 'url(#glow-done)' :
              state === 'active' ? 'url(#glow-active)' :
              undefined

            const op = state === 'blocked' ? 0.45 : 1
            const title = it.title.length > 17 ? it.title.slice(0, 16) + '…' : it.title

            return (
              <g
                key={it.id}
                opacity={op}
                style={{ cursor: 'pointer' }}
                onClick={() => openIssue(it.id)}
                filter={glowFilter}
              >
                {/* Card */}
                <rect
                  x={x} y={y}
                  width={NW} height={NH}
                  rx="10"
                  fill={bgFill}
                  stroke={borderStroke}
                  strokeWidth={borderWidth}
                />
                {/* Left accent bar — clipped to card shape */}
                <rect x={x} y={y + 10} width="4" height={NH - 20} fill={color} rx="2" />
                <rect x={x} y={y} width="4" height="10" fill={color} />
                <rect x={x} y={y + NH - 10} width="4" height="10" fill={color} />

                {/* ID */}
                <text
                  x={x + 16}
                  y={y + 20}
                  fontSize="9"
                  fontWeight="700"
                  fill="var(--txt-faint)"
                  fontFamily="var(--mono)"
                  letterSpacing="0.6"
                >
                  {it.id}
                </text>

                {/* Title */}
                <text
                  x={x + 16}
                  y={y + 40}
                  fontSize="12.5"
                  fontWeight="600"
                  fill="var(--txt)"
                  fontFamily="var(--display)"
                >
                  {title}
                </text>

                {/* Done checkmark */}
                {state === 'done' && (
                  <text x={x + NW - 20} y={y + 21} fontSize="11" fill="var(--done)" fontWeight="700">✓</text>
                )}
                {/* Active pulse dot */}
                {state === 'active' && (
                  <circle cx={x + NW - 15} cy={y + 16} r="4" fill="var(--active)" />
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
