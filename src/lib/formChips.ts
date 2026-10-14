import { nextMonday } from './bulkActions'
import { describeRrule } from './recurrence'
import { addDays, startOfLocalDay, toDayMonth, type ReminderKind } from './schedule'

/**
 * Rândul de jetoane al formularului de tichet (design/form-compact).
 *
 * Regula e cea din `DueChip`: absența e informația. Se arată numai ce e SETAT;
 * restul stă după „+". Data e singura excepție — un jeton-fantomă „Dată" stă
 * mereu la vedere, fiindcă e proprietatea pusă cel mai des.
 *
 * Pur, ca decizia „ce jeton apare" să se testeze fără DOM.
 */

export type ChipKind = 'due' | 'reminder' | 'recur' | 'wave' | 'theme' | 'assignee' | 'urgent'
export type AddItem = 'theme' | 'assignee' | 'urgent'

export interface ChipInput {
  /** Scadența e o dată validă (nu text pe jumătate). */
  hasDue: boolean
  /** Scadența are oră — fără ea mementoul n-are sens (ar suna la miezul nopții). */
  hasTime: boolean
  reminder: ReminderKind
  /** Recurența care chiar se salvează (`rruleOut`): fără dată nu există. */
  rrule: string | null
  /** Câte valuri are proiectul. Cu unul singur (Inbox) n-ai ce alege. */
  waveCount: number
  hasTheme: boolean
  hasAssignee: boolean
  urgent: boolean
}

export function visibleChips(i: ChipInput): ChipKind[] {
  const out: ChipKind[] = ['due']
  if (i.hasDue && i.hasTime && i.reminder !== 'none') out.push('reminder')
  if (i.hasDue && i.rrule) out.push('recur')
  if (i.waveCount > 1) out.push('wave')
  if (i.hasTheme) out.push('theme')
  if (i.hasAssignee) out.push('assignee')
  if (i.urgent) out.push('urgent')
  return out
}

/**
 * Ce oferă „+": proprietățile încă nesetate. Urgentul e mereu acolo, ca
 * comutator („Urgent" / „Scoate urgent"); valul nu, fiindcă jetonul lui e
 * mereu la vedere când există ce alege.
 */
export function addMenuItems(i: Pick<ChipInput, 'hasTheme' | 'hasAssignee'>): AddItem[] {
  const out: AddItem[] = []
  if (!i.hasTheme) out.push('theme')
  if (!i.hasAssignee) out.push('assignee')
  out.push('urgent')
  return out
}

export const REMINDER_CHIP: Record<Exclude<ReminderKind, 'none'>, string> = {
  due: 'la oră',
  m30: '−30m',
  d1: '−1 zi',
}

/** Opțiunile din popoverul datei, în ordinea lor. */
export const REMINDER_OPTIONS: readonly [ReminderKind, string][] = [
  ['due', 'la oră'],
  ['m30', '−30m'],
  ['d1', '−1 zi'],
  ['none', 'fără'],
]

/** „Săptămânal", „Lunea și joia" — `describeRrule` cu majusculă. */
export function recurChipLabel(rrule: string | null): string {
  const d = describeRrule(rrule)
  if (!d) return 'Se repetă'
  return d.charAt(0).toUpperCase() + d.slice(1)
}

/**
 * Eticheta jetonului de val. Numele scurte (cifre romane, „2") primesc „Val "
 * în față, ca jetonul să spună ce e; un nume lung („Scratchpad") se spune
 * singur.
 */
export function waveChipLabel(name: string): string {
  const n = name.trim()
  if (/^val\b/i.test(n)) return n
  return n.length <= 4 ? `Val ${n}` : n
}

export interface DatePreset {
  key: 'today' | 'tomorrow' | 'monday' | 'week'
  label: string
  /** Sub etichetă: „mie 14" pentru zilele apropiate, „19 oct" pentru restul. */
  sub: string
  date: Date
}

const DAY_SHORT = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm']

/** Azi · Mâine · Luni · +1 săpt. — ziua locală, la miezul nopții. */
export function datePresets(now: Date): DatePreset[] {
  const today = startOfLocalDay(now)
  const tomorrow = addDays(today, 1)
  const near = (d: Date) => `${DAY_SHORT[d.getDay()]} ${d.getDate()}`
  const monday = startOfLocalDay(nextMonday(now))
  const week = addDays(today, 7)
  return [
    { key: 'today', label: 'Azi', sub: near(today), date: today },
    { key: 'tomorrow', label: 'Mâine', sub: near(tomorrow), date: tomorrow },
    { key: 'monday', label: 'Luni', sub: toDayMonth(monday), date: monday },
    { key: 'week', label: '+1 săpt.', sub: toDayMonth(week), date: week },
  ]
}
