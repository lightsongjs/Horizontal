import type { Issue, Project } from './types'
import { planNotification } from './pushPayload'
import { pings, pingsBetween } from '../../supabase/functions/_shared/pings.ts'

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
  /**
   * `'event'` = eveniment din Google Calendar (`id` = `cal:<uuid>`): cutia îl
   * arată FĂRĂ „Gata" și amânări, doar cu „Deschide". O cutie instalată înainte
   * de câmp îl ignoră și pune butoanele obișnuite — pagina refuză atunci
   * acțiunea pe un id `cal:` (`NativeBridge`), deci nu se întâmplă nimic rău.
   */
  kind?: 'event'
  /**
   * Un ping dintr-o serie de mementouri (`pingEvery`): cutia de Linux arată
   * doar „Gata azi" (fără amânări) și închide pingul de dinainte al aceluiași
   * tichet. O cutie mai veche pune butoanele obișnuite; o amânare de acolo e
   * refuzată de pagină (`reminderMutation`).
   */
  series?: true
  /**
   * Doar pe Android (`series: 'row'`): pasul seriei, în minute. Rândul e UNUL pe
   * tichet, cu `at` = primul ping (ancora grilei) și `dueAt` = capătul; cutia
   * desfășoară singură pingurile (`core/Pings.kt`). Un APK mai vechi ignoră
   * câmpul și sună doar primul ping.
   */
  every?: number
  /**
   * Doar pe Android: `Issue.snoozedFrom` (ISO), ca o a doua amânare din
   * notificare să păstreze baza primei (`snoozeTarget` din `core/SnoozeTarget.kt`).
   * Lipsă = neamânat. Linux îl ignoră — acolo amână pagina, din cache.
   */
  snoozedFrom?: string
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
  /** `from`: baza amânării (`snoozeBase`, port Kotlin) — mementoul planificat,
   *  scris în `snoozedFrom`. Un APK mai vechi n-o trimite; pagina o calculează atunci. */
  | { action: 'until'; id: string; at: string; dueAt?: string; from?: string }

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
 * Câte pinguri ale unei serii primește cutia de Linux într-o listă. Pagina
 * retrimite lista cel târziu la 15 minute (`RESEND_MS`), iar lista pornește
 * mereu de la pingul curent — deci o oră de pinguri la un minut acoperă larg
 * golul dintre două trimiteri, fără sute de timere pentru o zi întreagă.
 */
export const SERIES_PINGS_LIMIT = 60

/**
 * Mementourile pe care cutia trebuie să le țină, din ce știe pagina acum
 * (cache-ul offline inclus). Textul vine din `planNotification`, ca notificarea
 * de pe desktop să spună exact ce spune cea de pe telefon.
 *
 * O serie (`pingEvery`) e, implicit, desfășurată în pinguri — de la cel curent
 * (ultimul deja sunat, ca notificarea lui să rămână pe ecran) până la capătul
 * ferestrei — fiecare cu cheia lui `id@ping`. Cu `series: 'row'` (Android)
 * rămâne UN rând cu `every`, iar cutia desfășoară singură.
 */
export function upcomingReminders(
  issues: Issue[],
  projects: Pick<Project, 'id' | 'name'>[],
  now: Date,
  opts: { horizonMs?: number; limit?: number; series?: 'expand' | 'row' } = {},
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
    const series = !!i.pingEvery && !!i.dueAt
    const plan = planNotification({ id: i.id, title: i.title, dueAt: i.dueAt ?? undefined, allDay: i.allDay, projectName: names.get(i.projectId), series })
    const row = (ms: number): DesktopReminder => {
      const at = new Date(ms).toISOString()
      return { key: `${i.id}@${at}`, id: i.id, at, title: plan.title, body: plan.body, dueAt: i.dueAt ?? null, allDay: i.allDay }
    }
    if (!series) { out.push(i.snoozedFrom ? { ...row(t), snoozedFrom: i.snoozedFrom } : row(t)); continue }
    const every = i.pingEvery!
    if (opts.series === 'row') { out.push({ ...row(t), every }); continue }
    const end = Date.parse(i.dueAt!)
    const cur = pings(t, every, end, now.getTime()).current
    for (const ms of pingsBetween(t, every, end, cur ?? t, to, SERIES_PINGS_LIMIT)) out.push({ ...row(ms), series: true })
  }
  out.sort((a, b) => a.at.localeCompare(b.at))
  // Plafonul taie din coadă, după sortare: un telefon nedeschis câteva zile
  // are nevoie de ce urmează curând, nu de ce a fost primul în cache.
  return opts.limit ? out.slice(0, opts.limit) : out
}
