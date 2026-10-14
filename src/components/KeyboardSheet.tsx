import { useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { useKeyboardInset } from '../hooks'
import { sheetDismiss } from '../lib/swipe'

interface Props {
  onClose(): void
  label: string
  className?: string
  children: ReactNode
}

/**
 * O foaie lipită de marginea de sus a tastaturii, nu de fundul ecranului.
 *
 * Nu e `.sheet`: aceea stă pe `bottom: 0` și are înălțime de formular, deci cu
 * tastatura deschisă ar sta sub ea (unde WebView-ul nu se micșorează) sau ar
 * acoperi tot ce a rămas vizibil. Aici fundul vine din `--kb`, măsurat de
 * `useKeyboardInset`, iar înălțimea maximă din `--vvh`: foaia crește în sus
 * odată cu textul și, peste ce încape, derulează înăuntru.
 *
 * Fundalul e `.sheet-bg`, cel al foilor obișnuite — lista din spate se vede
 * estompat, ca dovadă că sarcina tocmai trimisă a apărut în ea.
 */
export function KeyboardSheet({ onClose, label, className = '', children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useKeyboardInset(ref)
  // Mânerul de sus: trage foaia în jos ca s-o închizi. Numai mânerul, nu tot
  // conținutul — acolo degetul derulează descrierea sau scrie în ea.
  const start = useRef<{ y: number; t: number } | null>(null)
  const [dy, setDy] = useState(0)
  const onStart = (e: TouchEvent) => { start.current = { y: e.touches[0].clientY, t: e.timeStamp } }
  const onMove = (e: TouchEvent) => {
    if (start.current) setDy(Math.max(0, e.touches[0].clientY - start.current.y))
  }
  const onEnd = (e: TouchEvent) => {
    const s = start.current
    start.current = null
    if (s && sheetDismiss(dy, e.timeStamp - s.t)) onClose()
    else setDy(0)
  }
  return (
    <>
      <div className="sheet-bg on" onClick={onClose} />
      <div
        ref={ref}
        className={`kb-sheet ${className}${dy ? ' dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div className="kb-grab" aria-hidden="true" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd} />
        {children}
      </div>
    </>
  )
}
