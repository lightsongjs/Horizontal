import { useRef, useState } from 'react'
import { dragShift, dropIndex } from '../lib/pins'

interface Drag {
  key: string
  from: number
  to: number
  /** Coordonata (pe axa tragerii) de unde a pornit. */
  start: number
  /** Cât s-a tras de atunci. */
  d: number
  /** Mijloacele elementelor la începutul tragerii — ținta se calculează pe ele. */
  mids: number[]
  /** Pasul dintre două elemente (mărime + spațiu). */
  step: number
}

/**
 * Tragerea care reordonează o listă scurtă pe o axă: fixatele din bara
 * laterală (verticală, mouse) și pătratele din sertar (orizontală, deget).
 * Tiparul din `WaveManager` / `PinnedRows`: celelalte elemente își fac loc cu
 * `transform`, ordinea reală se schimbă abia la eliberare (`onDrop`) — o
 * mutare de nod în timpul tragerii ar pierde pointerul.
 *
 * Numai starea și geometria; cine pornește tragerea (mouse după un prag,
 * deget după o apăsare lungă) e treaba componentei.
 */
export function useReorderDrag(keys: readonly string[], axis: 'x' | 'y', onDrop: (key: string, to: number) => void) {
  const els = useRef(new Map<string, HTMLElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  // Oglinda sincronă: o eliberare imediat după o mișcare nu așteaptă randarea.
  const cur = useRef<Drag | null>(null)
  const set = (d: Drag | null) => { cur.current = d; setDrag(d) }

  const begin = (key: string, at: number): boolean => {
    const from = keys.indexOf(key)
    const rects = keys.map((k) => els.current.get(k)?.getBoundingClientRect())
    if (from < 0 || rects.some((r) => !r)) return false
    const rs = rects as DOMRect[]
    const lo = (r: DOMRect) => (axis === 'x' ? r.left : r.top)
    const size = (r: DOMRect) => (axis === 'x' ? r.width : r.height)
    const step = rs.length > 1 ? lo(rs[1]) - lo(rs[0]) : size(rs[0])
    set({ key, from, to: from, start: at, d: 0, mids: rs.map((r) => lo(r) + size(r) / 2), step })
    return true
  }
  const track = (at: number) => {
    const g = cur.current
    if (!g) return
    const d = at - g.start
    set({ ...g, d, to: dropIndex(g.mids, g.from, g.mids[g.from] + d) })
  }
  const end = (commit: boolean) => {
    const g = cur.current
    set(null)
    if (commit && g && g.to !== g.from) onDrop(g.key, g.to)
  }

  /** `transform` pentru elementul `key`: urmează pointerul, sau își face loc. */
  const offset = (key: string): string | undefined => {
    if (!drag) return undefined
    const j = keys.indexOf(key)
    const v = key === drag.key ? drag.d : dragShift(j, drag.from, drag.to, drag.step)
    return v ? `translate${axis.toUpperCase()}(${v}px)` : undefined
  }
  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el)
    else els.current.delete(key)
  }

  return { drag, active: () => cur.current !== null, begin, track, end, offset, ref, el: (key: string) => els.current.get(key) }
}
