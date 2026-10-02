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
