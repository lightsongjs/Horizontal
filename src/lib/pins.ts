// Fixările din sertar (rândul de pătrate de sus) și din grupul de sus al
// sidebar-ului. Pur, fără store: ce e fixat vine din bază (`pinned_items`,
// sincronizat în cont), iar aici se decide doar ordinea și ce mai e viu.

/** Ce se poate fixa. `list` = o listă a aplicației (vezi `PinnableList`). */
export type PinKind = 'filter' | 'project' | 'list'

/**
 * Listele care se pot fixa. „Azi" nu: e rădăcina, deschisă oricum la pornire,
 * iar un pătrat care duce unde ești deja e un pătrat în plus. Inbox-ul NU e
 * aici — e un proiect (`kind: 'project'`), deci se fixează ca proiect.
 */
export type PinnableList = 'week' | 'inbox'
export const PINNABLE_LISTS: readonly PinnableList[] = ['week', 'inbox']

export interface Pin {
  kind: PinKind
  ref: string
  /** Ordinea = ordinea fixării. Nu e unică garantat (două dispozitive), deci se departajează după cheie. */
  position: number
}

export function isPinned(pins: readonly Pin[], kind: PinKind, ref: string): boolean {
  return pins.some((p) => p.kind === kind && p.ref === ref)
}

/** Poziția unei fixări noi: după toate. Ordinea fixării, nu alfabetică. */
export function nextPinPosition(pins: readonly Pin[]): number {
  return pins.reduce((m, p) => Math.max(m, p.position), -1) + 1
}

/** Idempotent: o a doua fixare a aceluiași lucru nu-l mută la coadă. */
export function withPin(pins: readonly Pin[], kind: PinKind, ref: string): Pin[] {
  if (isPinned(pins, kind, ref)) return [...pins]
  return [...pins, { kind, ref, position: nextPinPosition(pins) }]
}

export function withoutPin(pins: readonly Pin[], kind: PinKind, ref: string): Pin[] {
  return pins.filter((p) => !(p.kind === kind && p.ref === ref))
}

/**
 * Fixările care încă au în ce să ducă, în ordinea fixării.
 *
 * Un proiect șters (sau la care ai pierdut accesul) și un filtru șters lasă în
 * urmă un rând de fixare — nu-l ștergem din bază de aici (o listă de proiecte
 * încă neîncărcată ar arăta „nimic nu mai există" și ar șterge tot), doar nu-l
 * arătăm. O listă necunoscută (un `ref` dintr-o versiune viitoare) la fel.
 */
export function livePins(
  pins: readonly Pin[],
  known: { projects: readonly string[]; filters: readonly string[] },
): Pin[] {
  const projects = new Set(known.projects)
  const filters = new Set(known.filters)
  return pins
    .filter((p) =>
      p.kind === 'project' ? projects.has(p.ref)
      : p.kind === 'filter' ? filters.has(p.ref)
      : (PINNABLE_LISTS as readonly string[]).includes(p.ref))
    .sort((a, b) => a.position - b.position || `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`))
}
