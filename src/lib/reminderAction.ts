import type { Issue } from './types'
import { SNOOZE_MINUTES } from './pushPayload'

export type ReminderMutation =
  | { kind: 'toggle' }
  | { kind: 'patch'; patch: { remindAt: string; snoozedFrom?: string } }
  | { kind: 'none' }

/** Ce trebuie știut despre tichet ca amânarea să-și țină baza (`snoozeBase`). */
export type SnoozeIssue = Pick<Issue, 'dueAt'> & Partial<Pick<Issue, 'remindAt' | 'snoozedFrom'>>

/**
 * Ce face un buton al notificării, indiferent cine l-a primit (service
 * worker-ul pe web, cutia pe desktop). „Gata" nu comută orb: o sarcină bifată
 * între timp pe telefon ar fi fost DEbifată de un click pe o notificare veche.
 * Necunoscută (nu e în cache) — comută, ca înainte: n-avem cum s-o știm bifată.
 * Amânarea mută mementoul, nu scadența, și ține minte mementoul planificat
 * (`snoozedFrom`, vezi `snoozeBase`). `minutes` implicit e SNOOZE_MINUTES,
 * constanta eticheta butonului web și `supabase/functions/reminder-action`: acolo
 * serverul construiește notificarea de pe telefon, deci rămâne la 5. Cutia de
 * desktop trimite 15 sau 30 (vezi `desktop/src/notify.ts`).
 *
 * O serie de mementouri (`pingEvery`) nu se amână: următorul ping vine oricum,
 * iar mutarea lui `remindAt` i-ar muta ancora grilei. Și nici nu se bifează
 * dintr-o notificare: „Gata" pe un ping = am văzut pingul, seria continuă
 * (`SERIES_SEEN_LABEL`; bugul din 10 nov. 2026). Notificarea nouă trimite
 * `seen`, care nu ajunge aici; un worker, o cutie de Linux sau un APK de
 * dinainte încă trimit „done" (fostul „Gata azi") sau „Amână" — nu fac nimic.
 */
export function reminderMutation(action: 'done' | 'snooze', issue: (Pick<Issue, 'done'> & Partial<Pick<Issue, 'pingEvery' | 'dueAt' | 'remindAt' | 'snoozedFrom'>>) | undefined, now: Date, minutes: number = SNOOZE_MINUTES): ReminderMutation {
  if (issue?.pingEvery) return { kind: 'none' }
  if (action === 'done') return issue?.done ? { kind: 'none' } : { kind: 'toggle' }
  // Tichet necunoscut (nu e în cache): fără bază — n-avem de unde ști mementoul planificat.
  const { remindAt, snoozedFrom } = snoozeTarget({ kind: 'minutes', minutes }, now, { dueAt: null, ...issue })
  return { kind: 'patch', patch: snoozedFrom ? { remindAt, snoozedFrom } : { remindAt } }
}

/** Opțiunile foii „Amână…" de pe Android. `at` = „altă oră…", aleasă de om. */
export type SnoozeOption = { kind: 'minutes'; minutes: number } | { kind: 'tomorrow9' } | { kind: 'at'; at: string }

/**
 * Ce se scrie. `dueAt` lipsește când scadența rămâne pe loc; `snoozedFrom`
 * lipsește când tichetul n-avea memento de amânat (nimic de ținut minte).
 */
export interface SnoozePatch { remindAt: string; dueAt?: string; snoozedFrom?: string }

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
export function snoozeTarget(option: SnoozeOption, now: Date, issue: SnoozeIssue): SnoozePatch {
  const out = snoozeTime(option, now, issue)
  const base = snoozeBase(issue, out.dueAt)
  return base ? { ...out, snoozedFrom: base } : out
}

function snoozeTime(option: SnoozeOption, now: Date, issue: SnoozeIssue): SnoozePatch {
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

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * Baza unei amânări (`issues.snoozed_from`): mementoul PLANIFICAT al apariției
 * curente. Prima amânare o ia din `remindAt`; a doua o păstrează pe a primei
 * (`snoozedFrom ?? remindAt`) — altfel a doua amânare ar lua drept „plan" ora
 * primei. Dacă amânarea mută și scadența (`newDueAt`), baza se mută cu aceeași
 * distanță, ca `dueAt − snoozedFrom` să rămână decalajul ales de om.
 *
 * De ce: saltul recurenței ținea `due_at − remind_at`, iar după o amânare
 * `remind_at` e ora amânării. O sarcină zilnică de la 08:00, amânată până la
 * 12:00:39 și bifată, a sunat de atunci în fiecare zi la 12:00:39 (ROUTIN-12,
 * 2026-11-06). Trigger-ul pleacă acum de la `coalesce(snoozed_from, remind_at)`.
 *
 * `undefined` = nimic de ținut minte (fără memento). Port Kotlin:
 * `snoozeBase` din `core/SnoozeTarget.kt`, aceleași fixtures.
 */
export function snoozeBase(issue: SnoozeIssue, newDueAt?: string | null): string | undefined {
  const base = ms(issue.snoozedFrom) ?? ms(issue.remindAt)
  if (base === null) return undefined
  const from = ms(issue.dueAt)
  const to = ms(newDueAt)
  const shift = from !== null && to !== null ? to - from : 0
  return new Date(base + shift).toISOString()
}
