// Fixările din sertar (rândul de pătrate de sus) și din grupul de sus al
// sidebar-ului. Pur, fără store: ce e fixat vine din bază (`pinned_items`,
// sincronizat în cont), iar aici se decide doar ordinea și ce mai e viu.

/**
 * Ce se poate fixa: un proiect sau un filtru salvat.
 *
 * `list` e moștenire: până pe 2026-11-06 se fixau și „7 zile" și „Ale mele".
 * De atunci navigarea (Azi, 7 zile, Ale mele) stă fixă deasupra grupului
 * „Fixate", deci o listă fixată ar fi apărut de două ori. Rândurile vechi din
 * `pinned_items` rămân în bază (fără migrare), dar nu se mai arată
 * (`livePins`) și nu se mai pot crea din UI.
 */
export type PinKind = 'filter' | 'project' | 'list'

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
 * Fixările care încă au în ce să ducă, în ordinea fixării: numai proiecte și
 * filtre — grupul „Fixate" nu ține navigare (vezi `PinKind`).
 *
 * Un proiect șters (sau la care ai pierdut accesul) și un filtru șters lasă în
 * urmă un rând de fixare — nu-l ștergem din bază de aici (o listă de proiecte
 * încă neîncărcată ar arăta „nimic nu mai există" și ar șterge tot), doar nu-l
 * arătăm. O listă fixată (moștenire) sau un `kind` necunoscut, la fel.
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
      : false)
    .sort((a, b) => a.position - b.position || `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`))
}

/** Cheia unei fixări — `kind` + `ref`, ca cheia primară din `pinned_items` (fără `user_id`). */
export const pinKey = (p: Pick<Pin, 'kind' | 'ref'>) => `${p.kind}:${p.ref}`

/**
 * Mută o fixare pe locul `to` din lista VIE (`livePins`, ordinea de pe
 * ecran) și întoarce doar fixările a căror poziție se schimbă (2026-11-06).
 *
 * Renumerotare 0…n-1, nu „o valoare între vecini" ca la tichete
 * (`movePinned`): `position` e întreg, iar fixările sunt câteva. Fixările
 * orfane (`livePins` le ascunde) își păstrează poziția: dacă o țintă revine,
 * cade undeva în ordine și se departajează după cheie — nu merită o scriere
 * pentru ce nu se vede. O fixare nouă (`nextPinPosition`) rămâne la coadă.
 */
export function movePin(live: readonly Pin[], key: string, to: number): Pin[] {
  const from = live.findIndex((p) => pinKey(p) === key)
  if (from < 0) return []
  const rest = live.filter((_, i) => i !== from)
  const at = Math.max(0, Math.min(to, rest.length))
  if (at === from) return []
  const order = [...rest.slice(0, at), live[from], ...rest.slice(at)]
  return order
    .map((p, i) => ({ ...p, position: i }))
    .filter((p, i) => order[i].position !== p.position)
}

/** `pins` cu pozițiile din `moved` (aceeași cheie); restul neatinse. */
export function withPositions(pins: readonly Pin[], moved: readonly Pin[]): Pin[] {
  const at = new Map(moved.map((p) => [pinKey(p), p.position]))
  return pins.map((p) => (at.has(pinKey(p)) ? { ...p, position: at.get(pinKey(p))! } : p))
}

/**
 * Locul unde cade un element tras: câte ALTE elemente au mijlocul înaintea
 * centrului lui. `mids` = mijloacele (pe axa tragerii) la începutul tragerii.
 */
export function dropIndex(mids: readonly number[], from: number, center: number): number {
  return mids.filter((m, j) => j !== from && m < center).length
}

/** Cât se dă la o parte elementul `j` cât `from` e tras spre `to`: un pas, sau nimic. */
export function dragShift(j: number, from: number, to: number, step: number): number {
  if (j === from) return 0
  if (from < to && j > from && j <= to) return -step
  if (from > to && j >= to && j < from) return step
  return 0
}
