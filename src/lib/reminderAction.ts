import type { Issue } from './types'
import { SNOOZE_MINUTES } from './pushPayload'

export type ReminderMutation =
  | { kind: 'toggle' }
  | { kind: 'patch'; patch: { remindAt: string } }
  | { kind: 'none' }

/**
 * Ce face un buton al notificării, indiferent cine l-a primit (service
 * worker-ul pe web, cutia pe desktop). „Gata" nu comută orb: o sarcină bifată
 * între timp pe telefon ar fi fost DEbifată de un click pe o notificare veche.
 * Necunoscută (nu e în cache) — comută, ca înainte: n-avem cum s-o știm bifată.
 * Amânarea mută mementoul, nu scadența. `minutes` implicit e SNOOZE_MINUTES,
 * constanta eticheta butonului web și `supabase/functions/reminder-action`: acolo
 * serverul construiește notificarea de pe telefon, deci rămâne la 5. Cutia de
 * desktop trimite 15 sau 30 (vezi `desktop/src/notify.ts`).
 */
export function reminderMutation(action: 'done' | 'snooze', issue: Pick<Issue, 'done'> | undefined, now: Date, minutes: number = SNOOZE_MINUTES): ReminderMutation {
  if (action === 'done') return issue?.done ? { kind: 'none' } : { kind: 'toggle' }
  return { kind: 'patch', patch: { remindAt: new Date(now.getTime() + minutes * 60_000).toISOString() } }
}

/** Opțiunile foii „Amână…" de pe Android. `at` = „altă oră…", aleasă de om. */
export type SnoozeOption = { kind: 'minutes'; minutes: number } | { kind: 'tomorrow9' } | { kind: 'at'; at: string }

/** Ce se scrie. `dueAt` lipsește când scadența rămâne pe loc. */
export interface SnoozePatch { remindAt: string; dueAt?: string }

const localDay = (d: Date) => d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate()

/**
 * Unde ajunge o amânare. Port Kotlin: `core/SnoozeTarget.kt`, cu aceleași
 * `reminderAction.fixtures.json` — un caz nou se adaugă acolo, nu aici.
 *
 * Opțiunile în minute mută doar mementoul, ca „Amână" de pe web. Cele care
 * trec în altă zi (`tomorrow9`, `at`) mută și scadența pe ziua mementoului,
 * cu ora ei păstrată — altfel mâine sarcina ar ieși roșie în „Azi", ca
 * restanță, deși tocmai ai amânat-o cu bună știință (răspunsul omului,
 * 2026-10-02). O scadență deja mai târziu nu e trasă înapoi, iar o sarcină
 * fără scadență nu primește una.
 */
export function snoozeTarget(option: SnoozeOption, now: Date, issue: Pick<Issue, 'dueAt'>): SnoozePatch {
  let remind: Date
  if (option.kind === 'minutes') return { remindAt: new Date(now.getTime() + option.minutes * 60_000).toISOString() }
  if (option.kind === 'tomorrow9') remind = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
  else remind = new Date(option.at)
  const out: SnoozePatch = { remindAt: remind.toISOString() }
  if (!issue.dueAt) return out
  const due = new Date(issue.dueAt)
  if (Number.isNaN(due.getTime()) || localDay(remind) <= localDay(due)) return out
  out.dueAt = new Date(remind.getFullYear(), remind.getMonth(), remind.getDate(),
    due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds()).toISOString()
  return out
}
