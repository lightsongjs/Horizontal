// Toast tranzitoriu, fără dependențe. Deținătorul păstrează mesajul în state și
// îl golește în onDone.

import { useEffect } from 'react'

const DURATION = 2600

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const id = setTimeout(onDone, DURATION)
    return () => clearTimeout(id)
  }, [message, onDone])

  return (
    <div className={`toast ${message ? 'on' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  )
}
