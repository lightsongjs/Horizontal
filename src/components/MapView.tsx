import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { COL_GAP, layoutMap, NODE_H, NODE_W, PAD, TOP, type MapNode } from '../lib/mapLayout'
import { layerVar } from '../lib/layerColors'

const RO_MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sept', 'oct', 'nov', 'dec']

const BAND_H = 26
const BAND_Y = TOP - BAND_H - 20

/** Poarta: muchia stângă teșită. Colț dreapta-sus retezat = are ocolire. */
function gatePath(x: number, y: number, hasBypass: boolean): string {
  const c = 13
  return hasBypass
    ? `M${x + c} ${y} H${x + NODE_W - 14} L${x + NODE_W} ${y + 14} V${y + NODE_H} H${x + c} L${x} ${y + NODE_H / 2} Z`
    : `M${x + c} ${y} H${x + NODE_W} V${y + NODE_H} H${x + c} L${x} ${y + NODE_H / 2} Z`
}

/** Închis, în sensul afișat pe hartă: tichet bifat, sau obstacol depășit/ocolit. */
function isClosed(n: MapNode): boolean {
  return n.kind === 'issue' ? n.state === 'done' : n.state === 'depasit' || n.state === 'ocolit'
}

/**
 * Culoarea barei din stânga nodului. `layerVar(i)` e indexat, peste tot în
 * restul aplicației, după poziția layerului în vederea ORDONATĂ — aici nu
 * există așa ceva, harta are doar coloane de adâncime. Indexul pe care i-l
 * dăm mai jos e coloana (adâncimea de dependență), reconstruită din `x`,
 * fiindcă `MapNode` nu poartă separat coloana — e o aproximare onestă, nu
 * „layerul real" al tichetului în vreo vedere filtrată pe val.
 */
function barColor(n: MapNode): string {
  if (n.kind === 'obstacle') {
    return n.state === 'depasit' || n.state === 'ocolit' ? 'var(--done)' : 'var(--blocked)'
  }
  if (n.state === 'done') return 'var(--done)'
  if (n.state === 'active') return 'var(--active)'
  const col = Math.round((n.x - PAD) / (NODE_W + COL_GAP))
  return layerVar(col)
}

export function MapView() {
  const { issues, obstacles, obstacleLinks, waves } = useHorizontal()
  const { openIssue, pushSheet } = useUI()

  const layout = useMemo(
    () => layoutMap({ issues, obstacles, links: obstacleLinks, waves }),
    [issues, obstacles, obstacleLinks, waves],
  )

  if (issues.length === 0) {
    return (
      <div className="panel">
        <p className="empty">Niciun tichet de afișat pe hartă. Adaugă tichete în „Ordine".</p>
      </div>
    )
  }

  const { nodes, edges, bands, todayX, width, height } = layout
  const byId: Record<string, MapNode> = {}
  for (const n of nodes) byId[n.id] = n

  const now = new Date()
  const todayLabel = `AZI · ${now.getDate()} ${RO_MONTHS[now.getMonth()]}`

  const handleClick = (n: MapNode) => {
    if (n.kind === 'issue') openIssue(n.id)
    else pushSheet({ kind: 'obstacle-form', obstacleId: n.id })
  }

  return (
    <div className="map-wrap">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <filter id="amb" x="-25%" y="-40%" width="150%" height="190%">
            <feDropShadow dx="0" dy="3" stdDeviation="7" floodOpacity="0.30" />
          </filter>
        </defs>

        {bands.map((b, i) => (
          <g key={i}>
            <rect className="map-band" x={b.x1} y={BAND_Y} width={b.x2 - b.x1} height={BAND_H} rx="6" />
            <text className="map-bandtxt" x={b.x1 + 12} y={BAND_Y + 17}>
              {b.label}
            </text>
          </g>
        ))}

        <line
          x1={todayX}
          y1={16}
          x2={todayX}
          y2={height - 12}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="2 5"
        />
        <text className="map-bandtxt" x={todayX + 8} y={14}>
          {todayLabel}
        </text>

        {/* Muchiile se desenează înaintea nodurilor, ca nodurile să le acopere. */}
        {edges.map((e, i) => {
          const a = byId[e.from]
          const b = byId[e.to]
          if (!a || !b) return null
          const x1 = a.x + NODE_W
          const y1 = a.y + NODE_H / 2
          const x2 = b.x
          const y2 = b.y + NODE_H / 2
          const dx = Math.max(46, (x2 - x1) / 2.3)
          const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 9} ${y2}`
          const head = `M${x2 - 9} ${y2 - 4.5} L${x2 - 1} ${y2} L${x2 - 9} ${y2 + 4.5} Z`
          return (
            <g key={`${e.from}-${e.to}-${i}`}>
              <path className={`map-edge ${e.tone}`} d={d} />
              <path className={`map-head ${e.tone}`} d={head} />
            </g>
          )
        })}

        {nodes.map((n) => {
          const closed = isClosed(n)
          const idX = n.x + (n.kind === 'obstacle' ? 26 : 14)
          const title = n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title
          const strikeEnd = Math.min(idX + title.length * 6.05, n.x + NODE_W - 12)
          return (
            <g key={n.id} className="map-node" filter="url(#amb)" onClick={() => handleClick(n)}>
              {n.kind === 'obstacle' ? (
                <path className="map-obst" d={gatePath(n.x, n.y, n.bypass !== null)} />
              ) : (
                <rect className="map-tick" x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx="10" />
              )}
              <rect
                x={n.kind === 'obstacle' ? n.x + 13 : n.x}
                y={n.y}
                width="2.5"
                height={NODE_H}
                fill={barColor(n)}
              />
              <text className="map-id" x={idX} y={n.y + 19}>
                {n.id}
              </text>
              <text className="map-own" x={n.x + NODE_W - 12} y={n.y + 19}>
                {n.owner}
              </text>
              <text className={`map-title${closed ? ' dim' : ''}`} x={idX} y={n.y + 38}>
                {title}
              </text>
              {closed && <line className="map-strike" x1={idX} y1={n.y + 34} x2={strikeEnd} y2={n.y + 34} />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
