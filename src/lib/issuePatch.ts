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
 */
export function moveDue(
  issue: Pick<Issue, 'dueAt' | 'remindAt'>,
  nextDueAt: string,
): { dueAt: string; remindAt: string | null } {
  if (!issue.remindAt || !issue.dueAt) return { dueAt: nextDueAt, remindAt: issue.remindAt }
  const delta = new Date(issue.dueAt).getTime() - new Date(issue.remindAt).getTime()
  return { dueAt: nextDueAt, remindAt: new Date(new Date(nextDueAt).getTime() - delta).toISOString() }
}
