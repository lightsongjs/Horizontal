import { useRef, type ReactNode } from 'react'
import { useKeyboardInset } from '../hooks'

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
  return (
    <>
      <div className="sheet-bg on" onClick={onClose} />
      <div ref={ref} className={`kb-sheet ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  )
}
