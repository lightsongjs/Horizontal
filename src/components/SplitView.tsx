import { useEffect, useRef, type ReactNode } from 'react'
import type { Issue } from '../lib/types'
import { useUI } from '../ui'
import { useHorizontal } from '../store'
import { useWide } from '../hooks'
import { IssueForm } from './IssueForm'
import { Icon } from './Icon'
import { useVimOptional } from '../vim'

/**
 * Sub atât, cele două coloane se strâng amândouă până nu mai e nici listă
 * lizibilă, nici formular utilizabil. Layoutul de desktop (bară laterală +
 * conținut) pornește la 900px; aici mai trebuie loc pentru încă o coloană de
 * formular pe lângă el, deci pragul e mai sus.
 */
// Pragul (1200px) e `WIDE_QUERY` din `lib/narrow.ts`: `<html data-wide>`, ca un
// panou al panoului dublu să-l treacă la orice lățime („lista SAU tichetul").

/**
 * Lista în stânga, tichetul deschis în dreapta.
 *
 * Nu decide nimeni „deschide în panou": vizualizarea doar se anunță ca gazdă
 * posibilă, iar `ui.tsx` alege la randare între panou și modal (vezi
 * `dockedIssueId`). Pe ecran îngust componenta e transparentă — randează lista
 * și atât, iar formularul se întoarce în foaia de jos.
 */
export function SplitView({ children }: { children: ReactNode }) {
  const wide = useWide()
  const { registerSplitHost, dockedIssueId, dockedKeyId, closeSheet, isDockedDirty } = useUI()
  const { byId } = useHorizontal()
  const paneRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!wide) return
    return registerSplitHost()
  }, [wide, registerSplitHost])

  // Orice listă cu panou e și o listă plată pentru cursorul modului Vim
  // („Listă", „Azi", „7 zile", filtrele, „Ale mele"), la orice lățime:
  // rândurile le citește dispecerul din DOM, în ordinea desenării.
  const { registerCursorHost } = useVimOptional()
  useEffect(() => registerCursorHost(), [registerCursorHost])

  useEffect(() => {
    if (!dockedIssueId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Cu modul Vim pornit, Escape-ul e al scării din `src/vim.tsx`, care îl
      // oprește înainte să ajungă aici. Rămâne pentru modul oprit.
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

  /*
   * O scriere din AFARA formularului pe tichetul docat (din listă: `!`, `t`,
   * `D` din modul Vim, meniul de click dreapta; alt dispozitiv) — formularul
   * își copiază câmpurile la montare, deci ar fi rămas pe valoarea veche, s-ar
   * fi crezut „nesalvat", iar Salvează ar fi scris valoarea veche înapoi.
   * Același leac ca `dueAt` din cheie: o remontare, dar NUMAI cu formularul
   * curat — murdar, remontarea ar arunca ce scrii (iar dispecerul oricum
   * refuză acolo acțiunile pe rând). Amprenta se mută și când e murdar (după
   * propria salvare, store-ul vine cu valorile lui), ca o salvare să nu
   * remonteze. Se citește la randare: atunci starea murdară e încă cea de
   * dinaintea scrierii, deci o scriere din afară nu se poate deghiza în editare.
   */
  const remount = useRef<{ id: string | null; fp: string; gen: number }>({ id: null, fp: '', gen: 0 })
  const docked = dockedIssueId ? byId[dockedIssueId] : undefined
  if (docked) {
    const fp = formPrint(docked)
    const r = remount.current
    if (r.id !== docked.id) remount.current = { id: docked.id, fp, gen: 0 }
    else if (r.fp !== fp) remount.current = { id: r.id, fp, gen: isDockedDirty() ? r.gen : r.gen + 1 }
  }

  if (!wide) return <>{children}</>

  // Panoul apare doar cu un tichet deschis (decizia omului, 2026-10-14): gol,
  // ocupa jumătate din ecran și strângea lista (și banda de valuri) degeaba.
  // `<aside>` rămâne în DOM, doar ascuns — lista nu se remontează la deschidere.
  return (
    <div className={`split${dockedIssueId ? ' has-pane' : ''}`}>
      <div className="split-list">{children}</div>
      <aside className="split-pane" ref={paneRef} aria-label="Tichetul deschis" hidden={!dockedIssueId} tabIndex={-1}>
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
          // Formularul își citește câmpurile o singură dată, la montare. Montat
          // înainte să sosească tichetul (proiectul lui încă se încarcă — un
          // tichet deschis dintr-un filtru), pornea gol și rămânea gol: titlul
          // apărea ca „MS-256", iar o salvare ar fi creat alt tichet.
          byId[dockedIssueId] ? (
            <IssueForm
              key={`${dockedKeyId}:${byId[dockedIssueId]?.dueAt ?? ''}:${remount.current.gen}`}
              issueId={dockedIssueId}
              docked
            />
          ) : (
            <div className="split-empty"><p>Se încarcă tichetul…</p></div>
          )
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

/** Câmpurile pe care formularul le copiază la montare (vezi remontarea din `SplitView`). */
function formPrint(i: Issue): string {
  return JSON.stringify([i.title, i.desc, i.theme, i.wave, i.assigneeId, i.deps, i.urgent, i.dueAt, i.allDay, i.remindAt, i.rrule])
}
