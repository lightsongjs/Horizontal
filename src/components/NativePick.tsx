import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { NativeKind } from '../lib/nativePicker'

interface Props {
  type: NativeKind
  /** Eticheta controlului (o poartă inputul, nu cutia). */
  label: string
  /** Valoarea cu care se deschide selectorul, citită la atingere (nu la randare). */
  initial(): string
  /** Valoarea aleasă (`YYYY-MM-DD` / `HH:MM`). Anularea nu cheamă nimic. */
  onPick(value: string): void
  className?: string
  tabIndex?: number
  children: ReactNode
}

/**
 * Un buton care deschide calendarul / ceasul SISTEMULUI: înăuntru stă un
 * `<input type="date|time">` adevărat, transparent, întins peste toată cutia —
 * deci atingerea omului cade direct pe input, iar browserul deschide selectorul
 * pe drumul lui obișnuit, cel pe care îl folosesc și câmpurile vizibile din
 * foaia de tichet. Fără `showPicker()`: vezi `lib/nativePicker.ts` pentru de ce.
 *
 * Inputul rămâne montat cât trăiește butonul, deci `change` nu se poate pierde
 * pe drum (o bandă care se închide nu-l demontează: banda doar se ascunde).
 */
export function NativePick({ type, label, initial, onPick, className = '', tabIndex, children }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const pick = useRef(onPick)
  pick.current = onPick

  // `change` nativ, nu `onChange` din React: acela ascultă și `input`, care pe
  // desktop vine la fiecare segment tastat (zi, lună…) — o scriere pe segment.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => {
      const v = el.value
      el.blur()
      if (v) pick.current(v)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])

  // Valoarea de acum a sarcinii, pusă chiar înainte de deschidere: selectorul
  // pornește de la ea, iar o alegere identică nu e o schimbare (fără `change`).
  const prime = () => { if (ref.current) ref.current.value = initial() }

  // Tastatura (desktop): Enter / Space deschid selectorul. Aici `showPicker()`
  // e în regulă — e un gest de tastatură pe desktop, nu drumul atingerii de pe
  // telefon. Restul tastelor care ar edita inputul sunt oprite: e transparent,
  // deci segmentele schimbate cu săgeți sau cifre n-ar fi văzute de nimeni.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      prime()
      try { ref.current?.showPicker?.() } catch { /* fără selector: rămâne atingerea */ }
      return
    }
    if (e.key.length === 1 || /^(Arrow|Backspace|Delete|Page|Home|End)/.test(e.key)) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
    }
  }

  return (
    <span className={`native-pick ${className}`} data-pick={type}>
      {children}
      <input
        ref={ref}
        type={type}
        className="native-pick-input"
        aria-label={label}
        tabIndex={tabIndex}
        onPointerDown={prime}
        onFocus={prime}
        onKeyDown={onKeyDown}
      />
    </span>
  )
}
