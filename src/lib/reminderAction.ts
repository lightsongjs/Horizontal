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
 * Amânarea mută mementoul, nu scadența; aceeași constantă o folosesc eticheta
 * butonului și `supabase/functions/reminder-action`.
 */
export function reminderMutation(action: 'done' | 'snooze', issue: Pick<Issue, 'done'> | undefined, now: Date): ReminderMutation {
  if (action === 'done') return issue?.done ? { kind: 'none' } : { kind: 'toggle' }
  return { kind: 'patch', patch: { remindAt: new Date(now.getTime() + SNOOZE_MINUTES * 60_000).toISOString() } }
}
