// Ce face o acțiune pe mai multe sarcini deodată — glisarea unui rând și bara
// de selecție de pe telefon. Pur: din tichete și o acțiune iese o listă de
// scrieri (doar câmpurile care chiar se schimbă), poza câmpurilor de dinainte
// (pentru „Anulează") și propoziția din toast. Store-ul doar execută.
//
// Data se mută păstrând ORA: o sarcină de 9:00 mutată pe mâine e tot la 9:00.
// Aritmetica e pe componente locale (`setDate`), nu pe milisecunde — o mutare
// peste schimbarea orei de vară n-are voie să deplaseze ora.

import { moveDue } from './issuePatch'
import { addDays, startOfLocalDay, toShortDate } from './schedule'
import type { Issue } from './types'

/** Presetările foii de dată. `pick` e „Alege…": o zi, opțional o oră. */
export type DatePreset =
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'plus1' }
  | { kind: 'nextMonday' }
  | { kind: 'none' }
  | { kind: 'pick'; date: Date; time: string | null }

export type BulkAction =
  | { kind: 'date'; preset: DatePreset }
  | { kind: 'urgent'; value: boolean }
  | { kind: 'done' }
  | { kind: 'assign'; assigneeId: string | null }

type Fields = Partial<Pick<Issue, 'dueAt' | 'allDay' | 'remindAt' | 'urgent' | 'done' | 'assigneeId'>>

export interface Write {
  id: string
  /** Numai câmpurile care se schimbă. */
  patch: Fields
  /** Valorile de dinainte ale acelorași câmpuri (plus ce mută triggerul). */
  prev: Fields
}

export interface Plan {
  writes: Write[]
  /** Rânduri din proiecte doar-citire: selectabile, dar sărite. */
  readOnly: number
}

/** Prima zi de luni strict DUPĂ azi. Luni dimineața, „luni viitoare" e peste o săptămână. */
export function nextMonday(now: Date): Date {
  const today = startOfLocalDay(now)
  const ahead = ((1 - today.getDay() + 7) % 7) || 7
  return addDays(today, ahead)
}

/** Ziua `day`, cu ora și minutul din `iso` (sau 00:00 fără `iso`). */
function onDay(day: Date, iso: string | null): Date {
  const out = startOfLocalDay(day)
  if (iso) {
    const src = new Date(iso)
    out.setHours(src.getHours(), src.getMinutes(), 0, 0)
  }
  return out
}

/**
 * Câmpurile de dată ale unei sarcini după o presetare. Întoarce DOAR ce se
 * schimbă — un patch gol înseamnă „nimic de scris".
 *
 * Fără dată, „Azi"/„Mâine"/„+1 zi" pun o zi întreagă (fără oră de inventat).
 * „+1 zi" e relativ la scadența PROPRIE; fără scadență, e mâine.
 * Recurența (`rrule`) nu se atinge: se mută doar apariția curentă.
 */
export function datePatch(issue: Issue, preset: DatePreset, now: Date): Fields {
  const today = startOfLocalDay(now)
  let target: Date | null
  let allDay = issue.allDay
  let time: string | null = issue.dueAt
  switch (preset.kind) {
    case 'today': target = today; break
    case 'tomorrow': target = addDays(today, 1); break
    case 'plus1': target = issue.dueAt ? addDays(new Date(issue.dueAt), 1) : addDays(today, 1); break
    case 'nextMonday': target = nextMonday(now); break
    case 'none': target = null; break
    case 'pick':
      target = preset.date
      if (preset.time) {
        const [h, m] = preset.time.split(':').map(Number)
        const t = startOfLocalDay(preset.date)
        t.setHours(h, m, 0, 0)
        time = t.toISOString()
        allDay = false
      }
      break
  }

  if (!target) {
    const out: Fields = {}
    if (issue.dueAt !== null) out.dueAt = null
    if (!issue.allDay) out.allDay = true
    if (issue.remindAt !== null) out.remindAt = null
    return out
  }

  // Fără scadență nu există oră de păstrat: zi întreagă.
  if (!issue.dueAt) {
    if (preset.kind !== 'pick' || !preset.time) { allDay = true; time = null }
  }
  const nextDue = onDay(target, allDay ? null : time).toISOString()
  const moved = moveDue(issue, nextDue)
  const out: Fields = {}
  if (moved.dueAt !== issue.dueAt) out.dueAt = moved.dueAt
  if (allDay !== issue.allDay) out.allDay = allDay
  if (moved.remindAt !== issue.remindAt) out.remindAt = moved.remindAt
  return out
}

/** Patch-ul unei acțiuni pe o sarcină. */
export function actionPatch(issue: Issue, action: BulkAction, now: Date): Fields {
  switch (action.kind) {
    case 'date': return datePatch(issue, action.preset, now)
    case 'urgent': return issue.urgent === action.value ? {} : { urgent: action.value }
    case 'done': return issue.done ? {} : { done: true }
    case 'assign': return (issue.assigneeId ?? null) === action.assigneeId ? {} : { assigneeId: action.assigneeId }
  }
}

/**
 * Valorile de dinainte pentru câmpurile din `patch`. Bifarea unei recurente
 * mută și scadența (triggerul `issues_zz_advance_recurrence`), deci poza ține
 * și `dueAt`/`remindAt` — exact ce ține `recurrenceUndo` pentru o singură bifă.
 * Anularea scrie `done: false` peste `false` (rândul a sărit deja), iar
 * triggerul se uită la tranziția false → true, deci nu mai sare o dată.
 */
export function snapshot(issue: Issue, patch: Fields): Fields {
  const prev: Fields = {}
  for (const k of Object.keys(patch) as (keyof Fields)[]) {
    ;(prev as Record<string, unknown>)[k] = issue[k] ?? null
  }
  if (patch.done === true && issue.rrule) {
    prev.dueAt = issue.dueAt
    prev.remindAt = issue.remindAt
  }
  return prev
}

/**
 * Scrierile pentru o acțiune. Sarcinile din proiecte doar-citire se numără și
 * se sar (rămân selectabile — omul nu trebuie să știe dinainte care sunt);
 * cele la care acțiunea n-ar schimba nimic nu produc nicio scriere.
 */
export function planBulk(
  issues: Issue[],
  action: BulkAction,
  canWrite: (projectId: string) => boolean,
  now: Date,
): Plan {
  const writes: Write[] = []
  let readOnly = 0
  for (const issue of issues) {
    if (!canWrite(issue.projectId)) { readOnly++; continue }
    const patch = actionPatch(issue, action, now)
    if (Object.keys(patch).length === 0) continue
    writes.push({ id: issue.id, patch, prev: snapshot(issue, patch) })
  }
  return { writes, readOnly }
}

/** Câte recurente sunt în selecție — nota mono din foaia de dată. */
export function countRecurring(issues: Issue[]): number {
  return issues.filter((i) => !!i.rrule).length
}

/**
 * „Fără dată" pe o recurentă i-ar șterge și repetarea (`reschedule`: o
 * repetare fără zi de pornire e o stare din care interfața nu mai iese), deci
 * presetarea e oprită cât selecția conține una.
 */
export function canClearDate(issues: Issue[]): boolean {
  return countRecurring(issues) === 0
}

/** Urgent pe selecție: dacă toate sunt deja urgente, se scoate; altfel se pune. */
export function urgentTarget(issues: Issue[]): boolean {
  return !(issues.length > 0 && issues.every((i) => i.urgent))
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

function dateWords(preset: DatePreset): string {
  switch (preset.kind) {
    case 'today': return 'pe azi'
    case 'tomorrow': return 'pe mâine'
    case 'plus1': return 'cu o zi'
    case 'nextMonday': return 'pe luni'
    case 'none': return 'fără dată'
    case 'pick': return `pe ${toShortDate(preset.date)}`
  }
}

/** Coada „· 2 sărite (doar citire)", sau nimic. */
function skippedTail(readOnly: number): string {
  return readOnly > 0 ? ` · ${readOnly} ${readOnly === 1 ? 'sărită' : 'sărite'} (doar citire)` : ''
}

/**
 * Propoziția din toast. `jumped` = câte recurente au sărit la următoarea dată
 * (numărate DUPĂ răspunsul bazei, ca la `didJumpOnComplete`).
 */
export function bulkNotice(action: BulkAction, written: number, readOnly: number, jumped = 0): string {
  let head: string
  switch (action.kind) {
    case 'date':
      head = action.preset.kind === 'none'
        ? plural(written, 'Fără dată', 'fără dată')
        : `${plural(written, 'Mutat', 'mutate')} ${dateWords(action.preset)}`
      break
    case 'urgent':
      head = action.value ? plural(written, 'Marcat urgent', 'marcate urgent') : plural(written, 'Urgent scos', 'fără urgent')
      break
    case 'done':
      head = plural(written, 'Gata', 'gata')
      if (jumped > 0) head += ` · ${jumped} ${jumped === 1 ? 'a sărit' : 'au sărit'} la următoarea dată`
      break
    case 'assign':
      head = action.assigneeId
        ? plural(written, 'Pasat', 'pasate')
        : plural(written, 'Înapoi la creator', 'înapoi la creator')
      break
  }
  if (written === 0) head = 'Nimic de schimbat'
  return head + skippedTail(readOnly)
}

/** Toastul unei ștergeri amânate. */
export function deleteNotice(deleted: number, readOnly: number): string {
  return (deleted === 0 ? 'Nimic de șters' : plural(deleted, 'Șters', 'șterse')) + skippedTail(readOnly)
}
