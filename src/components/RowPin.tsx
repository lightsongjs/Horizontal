import { useEffect } from 'react'
import { shouldIgnoreKey } from '../hooks'
import { useUI } from '../ui'
import { Icon } from './Icon'
import { useTaskActions } from './TaskActions'

/**
 * Piuneza din coada unui rând, pe desktop (`TaskRow` și „Listă"). Pe un rând
 * nefixat e invizibilă până treci cu mouse-ul (sau până rândul are focusul de
 * tastatură), dar își ține locul — rândul nu sare și titlul nu se taie la
 * hover. Pe un rând fixat stă mereu, în accent.
 *
 * `span role="button"`, nu `<button>`: rândul e deja un buton, iar un buton în
 * buton nu e HTML valid (același tipar ca bifa, `.list-check`). `mousedown`
 * prevenit: un click nu mută focusul pe rând. Fără `(hover: hover)` CSS-ul o
 * lasă doar pe rândurile fixate, ca semn (vezi `.row-pin` în styles.css).
 */
export function RowPin({ pinned, onToggle }: { pinned: boolean; onToggle(): void }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      className={`t-pin row-pin${pinned ? ' on' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? 'Scoate de sus' : 'Fixează sus'}
      title={pinned ? 'Fixat sus în „Azi" — scoate (F)' : 'Fixează sus în „Azi" (F)'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >
      <Icon name="pin" size={13} />
    </span>
  )
}

/** Semnul static de pe un rând fixat, unde piuneza nu e un buton (telefon, doar-citire, selecție). */
export function PinMark() {
  return <span className="t-pin" title="Fixat sus"><Icon name="pin" size={13} /></span>
}

/**
 * Tasta F pe un RÂND (fără tichet deschis): rândul cu focusul de tastatură
 * (Tab) sau, în „Listă", cel ales cu H J K L (`focusedId`). Cu un tichet
 * deschis — docat sau modal — F e a formularului (`IssueForm`), care fixează
 * tichetul acela; de-aia aici orice foaie deschisă oprește tasta.
 */
export function useRowPinKey(focusedId: string | null = null) {
  const ta = useTaskActions()
  const { sheet } = useUI()
  const busy = sheet.kind !== 'none'
  const { issuesOf, run } = ta
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return
      if (shouldIgnoreKey(e, busy)) return
      const active = (document.activeElement as HTMLElement | null)?.closest?.('[data-issue-id]')
      const id = active?.getAttribute('data-issue-id') ?? focusedId
      if (!id) return
      const [issue] = issuesOf([id])
      if (!issue) return
      e.preventDefault()
      void run({ kind: 'pin', value: !issue.pinnedAt }, [id])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, focusedId, issuesOf, run])
}
