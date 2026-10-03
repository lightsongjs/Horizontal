/**
 * O dată scrisă în titlul unui tichet EXISTENT, așezată peste scadența lui.
 *
 * La adăugarea rapidă nu e nimic de așezat: ce scrii e scadența. Peste un
 * tichet care are deja una, același text înseamnă altceva — „la 17" pe o
 * ședință de joi e „joi la 17", nu „azi la 17" (și nici „mâine la 17", dacă
 * ora a trecut). De-aia `parseDue` spune CE a fost scris (`hasDay`/`hasTime`),
 * iar regula de îmbinare stă aici, pură, cu teste — nu în foaie.
 *
 * Regulile:
 * - fără scadență existentă → ce a înțeles parserul, ca la adăugarea rapidă;
 * - numai oră → ziua rămâne, se pune ora (fără rostogolire „a trecut deja");
 * - numai zi → ziua se schimbă, ora (dacă există) rămâne;
 * - amândouă → se înlocuiește;
 * - mementoul își ține decalajul; o zi întreagă care capătă oră trece pe
 *   mementoul implicit al unei ore (`reschedule`, ca la jetoane);
 * - recurența: o oră schimbă seria (rămâne `rrule`), o zi mută doar apariția
 *   curentă (tot rămâne `rrule`); numai o expresie de recurență în text o
 *   înlocuiește.
 */
import type { ParsedDue } from './parseDue'
import { reschedule } from './schedule'

export interface DueState {
  dueAt: string | null
  allDay: boolean
  remindAt: string | null
  rrule: string | null
}

export type TitleDueParse = Pick<ParsedDue, 'dueAt' | 'allDay' | 'rrule' | 'hasDay' | 'hasTime'>

/**
 * Scadența care rezultă. Întoarce câmpurile întregi (nu un diff): apelantul
 * le trimite prin salvarea automată, care oricum pleacă doar cu ce diferă.
 * `parsed.dueAt === null` (nicio dată recunoscută) → `existing` neatins.
 */
export function mergeTitleDue(existing: DueState, parsed: TitleDueParse): DueState {
  if (!parsed.dueAt) return { ...existing }
  const rrule = parsed.rrule ?? existing.rrule

  if (!existing.dueAt) {
    const next = reschedule(existing, { dueAt: parsed.dueAt, allDay: parsed.allDay })
    return { dueAt: next.dueAt, allDay: next.allDay, remindAt: next.remindAt, rrule }
  }

  const old = new Date(existing.dueAt)
  const got = new Date(parsed.dueAt)
  let target: { dueAt: string; allDay: boolean }

  if (parsed.hasDay && parsed.hasTime) {
    target = { dueAt: parsed.dueAt, allDay: false }
  } else if (parsed.hasTime) {
    // Ziua scadenței, ora din text. `setHours` pe ziua LOCALĂ a scadenței:
    // aceeași zi pe care o arată jetonul.
    const d = new Date(old)
    d.setHours(got.getHours(), got.getMinutes(), 0, 0)
    target = { dueAt: d.toISOString(), allDay: false }
  } else if (parsed.hasDay) {
    const d = new Date(got)
    if (existing.allDay) d.setHours(0, 0, 0, 0)
    else d.setHours(old.getHours(), old.getMinutes(), 0, 0)
    target = { dueAt: d.toISOString(), allDay: existing.allDay }
  } else {
    // Numai recurență, fără zi și fără oră („zilnic"): scadența rămâne, se
    // schimbă doar repetarea. Ziua de azi, implicitul parserului, ar fi mutat
    // o sarcină programată pentru săptămâna viitoare fără să fi cerut-o nimeni.
    return { ...existing, rrule }
  }

  const next = reschedule(existing, target)
  return { dueAt: next.dueAt, allDay: next.allDay, remindAt: next.remindAt, rrule }
}
