// Toast tranzitoriu, fără dependențe. Deținătorul păstrează mesajul în state și
// îl golește în onDone.

import { useEffect } from 'react'

const DURATION = 2600
/** Cu o acțiune, mesajul trebuie să apuce să fie CITIT și apăsat. */
const DURATION_ACTION = 6000

export function Toast({
  message,
  onDone,
  action,
  duration,
}: {
  message: string | null
  onDone: () => void
  action?: { label: string; onClick: () => void }
  /** Altă durată decât cea implicită (anularea din listă: 5s, din spec). */
  duration?: number
}) {
  // Depinde de PREZENȚA unei acțiuni (`hasAction`), nu de identitatea lui
  // `action`: obiectul e reconstruit la fiecare randare a părintelui (un
  // literal `{ label, onClick }` scris direct în JSX — vezi App.tsx). Dacă ar
  // fi în lista de dependențe, orice randare NELEGATĂ de toast (un refresh în
  // fundal, un tab schimbat) ar reporni cronometrul de la zero — exact
  // fereastra de 6s care face ANULEAZĂ ajungibil ar deveni nedeterminată.
  const hasAction = !!action
  useEffect(() => {
    if (!message) return
    const id = setTimeout(onDone, duration ?? (hasAction ? DURATION_ACTION : DURATION))
    return () => clearTimeout(id)
  }, [message, onDone, hasAction, duration])

  return (
    <div className={`toast ${message ? 'on' : ''}`} role="status" aria-live="polite">
      {message}
      {message && action && (
        <button type="button" className="toast-act" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
