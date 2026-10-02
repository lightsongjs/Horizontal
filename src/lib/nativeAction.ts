import type { Issue } from './types'
import type { DesktopAction } from './desktopBridge'
import { reminderMutation } from './reminderAction'

export interface NativeActionDeps {
  find(id: string): Issue | undefined
  toggleDone(id: string): Promise<void>
  updateIssue(id: string, patch: Partial<Issue>): Promise<void>
  open(id: string): void
  now(): Date
}

/**
 * O acțiune venită de la o cutie (Linux sau Android), executată prin store —
 * deci prin coada offline. „Gata" trece prin `reminderMutation`: nu comută orb,
 * ca o notificare veche să nu debifeze o sarcină bifată pe alt dispozitiv.
 * `until`: ținta e calculată de cutie; recalculată aici din cache ar putea da
 * alt rezultat.
 */
export function runNativeAction(a: DesktopAction, d: NativeActionDeps): void {
  if (a.action === 'open') { d.open(a.id); return }
  if (a.action === 'until') { void d.updateIssue(a.id, a.dueAt ? { remindAt: a.at, dueAt: a.dueAt } : { remindAt: a.at }); return }
  const m = reminderMutation(a.action, d.find(a.id), d.now(), a.action === 'snooze' ? a.minutes : undefined)
  if (m.kind === 'toggle') void d.toggleDone(a.id)
  else if (m.kind === 'patch') void d.updateIssue(a.id, m.patch)
}
