import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useNarrow } from '../hooks'
import { Icon } from './Icon'
import { displayIssueId } from '../lib/issueId'
import { deriveState, indexById } from '../lib/engine'
import { openObstacles } from '../lib/obstacles'
import {
  branchGraph, edgeOnLineage, layoutBranch, lineage, ROOT, splitBranches,
  type Branch, type BranchGraph, type BranchLayout, type MapItem,
} from '../lib/branchMap'

/**
 * „Hartă": dependențele ca ramuri, de la stânga la dreapta (decizia omului,
 * 2026-11-25; macheta aprobată e `design/harta/`). Aritmetica stă în
 * `lib/branchMap.ts`; aici doar desenul și gesturile. Regulile și de-ce-urile:
 * `docs/agent/harta.md`.
 */

const SHOW_ALL_KEY = (projectId: string) => `horizontal:map-all:${projectId}`
const readShowAll = (projectId: string | undefined): boolean => {
  if (!projectId) return false
  try { return localStorage.getItem(SHOW_ALL_KEY(projectId)) === '1' } catch { return false }
}

/** Grupurile din „Fără legături" mai lungi de atât pornesc strânse. */
const LOOSE_OPEN_MAX = 8

type Sel = { branch: string; key: string; hover?: boolean } | null

export function MapView() {
  const { project, issues, obstacles, obstacleLinks, themes, blockedByObstacle } = useHorizontal()
  const { openIssue, pushSheet } = useUI()
  const narrow = useNarrow()
  const projectId = project?.id

  const [showAll, setShowAllState] = useState(() => readShowAll(projectId))
  const [shownFor, setShownFor] = useState(projectId)
  if (shownFor !== projectId) { setShownFor(projectId); setShowAllState(readShowAll(projectId)) }
  const [sel, setSel] = useState<Sel>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // ── Datele: tichete + obstacole ca noduri, cu predecesorii lor ──────────
  const openObst = useMemo(() => openObstacles(obstacles), [obstacles])
  const byIssue = useMemo(() => indexById(issues), [issues])
  const { items, byId } = useMemo(() => {
    const linksTo: Record<string, string[]> = {}
    for (const l of obstacleLinks) (linksTo[l.issueId] ??= []).push(l.obstacleId)
    const items: MapItem[] = [
      ...issues.map((i): MapItem => ({ id: i.id, kind: 'issue', closed: i.done, deps: [...(i.deps ?? []), ...(linksTo[i.id] ?? [])] })),
      ...obstacles.map((o): MapItem => ({ id: o.id, kind: 'obstacle', closed: !openObst.has(o.id), deps: o.deps ?? [] })),
    ]
    return { items, byId: Object.fromEntries(items.map((it) => [it.id, it])) }
  }, [issues, obstacles, obstacleLinks, openObst])
  const split = useMemo(() => splitBranches(items), [items])
  const obstById = useMemo(() => Object.fromEntries(obstacles.map((o) => [o.id, o])), [obstacles])

  // ── Mărimile: măsurate pe un nod-probă, ca să urmeze fontul și mărimea textului ──
  const probe = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ nodeH: 64, rootW: 52, rootH: 28 })
  useLayoutEffect(() => {
    const el = probe.current
    if (!el) return
    const measure = () => {
      const node = el.querySelector<HTMLElement>('.bm-node')!
      const root = el.querySelector<HTMLElement>('.bm-root')!
      const next = { nodeH: Math.ceil(node.offsetHeight), rootW: Math.ceil(root.offsetWidth), rootH: Math.ceil(root.offsetHeight) }
      setDims((d) => (d.nodeH === next.nodeH && d.rootW === next.rootW && d.rootH === next.rootH ? d : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const nodeW = narrow ? 260 : 240
  const gap = narrow ? 56 : 72

  const shown: Branch[] = useMemo(() => (showAll ? [...split.active, ...split.finished] : split.active), [split, showAll])
  const drawn = useMemo(() => {
    const out = new Map<string, { g: BranchGraph; L: BranchLayout }>()
    for (const b of shown) {
      const g = branchGraph(b, byId, showAll)
      out.set(b.rootId, { g, L: layoutBranch(g, { nodeW, nodeH: dims.nodeH, gap, vgap: 14, rootW: dims.rootW, rootH: dims.rootH }) })
    }
    return out
  }, [shown, byId, showAll, nodeW, gap, dims])

  // ── „Arată și închise": deschisele rămân pe loc, istoria apare în stânga ──
  const wrap = useRef<HTMLDivElement>(null)
  const flip = useRef<{ rects: Map<string, DOMRect>; roots: Map<string, DOMRect>; anchors: Map<string, { key: string; left: number }> } | null>(null)
  const setShowAll = (v: boolean) => {
    const root = wrap.current
    if (root) {
      const rects = new Map<string, DOMRect>(), roots = new Map<string, DOMRect>(), anchors = new Map<string, { key: string; left: number }>()
      root.querySelectorAll<HTMLElement>('[data-bm-key]').forEach((n) => {
        const b = n.closest<HTMLElement>('[data-branch]')!.dataset.branch!
        const r = n.getBoundingClientRect()
        rects.set(`${b}|${n.dataset.bmKey}`, r)
        if (n.dataset.bmKey === ROOT) roots.set(b, r)
        else if (!anchors.has(b) && !n.classList.contains('done')) anchors.set(b, { key: n.dataset.bmKey!, left: r.left })
      })
      flip.current = { rects, roots, anchors }
    }
    setSel(null)
    setShowAllState(v)
    if (projectId) try { localStorage.setItem(SHOW_ALL_KEY(projectId), v ? '1' : '0') } catch { /* doar comoditate */ }
  }
  useLayoutEffect(() => {
    const f = flip.current
    const root = wrap.current
    flip.current = null
    if (!f || !root) return
    root.querySelectorAll<HTMLElement>('[data-branch]').forEach((br) => {
      const a = f.anchors.get(br.dataset.branch!)
      const band = br.querySelector<HTMLElement>('.bm-band')
      const n = a && br.querySelector<HTMLElement>(`[data-bm-key="${CSS.escape(a.key)}"]`)
      if (band && n) band.scrollLeft += n.getBoundingClientRect().left - a.left
      band?.classList.toggle('cut-l', band.scrollLeft > 4)
    })
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    root.querySelectorAll<HTMLElement>('[data-bm-key]').forEach((n) => {
      const b = n.closest<HTMLElement>('[data-branch]')!.dataset.branch!
      const old = f.rects.get(`${b}|${n.dataset.bmKey}`)
      const from = old ?? f.roots.get(b)
      if (!from) return
      const now = n.getBoundingClientRect()
      const dx = from.left - now.left, dy = from.top - now.top
      n.animate(old
        ? [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }]
        : [{ transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 240, easing: 'ease-out' })
    })
    root.querySelectorAll('.bm-edges').forEach((s) => s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }))
  }, [showAll])

  // ── Gesturile ─────────────────────────────────────────────────────────
  const open = (key: string) => {
    if (byId[key]?.kind === 'obstacle') pushSheet({ kind: 'obstacle-form', obstacleId: key })
    else openIssue(key)
  }
  const tapNode = (branch: string, key: string, el: HTMLElement) => {
    if (key === ROOT) { setShowAll(true); return }
    // Pe desktop clicul deschide direct (panoul lateral); lanțul rămâne aprins.
    if (!narrow) { setSel({ branch, key }); open(key); return }
    // Pe telefon prima atingere alege și aprinde lanțul; a doua deschide.
    if (sel && !sel.hover && sel.branch === branch && sel.key === key) { open(key); return }
    setSel({ branch, key })
    // Centrat și pe orizontală (banda), și pe verticală (pagina): altfel un
    // tichet de jos ajunge sub bara de selecție.
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center', inline: 'center' })
  }
  const lit = useMemo(() => {
    if (!sel) return null
    const d = drawn.get(sel.branch)
    return d ? { ...sel, l: lineage(d.g.edges, sel.key) } : null
  }, [sel, drawn])

  const markScroll = (e: React.UIEvent<HTMLElement>) => {
    const band = e.currentTarget
    band.classList.toggle('cut-l', band.scrollLeft > 4)
  }

  // ── „Fără legături", pe teme ───────────────────────────────────────────
  const looseGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const id of split.loose) {
      const it = byId[id]
      if (it.closed && !showAll) continue
      const k = it.kind === 'obstacle' ? '@obstacle' : (byIssue[id]?.theme || '')
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(id)
    }
    for (const ids of groups.values()) ids.sort((a, b) => Number(byId[a].closed) - Number(byId[b].closed))
    // Temele în ordinea proiectului, apoi „Fără temă", apoi obstacolele.
    const rank = (k: string) => k === '@obstacle' ? 1e6 : k === '' ? 1e5 : themes.findIndex((t) => t.key === k)
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [split, byId, byIssue, showAll, themes])

  if (items.length === 0) {
    return <div className="panel"><p className="empty">Nimic de afișat pe hartă. Adaugă un tichet sau un obstacol.</p></div>
  }

  const looseOpen = split.loose.filter((id) => !byId[id].closed).length
  const pc = project?.accent ? ({ ['--pc' as string]: project.accent }) : undefined
  const selected = sel && !sel.hover ? sel : null
  const selItem = selected ? byId[selected.key] : null

  const nodeClass = (key: string): string => {
    const it = byId[key]
    if (it.kind === 'obstacle') {
      const o = obstById[key]
      return `bm-node obst${it.closed ? ' done' : o?.blocking ? ' blocking' : ''}${o?.bypass ? ' bypass' : ''}`
    }
    if (it.closed) return 'bm-node done'
    const i = byIssue[key]
    const blocked = (i && deriveState(i, byIssue) === 'blocked') || (blockedByObstacle[key]?.length ?? 0) > 0
    return `bm-node${blocked ? ' blocked' : ''}`
  }
  const nodeTitle = (key: string) => byIssue[key]?.title ?? obstById[key]?.title ?? key
  const nodeLabel = (key: string) => byId[key].kind === 'obstacle' ? (obstById[key]?.owner ? `obstacol · ${obstById[key].owner}` : 'obstacol') : displayIssueId(key)
  const waitsOf = (key: string): string[] => {
    const i = byIssue[key]
    if (!i || i.done) return []
    return [
      ...(i.deps ?? []).filter((d) => byIssue[d] && !byIssue[d].done).map(displayIssueId),
      ...(blockedByObstacle[key] ?? []).map((o) => obstById[o]?.title ?? 'un obstacol'),
    ]
  }

  return (
    <div className={`bm${lit ? ' lit' : ''}`} ref={wrap} style={pc} onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
      <div className="bm-bar">
        <span className="bm-sum">
          {split.active.length} {split.active.length === 1 ? 'ramură' : 'ramuri'} în lucru · {looseOpen} fără legături
          {showAll && split.finished.length > 0 && ` · ${split.finished.length} ${split.finished.length === 1 ? 'terminată' : 'terminate'}`}
        </span>
        <button type="button" className={`chip bm-toggle${showAll ? ' on' : ''}`} aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
          <Icon name={showAll ? 'check' : 'show'} size={14} />Arată și închise
        </button>
      </div>

      {split.active.length === 0 && !showAll && (
        <p className="bm-empty">Nicio ramură în lucru: tot ce are legături e închis. „Arată și închise" aduce istoria înapoi.</p>
      )}

      {shown.map((b, i) => {
        const d = drawn.get(b.rootId)
        if (!d) return null
        const { g, L } = d
        const inBranch = lit?.branch === b.rootId
        const keep = (key: string) => !lit || (inBranch && (key === lit.key || lit.l.up.has(key) || lit.l.down.has(key)))
        return (
          <section key={b.rootId} className="bm-branch" data-branch={b.rootId}>
            {showAll && i === split.active.length && <h3 className="bm-sect">Ramuri terminate · {split.finished.length}</h3>}
            <div className="bm-head">
              <span className="bm-hid">{nodeLabel(b.rootId)}</span>
              <span className="bm-ht">{nodeTitle(b.rootId)}</span>
              <span className="bm-hn">· {b.open ? `${b.open} ${b.open === 1 ? 'deschis' : 'deschise'} din ${b.ids.length}` : `toate ${b.ids.length} închise`}</span>
            </div>
            <div className="bm-band" onScroll={markScroll} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setSel(null) }}>
              <div className="bm-canvas" style={{ width: L.width, height: L.height }}>
                <svg className="bm-edges" width={L.width} height={L.height} aria-hidden="true">
                  {L.paths.map((p) => {
                    const hot = inBranch && lit ? edgeOnLineage(p.from, p.to, lit.key, lit.l) : false
                    const src = byId[p.from]
                    const blk = src?.kind === 'obstacle' && !src.closed && obstById[p.from]?.blocking
                    return <path key={`${p.from}>${p.to}`} d={p.d} className={`bm-edge${blk ? ' blk' : ''}${hot ? ' hot' : lit ? ' dim' : ''}`} />
                  })}
                </svg>
                {g.nodes.map((n) => {
                  const box = L.boxes[n.key]
                  if (!box) return null
                  const dim = !keep(n.key)
                  const isSel = selected?.branch === b.rootId && selected.key === n.key
                  if (n.kind === 'root') {
                    return (
                      <button key={ROOT} type="button" data-bm-key={ROOT} className={`bm-root${dim ? ' dim' : ''}`}
                        style={{ left: box.x, top: box.y }} title={`Arată cele ${n.count} închise de dinainte`}
                        onClick={(e) => tapNode(b.rootId, ROOT, e.currentTarget)}>
                        <Icon name="check" size={12} /><b>{n.count}</b>
                      </button>
                    )
                  }
                  return (
                    <button key={n.key} type="button" data-bm-key={n.key}
                      className={`${nodeClass(n.key)}${dim ? ' dim' : ''}${isSel ? ' sel' : ''}`}
                      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                      onClick={(e) => tapNode(b.rootId, n.key, e.currentTarget)}
                      onMouseEnter={narrow ? undefined : () => setSel((s) => (s && !s.hover ? s : { branch: b.rootId, key: n.key, hover: true }))}
                      onMouseLeave={narrow ? undefined : () => setSel((s) => (s?.hover ? null : s))}>
                      {byId[n.key].kind === 'obstacle'
                        ? <span className="bm-ic"><Icon name="obstacle" size={14} /></span>
                        : <span className={`ck${byId[n.key].closed ? ' on' : ''}`}>{byId[n.key].closed && <Icon name="check" size={12} />}</span>}
                      <span className="bm-id">{nodeLabel(n.key)}</span>
                      <span className="bm-t">{nodeTitle(n.key)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
        )
      })}

      {looseGroups.length > 0 && (
        <section className={`bm-loose${lit ? ' dim' : ''}`}>
          <h3 className="bm-sect">Fără legături · {looseGroups.reduce((s, [, ids]) => s + ids.length, 0)}</h3>
          {looseGroups.map(([k, ids]) => {
            const theme = themes.find((t) => t.key === k)
            const name = k === '@obstacle' ? 'Obstacole' : theme?.name ?? (k ? k : 'Fără temă')
            const isOpen = openGroups[k] ?? ids.length <= LOOSE_OPEN_MAX
            return (
              <div key={k || '@none'} className="bm-grp">
                <button type="button" className="bm-grp-h" aria-expanded={isOpen} onClick={() => setOpenGroups((g) => ({ ...g, [k]: !isOpen }))}>
                  <span className="bm-dot" style={theme ? { background: theme.color } : undefined} />
                  {name}<span className="bm-n">{ids.length}</span>
                  <span className={`bm-chev${isOpen ? ' open' : ''}`}><Icon name="expand" size={14} /></span>
                </button>
                {isOpen && ids.map((id) => (
                  <button key={id} type="button" className={`bm-row${byId[id].closed ? ' done' : ''}`} onClick={() => open(id)}>
                    {byId[id].kind === 'obstacle'
                      ? <span className="bm-ic"><Icon name="obstacle" size={14} /></span>
                      : <span className={`ck${byId[id].closed ? ' on' : ''}`}>{byId[id].closed && <Icon name="check" size={12} />}</span>}
                    <span className="bm-t">{nodeTitle(id)}</span>
                    {byId[id].kind === 'issue' && <span className="bm-id">{displayIssueId(id)}</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </section>
      )}

      {narrow && selected && selItem && (
        <div className="bm-selbar" role="status">
          <span className="bm-id">{nodeLabel(selected.key)}{waitsOf(selected.key).length > 0 && ` · așteaptă ${waitsOf(selected.key).join(', ')}`}</span>
          <span className="bm-t">{nodeTitle(selected.key)}</span>
          <button type="button" onClick={() => open(selected.key)}>Deschide</button>
        </div>
      )}

      {/* Proba de mărime: un nod cu titlul pe două rânduri și o rădăcină. */}
      <div className="bm-probe" ref={probe} aria-hidden="true">
        <span className="bm-node" style={{ width: nodeW }}><span className="ck" /><span className="bm-id">H-00</span><span className="bm-t">Măsurătoare pe două rânduri, destul de lungă cât să se rupă</span></span>
        <span className="bm-root"><Icon name="check" size={12} /><b>888</b></span>
      </div>
    </div>
  )
}
