import { useEffect, useRef, type ReactNode } from 'react'
import { useUI } from '../ui'
import { useHorizontal } from '../store'
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
  const { registerSplitHost, dockedIssueId, dockedKeyId, closeSheet } = useUI()
  const { byId } = useHorizontal()
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
          /* Cheia poartă și scadența, nu doar id-ul. Formularul își citește
             câmpurile o singură dată, la montare; o scadență care se schimbă
             de la SERVER (o sarcină recurentă bifată din listă sare la
             apariția următoare) lăsa panoul pe data veche. Trei lucruri
             deodată din asta: panoul mințea, formularul se raporta „nesalvat"
             deși omul nu-l atinsese (deci prima atingere pe alt rând era
             înghițită de gardă), iar Salvează — exact ce-l îndemna nudge-ul —
             scria data VECHE înapoi, anulând tăcut saltul.

             Cheie, nu un efect de sincronizare: aici formularul oricum se
             REMONTEAZĂ, nu se mută (vezi nota despre pragul de 1200px din
             CLAUDE.md), deci remontarea e mecanismul pe care codul ăsta îl
             folosește deja peste tot. Un efect ar fi trebuit să știe singur ce
             câmpuri are voie să suprascrie și care sunt tocmai editate.
             Prețul, asumat: după o salvare din panou care schimbă scadența,
             formularul se remontează cu aceleași valori — se pierde poziția
             derulării, nu date.

             Prima parte e `dockedKeyId`, nu ID-ul: un tichet creat offline
             care primește numărul real NU se remontează (vezi `sheetKey`). */
          <IssueForm
            key={`${dockedKeyId}:${byId[dockedIssueId]?.dueAt ?? ''}`}
            issueId={dockedIssueId}
            docked
          />
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
