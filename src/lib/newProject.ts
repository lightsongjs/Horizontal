// src/lib/newProject.ts
// Regulile unui proiect NOU, într-un singur loc: prefixul sugerat din nume,
// curățarea prefixului, id-ul derivat din el, ocuparea, valorile implicite și
// cele două valuri de pornire. Le folosesc formularul (`ProjectForm`), ambele
// repository-uri și `POST /api/projects` (functions/api) — o regulă scrisă de
// două ori ar fi lăsat API-ul să facă proiecte pe care aplicația nu le-ar face.

import type { Project, Wave } from './types'

/** Paleta din formular; prima e și culoarea implicită. */
export const PROJECT_ACCENTS = ['#0EA5E9', '#3ecf8e', '#ffb454', '#a06eff', '#ff6b6b', '#46d1d9'] as const
export const DEFAULT_PROJECT_ACCENT = PROJECT_ACCENTS[0]

/** Cât de lung poate fi un prefix (ID-urile tichetelor: `PREFIX-01`). */
export const PREFIX_MAX = 6

/**
 * Prefixul sugerat din nume: inițialele cuvintelor, cu majuscule, max 6.
 * Nu curăță: „Știri noi” dă „ȘN”, iar `cleanPrefix` îl taie la „N” — exact
 * ce face formularul de când există.
 */
export function autoPrefix(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, PREFIX_MAX) ||
    name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PREFIX_MAX)
}

/** Prefixul așa cum se salvează: numai A–Z și 0–9, majuscule, max 6. Poate ieși gol. */
export function cleanPrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PREFIX_MAX)
}

/** Id-ul proiectului = prefixul cu litere mici (`TUR` → `tur`). */
export function projectIdForPrefix(prefix: string): string {
  return prefix.toLowerCase()
}

/**
 * Proiectul existent care ocupă deja prefixul, sau null. Ocupat = același id
 * (cheia primară) SAU același prefix: proiectele vechi au id-uri care nu
 * vin din prefix (`horizontal` / `HZ`), iar un prefix dublat ar face ca două
 * proiecte să-și dispute aceleași ID-uri de tichet (`issues.id` e global).
 */
export function prefixOwner<P extends Pick<Project, 'id' | 'prefix'>>(projects: readonly P[], prefix: string): P | null {
  const clean = cleanPrefix(prefix)
  if (!clean) return null
  const id = projectIdForPrefix(clean)
  return projects.find((p) => p.id.toLowerCase() === id || String(p.prefix ?? '').toUpperCase() === clean) ?? null
}

export interface NewProjectInput {
  name: string
  description?: string
  prefix: string
  accent?: string
  type?: 'personal' | 'work'
}

/** Proiectul gata de scris: id din prefix, valul 1 activ, culoarea și tipul implicite. */
export function buildNewProject(input: NewProjectInput): Project {
  return {
    id: projectIdForPrefix(input.prefix),
    name: input.name,
    description: input.description ?? '',
    prefix: input.prefix.toUpperCase(),
    currentWave: 1,
    accent: input.accent ?? DEFAULT_PROJECT_ACCENT,
    type: input.type ?? 'personal',
  }
}

/** Valurile cu care pornește orice proiect: Notițele (0) și „Val 1 / MVP” (1, cel activ). */
export function initialWaves(projectId: string): Wave[] {
  return [
    { projectId, number: 0, name: 'Scratchpad', label: '', position: 0 },
    { projectId, number: 1, name: 'Val 1', label: 'MVP', position: 1 },
  ]
}
