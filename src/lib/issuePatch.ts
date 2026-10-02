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
      const delta = out.remindAt ? new Date(out.dueAt).getTime() - new Date(out.remindAt).getTime() : null
      out.dueAt = nxt
      out.remindAt = delta === null ? null : new Date(new Date(nxt).getTime() - delta).toISOString()
      out.done = false
    }
  }
  return out
}
