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
  /** Scadența, ISO sau null — pentru amânarea calculată în cutie (`snoozeTarget`). Linux o ignoră. */
  dueAt: string | null
  allDay: boolean
}

/**
 * Ce întoarce o cutie paginii. `minutes` doar la `snooze` (Linux: 15/30;
 * lipsă = SNOOZE_MINUTES). `until` vine de pe Android: ora e deja calculată
 * de cutie cu `snoozeTarget` (port Kotlin), iar `dueAt` e prezent doar când
 * scadența se mută — pagina NU o recalculează din cache-ul ei, care poate fi
 * mai vechi decât ce a văzut cutia.
 */
export type DesktopAction =
  /** `prevDueAt` vine doar de pe Android (scadența văzută de notificare; `null` =
   *  fără scadență): pagina refuză un „Gata" pe o recurentă care a sărit între
   *  timp. Linux nu-l trimite — acolo acțiunea pleacă imediat, din pagina vie. */
  | { action: 'done'; id: string; prevDueAt?: string | null }
  | { action: 'open'; id: string }
  | { action: 'snooze'; id: string; minutes?: number }
  | { action: 'until'; id: string; at: string; dueAt?: string }

export interface HorizontalDesktop {
  version: string
  setReminders(list: DesktopReminder[]): void
  onReminderAction(fn: (a: DesktopAction) => void): () => void
  hideBar(): void
  /**
   * Bara de captură își cere înălțimea conținutului (px CSS), ca descrierea
   * deschisă cu Tab să încapă. Opțional: o cutie instalată înainte de el n-o
   * are, iar bara cade atunci pe derulare. Cutia o limitează la 150–420.
   */
  resizeBar?(height: number): void
  /** După trezirea din somn: fereastra ascunsă n-a primit niciun `visibilitychange`, datele sunt vechi. */
  onResync?(fn: () => void): () => void
  /**
   * La 30 s: omul e la laptop (deblocat, atins în ultimele 2 min). Pagina o
   * scrie în bază (`touch_presence`), ca telefonul să-și amâne mementoul.
   * Opțional: o cutie instalată înainte de el n-o are, iar telefonul sună atunci la minut.
   */
  onPresence?(fn: (active: boolean) => void): () => void
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
export function upcomingReminders(
  issues: Issue[],
  projects: Pick<Project, 'id' | 'name'>[],
  now: Date,
  opts: { horizonMs?: number; limit?: number } = {},
): DesktopReminder[] {
  const from = now.getTime() - REMINDER_LOOKBACK_MS
  const to = now.getTime() + (opts.horizonMs ?? REMINDER_HORIZON_MS)
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
    out.push({ key: `${i.id}@${at}`, id: i.id, at, title: plan.title, body: plan.body, dueAt: i.dueAt ?? null, allDay: i.allDay })
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  // Plafonul taie din coadă, după sortare: un telefon nedeschis câteva zile
  // are nevoie de ce urmează curând, nu de ce a fost primul în cache.
  return opts.limit ? out.slice(0, opts.limit) : out
}
