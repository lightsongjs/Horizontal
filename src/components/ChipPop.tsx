import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * Popoverul unui jeton din rândul formularului (data, valul, „+", tema,
 * persoana, agrafa). O singură cochilie, ca toate să se închidă la fel:
 *
 * - **Esc** închide DOAR popoverul și pune focusul înapoi pe jeton. Ascultat pe
 *   `window` în faza de CAPTURĂ, cu `stopPropagation` — tiparul din
 *   `Lightbox`: `SheetHost` și `SplitView` au propriul Escape pe `window` (în
 *   bubble), care ar fi închis tot formularul.
 * - O atingere în afara rândului și a popoverului îl închide fără să mute
 *   focusul. Una pe alt jeton din rând nu îl închide aici: jetonul își schimbă
 *   singur popoverul deschis (`openPop` din `IssueForm` e o singură stare).
 * - Pe telefon (`sheet`) e o foaie de jos, randată prin portal în `body`:
 *   `.sheet` are `transform`, iar un ascendent transformat ar fi devenit
 *   containing block pentru `position: fixed` (aceeași capcană ca la vechiul
 *   `RecurrencePicker`).
 * - Pe desktop e ancorat sub rând, aliniat cu jetonul și împins înapoi cât să
 *   nu iasă din rând.
 */
export function ChipPop({
  anchor,
  rowRef,
  sheet,
  role,
  label,
  onClose,
  className = '',
  align = 'start',
  frameRef,
  arrows = 'vertical',
  children,
}: {
  /** Jetonul care l-a deschis: alinierea și întoarcerea focusului. */
  anchor: HTMLElement | null
  rowRef: RefObject<HTMLElement | null>
  sheet: boolean
  role: 'dialog' | 'menu'
  label: string
  onClose(returnFocus: boolean): void
  className?: string
  /** `end`: lipit de marginea dreaptă a rândului (meniul „⋯" de la capătul benzii de valuri). */
  align?: 'start' | 'end'
  /**
   * Cutia față de care se poziționează (implicit `rowRef`). Pastila „Încă N"
   * din banda de valuri stă într-un rând cu `overflow: hidden`: popoverul se
   * agață de bandă (poziționată, în afara tăieturii), iar „în afară" rămâne
   * doar pastila.
   */
  frameRef?: RefObject<HTMLElement | null>
  /** `both`: și ←/→ mută prin meniu (meniul pastilei „Încă N"). */
  arrows?: 'vertical' | 'both'
  children: ReactNode
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  // `onClose` vine nou la fiecare randare a formularului; prin ref, ascultătorii
  // de mai jos nu se reînregistrează la fiecare tastă.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current(true)
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popRef.current?.contains(t) || rowRef.current?.contains(t)) return
      closeRef.current(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [rowRef])

  // Focusul intră în popover: pe primul element din meniu, sau pe ce e marcat
  // `data-autofocus` (presetarea aleasă). Un câmp de text nu-l primește pe
  // telefon — ar ridica tastatura peste foaia abia deschisă.
  useEffect(() => {
    const pop = popRef.current
    if (!pop) return
    const target =
      pop.querySelector<HTMLElement>('[data-autofocus]') ??
      pop.querySelector<HTMLElement>(role === 'menu' ? '[role^="menuitem"]' : 'button, input')
    if (target && !(sheet && target.tagName === 'INPUT')) target.focus({ preventScroll: true })
    // Doar la deschidere — `label` schimbă conținutul, nu deschiderea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  useLayoutEffect(() => {
    if (sheet || align === 'end') return
    const row = (frameRef ?? rowRef).current
    const pop = popRef.current
    if (!row || !pop) return
    const r = row.getBoundingClientRect()
    const a = anchor?.getBoundingClientRect()
    const want = a ? a.left - r.left : 0
    setLeft(Math.max(0, Math.min(want, r.width - pop.offsetWidth)))
  }, [anchor, rowRef, frameRef, sheet, label, align])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const back = e.key === 'ArrowUp' || (arrows === 'both' && e.key === 'ArrowLeft')
    const fwd = e.key === 'ArrowDown' || (arrows === 'both' && e.key === 'ArrowRight')
    if (role !== 'menu' || (!back && !fwd)) return
    const items = Array.from(popRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = fwd ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  const pop = (
    <div
      ref={popRef}
      className={`fc-pop ${sheet ? 'fc-sheet' : ''} ${role === 'menu' ? 'fc-menu' : ''} ${className}`}
      role={role}
      aria-label={label}
      style={sheet ? undefined : align === 'end' ? { right: 0 } : { left }}
      onKeyDown={onKeyDown}
    >
      {sheet && <div className="fc-grab" aria-hidden="true" />}
      {children}
    </div>
  )

  if (!sheet) return pop
  return createPortal(
    <>
      <div className="fc-scrim" onClick={() => closeRef.current(false)} />
      {pop}
    </>,
    document.body,
  )
}
