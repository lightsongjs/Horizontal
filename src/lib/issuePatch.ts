// Aplicarea unui patch pe un tichet, cu oglinda trigger-ului de recurență.
//
// De ce aici și nu în `localRepository`: și coada offline trebuie să arate
// saltul imediat, înainte să răspundă serverul. Două copii ale regulii ar
// diverge la prima corectură; o funcție, două apelanți. Legea rămâne
// `issues_zz_advance_recurrence` din `supabase/migration-recurrence.sql` —
// asta doar o repetă în TS, pentru afișare.

import { nextOccurrence } from './recurrence'
import type { Issue } from './types'

export function applyIssuePatch(issue: Issue, patch: Partial<Issue>, now: Date): Issue {
  // `wasDone` e citit ÎNAINTE de aplicare: trigger-ul verifică o TRANZIȚIE
  // (`new.done and not old.done`), nu doar valoarea din patch. Un
  // `{ done: true }` pe un tichet deja bifat n-are voie să sară a doua oară.
  const wasDone = issue.done
  const out: Issue = { ...issue, ...patch }
  if (!wasDone && patch.done === true && out.rrule && out.dueAt) {
    const nxt = nextOccurrence(out.rrule, now, out.dueAt)
    if (nxt) {
      // Perechea din starea FINALĂ a patch-ului — ca `new.due_at - new.remind_at`
      // din trigger, nu `old.due_at`.
      Object.assign(out, moveDue(out, nxt))
      // Ca `new.snoozed_from := null` din trigger: apariția nouă nu e amânată.
      if (out.snoozedFrom != null) out.snoozedFrom = null
      out.done = false
    }
  }
  return out
}

/**
 * Scadența mutată pe `nextDueAt`, cu mementoul dus după ea: aceeași distanță
 * între memento și scadență, deci un „cu 30 de minute înainte" rămâne „cu 30
 * de minute înainte". E regula triggerului de recurență, folosită și de
 * mutările din listă (glisarea „Mâine", foaia de dată) — un singur loc care
 * decide ce se întâmplă cu mementoul când pleacă scadența.
 *
 * Distanța e cea PLANIFICATĂ: pe o sarcină amânată, `snoozedFrom`, nu ora
 * amânării (ca `coalesce(snoozed_from, remind_at)` din trigger). Altfel
 * amânarea de azi devenea decalajul tuturor aparițiilor (ROUTIN-12, 2026-11-06).
 */
export function moveDue(
  issue: Pick<Issue, 'dueAt' | 'remindAt'> & Partial<Pick<Issue, 'snoozedFrom'>>,
  nextDueAt: string,
): { dueAt: string; remindAt: string | null } {
  const planned = issue.snoozedFrom ?? issue.remindAt
  if (!issue.remindAt || !planned || !issue.dueAt) return { dueAt: nextDueAt, remindAt: issue.remindAt }
  const delta = new Date(issue.dueAt).getTime() - new Date(planned).getTime()
  return { dueAt: nextDueAt, remindAt: new Date(new Date(nextDueAt).getTime() - delta).toISOString() }
}

const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null)

/**
 * O scriere de PLAN (formularul, foaia de dată, „Mâine" din listă) care schimbă
 * mementoul sau scadența golește baza amânării: ora nouă e chiar planul, nu o
 * amânare a lui. Fără asta, o sarcină amânată și apoi reprogramată de mână ar
 * fi sărit la bifă de la planul VECHI.
 *
 * Numai la o SCHIMBARE reală: formularul retrimite `remindAt` la fiecare
 * salvare, iar o virgulă în titlu n-are voie să șteargă baza. Amânările (și
 * anularea unei bife) își scriu singure `snoozedFrom`, deci un patch care îl
 * are deja rămâne neatins. Tichet necunoscut (nu e în cache): golește.
 *
 * Doar pagina trece pe aici. `functions/api` și CLI-ul nu golesc încă — o
 * reprogramare de acolo pe o sarcină amânată sare la bifă de la planul vechi,
 * numai pentru apariția aceea.
 */
export function planPatch(current: Pick<Issue, 'dueAt' | 'remindAt'> | undefined, patch: Partial<Issue>): Partial<Issue> {
  if ('snoozedFrom' in patch) return patch
  const moved = ('remindAt' in patch && (!current || !sameTime(patch.remindAt, current.remindAt)))
    || ('dueAt' in patch && (!current || !sameTime(patch.dueAt, current.dueAt)))
  return moved ? { ...patch, snoozedFrom: null } : patch
}
