// Ce vede widget-ul de pe ecranul de start: restanțele și zilele 0..6, ca
// listele „Azi" / „7 zile". Pagina trimite rândurile NEGRUPATE: gruparea o face
// cutia (`core/Agenda.kt`), fiindcă la miezul nopții se schimbă fără date noi.
// Regula e `buildSmartLists`; fixtures comune în `agenda.fixtures.json`.

import { compareDue, dayOffset, isOverdue, SMART_LIST_DAYS } from './schedule'
import type { Issue, Project } from './types'

export interface AgendaItem {
  id: string
  title: string
  project: string | null
  dueAt: string
  allDay: boolean
  hasReminder: boolean
  recurring: boolean
  urgent: boolean
}

/** Același plafon ca citirea nativă (`AGENDA_LIMIT` din `core/Agenda.kt`). */
export const AGENDA_LIMIT = 200

export function agendaItems(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): AgendaItem[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const byId = new Map<string, Issue>()
  for (const it of issues) {
    if (it.done || !it.dueAt || byId.has(it.id)) continue
    if (!isOverdue(it, now) && dayOffset(it.dueAt, now) >= SMART_LIST_DAYS) continue
    byId.set(it.id, it)
  }
  return [...byId.values()].sort(compareDue).slice(0, AGENDA_LIMIT).map((it) => ({
    id: it.id,
    title: it.title,
    project: names.get(it.projectId) ?? null,
    dueAt: it.dueAt!,
    allDay: it.allDay,
    hasReminder: !!it.remindAt,
    recurring: !!it.rrule,
    urgent: it.urgent,
  }))
}
