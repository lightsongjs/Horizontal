// Ce vede widget-ul de pe ecranul de start: fixatele, restanțele și zilele 0..6 (azi +
// 6, NU „7 zile" din aplicație, care începe de mâine). Pagina trimite rândurile NEGRUPATE: gruparea o face
// cutia (`core/Agenda.kt`), fiindcă la miezul nopții se schimbă fără date noi.
// Regula e `buildSmartLists`; fixtures comune în `agenda.fixtures.json`.

import { dayOffset, isOverdue, SMART_LIST_DAYS } from './schedule'
import { revealAt } from './routines'
import { comparePinned, isPinnedOpen } from './pinned'
import type { Issue, Project } from './types'

export interface AgendaItem {
  id: string
  title: string
  project: string | null
  /** `null` numai pe o fixată fără scadență (un APK vechi sare rândul). */
  dueAt: string | null
  allDay: boolean
  hasReminder: boolean
  recurring: boolean
  urgent: boolean
  /** Rutină: cutia o ascunde până la acest moment (`src/lib/routines.ts`); altfel `null`. */
  hiddenUntil: string | null
  /** Culoarea proiectului (hex, a omului): inelul bifei din widget. Un APK vechi ignoră câmpul. */
  accent: string | null
  /**
   * Fixată („Fixează sus", `src/lib/pinned.ts`): când. Cutia o pune în grupul „Fixate",
   * primul, și nu și în ziua ei. Un APK vechi ignoră câmpul (și rândul fără scadență).
   */
  pinnedAt: string | null
}

/** Același plafon ca citirea nativă (`AGENDA_LIMIT` din `core/Agenda.kt`). */
export const AGENDA_LIMIT = 200

export function agendaItems(issues: Issue[], projects: (Pick<Project, 'id' | 'name' | 'remindersOnly'> & { accent?: string | null })[], now: Date): AgendaItem[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const accents = new Map(projects.map((p) => [p.id, p.accent || null]))
  const routines = new Set(projects.filter((p) => p.remindersOnly).map((p) => p.id))
  const byId = new Map<string, Issue>()
  for (const it of issues) {
    if (it.done || byId.has(it.id)) continue
    // O fixată intră oricum — fără scadență sau dincolo de fereastră (`buildSmartLists`).
    if (!isPinnedOpen(it)) {
      if (!it.dueAt) continue
      if (!isOverdue(it, now) && dayOffset(it.dueAt, now) >= SMART_LIST_DAYS) continue
    }
    byId.set(it.id, it)
  }
  // Fixatele întâi, apoi cronologic, nu `compareDue`: plafonul taie din viitor,
  // nu din fixate sau din restanțe — cu urgentele primele, o urgentă de peste o
  // săptămână ar fi împins afară o sarcină de azi. Ordinea de afișare o face
  // cutia (`core/Agenda.kt`). Aceeași ordine ca citirea nativă (`agendaQuery`).
  const chrono = (a: Issue, b: Issue) =>
    Number(isPinnedOpen(b)) - Number(isPinnedOpen(a))
    || (isPinnedOpen(a) && isPinnedOpen(b) ? comparePinned(a, b) : 0)
    || Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.id.localeCompare(b.id)
  return [...byId.values()].sort(chrono).slice(0, AGENDA_LIMIT).map((it) => ({
    id: it.id,
    title: it.title,
    project: names.get(it.projectId) ?? null,
    dueAt: it.dueAt ?? null,
    allDay: it.allDay,
    hasReminder: !!it.remindAt,
    recurring: !!it.rrule,
    urgent: it.urgent,
    hiddenUntil: routines.has(it.projectId) ? revealAt(it) : null,
    accent: accents.get(it.projectId) ?? null,
    pinnedAt: isPinnedOpen(it) ? it.pinnedAt : null,
  }))
}
