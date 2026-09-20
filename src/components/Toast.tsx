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
}: {
  message: string | null
  onDone: () => void
  action?: { label: string; onClick: () => void }
}) {
  useEffect(() => {
    if (!message) return
    const id = setTimeout(onDone, action ? DURATION_ACTION : DURATION)
    return () => clearTimeout(id)
  }, [message, onDone, action])

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
