import type { Issue, Project } from './types'
import { planNotification } from './pushPayload'

/**
 * Contractul cu aplicația de Linux (`desktop/`). Cutia Electron injectează
 * `window.horizontalDesktop` din preload, și numai pe originea ei; în browser
 * puntea lipsește și site-ul se poartă exact ca azi. Schimbă tipurile de aici
 * doar împreună cu `desktop/src/preload.ts` — e același contract, scris de două ori.
 */
export interface DesktopReminder {
  /** `${id}@${at}` — un memento amânat e ALT memento (altă cheie), nu același mutat. */
  key: string
  id: string
  /** ISO. */
  at: string
  title: string
  body: string
}

/** `minutes` e prezent doar la `snooze`: cutia oferă 15 și 30, web-ul rămâne la SNOOZE_MINUTES. */
export type DesktopAction = { action: 'done' | 'snooze' | 'open'; id: string; minutes?: number }

export interface HorizontalDesktop {
  version: string
  setReminders(list: DesktopReminder[]): void
  onReminderAction(fn: (a: DesktopAction) => void): () => void
  hideBar(): void
  /** După trezirea din somn: fereastra ascunsă n-a primit niciun `visibilitychange`, datele sunt vechi. */
  onResync?(fn: () => void): () => void
}

export function getDesktopBridge(): HorizontalDesktop | null {
  return (window as unknown as { horizontalDesktop?: HorizontalDesktop }).horizontalDesktop ?? null
}

/**
 * Cât de vechi poate fi un memento ca să RĂMÂNĂ în listă. Nu e regula de sunet
 * (aceea e în cutie: doar ultima oră sună) — e regula de retragere: cutia
 * închide orice notificare a cărei cheie lipsește din listă, deci un memento
 * nebifat, ieșit din listă după o oră, și-ar fi închis singur notificarea.
 */
export const REMINDER_LOOKBACK_MS = 24 * 3_600_000
/** Cât în față planifică cutia. Pagina retrimite lista periodic, deci fereastra alunecă. */
export const REMINDER_HORIZON_MS = 24 * 3_600_000

/**
 * Mementourile pe care cutia trebuie să le țină, din ce știe pagina acum
 * (cache-ul offline inclus). Textul vine din `planNotification`, ca notificarea
 * de pe desktop să spună exact ce spune cea de pe telefon.
 */
export function upcomingReminders(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): DesktopReminder[] {
  const from = now.getTime() - REMINDER_LOOKBACK_MS
  const to = now.getTime() + REMINDER_HORIZON_MS
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const seen = new Set<string>()
  const out: DesktopReminder[] = []
  for (const i of issues) {
    if (i.done || !i.remindAt || seen.has(i.id)) continue
    const t = Date.parse(i.remindAt)
    if (!Number.isFinite(t) || t < from || t > to) continue
    seen.add(i.id)
    const at = new Date(t).toISOString()
    const plan = planNotification({ id: i.id, title: i.title, dueAt: i.dueAt ?? undefined, allDay: i.allDay, projectName: names.get(i.projectId) })
    out.push({ key: `${i.id}@${at}`, id: i.id, at, title: plan.title, body: plan.body })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
