// Rutine: tichetele unui proiect „doar mementouri" (`remindersOnly`). Stau
// ascunse în „Azi", „7 zile" și widget până sună (`revealAt`), apoi apar ca
// orice sarcină până la bifă. La o recurentă bifa mută mementoul în viitor,
// deci rutina se ascunde iar singură. Un memento ratat (notificare ștearsă,
// Doze) nu se pierde: după ora lui, rutina stă în listă.
// Aceeași regulă în Kotlin: `hiddenUntil` din `core/Agenda.kt`.

import type { Issue, Project } from './types'

/** Momentul de la care rutina se vede: mementoul, altfel scadența (la o zi întreagă = miezul nopții locale). */
export function revealAt(it: Pick<Issue, 'dueAt' | 'remindAt'>): string | null {
  return it.remindAt ?? it.dueAt
}

export function routineProjectIds(projects: Pick<Project, 'id' | 'remindersOnly'>[]): Set<string> {
  return new Set(projects.filter((p) => p.remindersOnly).map((p) => p.id))
}

export function isDormant(it: Pick<Issue, 'projectId' | 'done' | 'dueAt' | 'remindAt'>, routines: Set<string>, now: Date): boolean {
  if (it.done || !routines.has(it.projectId)) return false
  const at = revealAt(it)
  return !!at && Date.parse(at) > now.getTime()
}

/** Cea mai apropiată ieșire din ascunzătoare, în ms; `null` dacă nu e niciuna. */
export function nextReveal(issues: Pick<Issue, 'projectId' | 'done' | 'dueAt' | 'remindAt'>[], routines: Set<string>, now: Date): number | null {
  let next: number | null = null
  for (const it of issues) {
    if (!isDormant(it, routines, now)) continue
    const at = Date.parse(revealAt(it)!)
    if (next === null || at < next) next = at
  }
  return next
}
