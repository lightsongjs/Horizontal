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
 * - numai oră → ziua rămâne, se pune ora; dacă asta cade în trecut (ziua e
 *   azi și ora a trecut, sau scadența e restantă), e următoarea apariție a
 *   orei, ca la adăugarea rapidă — „la 8" spus seara pe o sarcină de azi e
 *   mâine la 8 (D-317);
 * - numai zi → ziua se schimbă, ora (dacă există) rămâne;
 * - amândouă → se înlocuiește;
 * - mementoul își ține decalajul; o zi întreagă care capătă oră trece pe
 *   mementoul implicit al unei ore (`reschedule`, ca la jetoane);
 * - recurența: o oră schimbă seria (rămâne `rrule`), o zi mută doar apariția
 *   curentă (tot rămâne `rrule`); numai o expresie de recurență în text o
 *   înlocuiește;
 * - o serie de mementouri scrisă în text („la fiecare 15 minute până la 10")
 *   înlocuiește tot: fereastra ei e completă, cu zi, primul ping și capăt.
 *   Peste o serie existentă, o zi sau o oră scrisă mută fereastra întreagă
 *   (`reschedule`).
 */
import type { ParsedDue } from './parseDue'
import { reschedule } from './schedule'

export interface DueState {
  dueAt: string | null
  allDay: boolean
  remindAt: string | null
  rrule: string | null
  /** Serie de mementouri (`Issue.pingEvery`); absent = nu e. */
  pingEvery?: number | null
}

export type TitleDueParse = Pick<ParsedDue, 'dueAt' | 'allDay' | 'rrule' | 'hasDay' | 'hasTime'>
  & Partial<Pick<ParsedDue, 'pingEvery' | 'remindAt'>>

/**
 * Scadența care rezultă. Întoarce câmpurile întregi (nu un diff): apelantul
 * le trimite prin salvarea automată, care oricum pleacă doar cu ce diferă.
 * `parsed.dueAt === null` (nicio dată recunoscută) → `existing` neatins.
 */
export function mergeTitleDue(existing: DueState, parsed: TitleDueParse, now: Date = new Date()): DueState {
  if (!parsed.dueAt) return { ...existing }
  const rrule = parsed.rrule ?? existing.rrule
  if (parsed.pingEvery && parsed.remindAt) {
    return { dueAt: parsed.dueAt, allDay: false, remindAt: parsed.remindAt, rrule: parsed.rrule, pingEvery: parsed.pingEvery }
  }
  const keep = existing.pingEvery !== undefined ? { pingEvery: existing.pingEvery } : {}

  if (!existing.dueAt) {
    const next = reschedule(existing, { dueAt: parsed.dueAt, allDay: parsed.allDay })
    return { dueAt: next.dueAt, allDay: next.allDay, remindAt: next.remindAt, rrule, ...keep, ...pick(next) }
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
    // Trecut → parserul a rostogolit deja ora pe următoarea ei apariție.
    target = { dueAt: d.getTime() < now.getTime() ? parsed.dueAt : d.toISOString(), allDay: false }
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
  return { dueAt: next.dueAt, allDay: next.allDay, remindAt: next.remindAt, rrule, ...keep, ...pick(next) }
}

/** Seria căzută la mutare (`reschedule` a scos-o), dacă e cazul. */
const pick = (n: { pingEvery?: null }) => ('pingEvery' in n ? { pingEvery: null } : {})
