import { useEffect, useRef, type ReactNode } from 'react'
import { useUI } from '../ui'
import { useMediaQuery } from '../hooks'
import { IssueForm } from './IssueForm'
import { Icon } from './Icon'

/**
 * Sub atât, cele două coloane se strâng amândouă până nu mai e nici listă
 * lizibilă, nici formular utilizabil. Layoutul de desktop (bară laterală +
 * conținut) pornește la 900px; aici mai trebuie loc pentru încă o coloană de
 * formular pe lângă el, deci pragul e mai sus.
 */
const SPLIT_QUERY = '(min-width: 1200px)'

/**
 * Lista în stânga, tichetul deschis în dreapta.
 *
 * Nu decide nimeni „deschide în panou": vizualizarea doar se anunță ca gazdă
 * posibilă, iar `ui.tsx` alege la randare între panou și modal (vezi
 * `dockedIssueId`). Pe ecran îngust componenta e transparentă — randează lista
 * și atât, iar formularul se întoarce în foaia de jos.
 */
export function SplitView({ children }: { children: ReactNode }) {
  const wide = useMediaQuery(SPLIT_QUERY)
  const { registerSplitHost, dockedIssueId, closeSheet } = useUI()
  const paneRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!wide) return
    return registerSplitHost()
  }, [wide, registerSplitHost])

  useEffect(() => {
    if (!dockedIssueId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape închide panoul doar dacă ești ÎN el. În listă, Escape are deja
      // trei treburi (iese din navigarea vim, din selecție, din arbore) — un
      // panou care dispare la fiecare Escape ar fi însemnat pierderea
      // contextului exact când încerci să te întorci la el.
      if (!paneRef.current?.contains(document.activeElement)) return
      e.preventDefault()
      closeSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dockedIssueId, closeSheet])

  if (!wide) return <>{children}</>

  return (
    <div className="split">
      <div className="split-list">{children}</div>
      <aside className="split-pane" ref={paneRef} aria-label="Tichetul deschis">
        {dockedIssueId ? (
          <IssueForm key={dockedIssueId} issueId={dockedIssueId} docked />
        ) : (
          <div className="split-empty">
            <Icon name="edit" size={22} />
            <p>Alege un tichet din listă ca să-l editezi aici.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
