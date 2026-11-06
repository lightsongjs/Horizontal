// Sarcinile fixate („Fixează sus", ca Pin din TickTick). Reguli pure, fără
// React și fără I/O — testate în `pinned.test.ts`. Spec:
// docs/superpowers/specs/2026-10-17-sarcini-fixate-design.md
//
// NU e același lucru cu `pins.ts`: acolo sunt pătratele fixate din sertar
// (proiecte, liste, filtre — ale contului, în `pinned_items`). Aici e un câmp
// al tichetului, `issues.pinned_at`, deci un patch de tichet ca oricare altul
// (merge offline prin coadă, ca bifa sau urgentul).
//
// Regula (ca Pin din TickTick, decizia omului 2026-10-17, a doua versiune):
// fixarea doar ORDONEAZĂ — urcă tichetul în vârful unei liste din care face
// oricum parte. Nu aduce niciodată un tichet într-o listă.

import type { Issue } from './types'

/** Fixat = are `pinnedAt`. Un tichet bifat rămâne fixat, dar nu se arată sus. */
export function isPinned(issue: Pick<Issue, 'pinnedAt'>): boolean {
  return !!issue.pinnedAt
}

/** Fixat ȘI deschis: singurul fel care urcă sus într-o listă. */
export function isPinnedOpen(issue: Pick<Issue, 'pinnedAt' | 'done'>): boolean {
  return !issue.done && isPinned(issue)
}

/**
 * Ordinea între fixate: cel fixat cel mai RECENT primul (ca o stivă — ce ai
 * pus acum sus e ce te interesează acum). La egalitate, după ID, ca ordinea
 * să nu sară între randări. Din 2026-11-06 ordinea se și TRAGE de mână
 * (`movePinned`), tot prin `pinnedAt` — regula de aici nu se schimbă.
 */
export function comparePinned(a: Pick<Issue, 'pinnedAt' | 'id'>, b: Pick<Issue, 'pinnedAt' | 'id'>): number {
  const at = a.pinnedAt ? Date.parse(a.pinnedAt) : 0
  const bt = b.pinnedAt ? Date.parse(b.pinnedAt) : 0
  if (at !== bt) return bt - at
  return a.id.localeCompare(b.id)
}

/** Pasul dintre două fixate când nu se poate pune la mijloc (capăt de jos, renumerotare). */
export const PIN_STEP_MS = 1000

/**
 * Ordinea manuală a fixatelor (2026-11-06): mută `id` pe poziția `to` din
 * `rows` (lista AFIȘATĂ, deja în ordinea `comparePinned`) și întoarce noile
 * `pinnedAt`, numai pentru ce se schimbă.
 *
 * De ce tot `pinnedAt` și nu o coloană `pin_order`: fiecare loc care arată
 * fixatele le ordonează DEJA după el, descrescător — pagina (Azi, 7 zile,
 * filtre, Listă), cutia de Linux (care încarcă pagina) și citirea nativă de
 * Android (`pinnedOrder` din `Agenda.kt`, widget-ul). Un timestamp pus între
 * cei doi vecini e deci o ordine nouă pe toate dispozitivele, fără migrare și
 * fără APK, iar patch-ul merge prin coada offline ca o fixare obișnuită.
 * `pinnedAt` nu se afișează nicăieri ca dată, deci nu minte pe nimeni.
 *
 * - Sus: după cel de dedesubt și cel puțin „acum" (ca o fixare nouă).
 * - Jos: cu un pas sub cel de deasupra.
 * - Între: la mijloc (milisecunde întregi — `Date` nu ține mai fin).
 * - Fără loc la mijloc (vecini la < 2 ms, sau egali): renumerotează lista
 *   afișată de sus în jos, cu câte un pas; rar — cere ~15 mutări la rând în
 *   aceeași fantă.
 */
export function movePinned<T extends Pick<Issue, 'id' | 'pinnedAt'>>(
  rows: readonly T[],
  id: string,
  to: number,
  now: Date,
): Array<{ id: string; pinnedAt: string }> {
  const from = rows.findIndex((r) => r.id === id)
  if (from < 0) return []
  const rest = rows.filter((r) => r.id !== id)
  const at = Math.max(0, Math.min(to, rest.length))
  if (at === from) return []
  const ms = (r: T) => (r.pinnedAt ? Date.parse(r.pinnedAt) : 0)
  const above = rest[at - 1]
  const below = rest[at]
  let next: number | null = null
  if (!above) next = Math.max(now.getTime(), ms(below) + 1)
  else if (!below) next = ms(above) - PIN_STEP_MS
  else if (ms(above) - ms(below) >= 2) next = Math.floor((ms(above) + ms(below)) / 2)
  if (next !== null) return [{ id, pinnedAt: new Date(next).toISOString() }]

  const order = [...rest.slice(0, at), rows[from], ...rest.slice(at)]
  const top = ms(order[0])
  return order
    .map((r, i) => ({ r, next: top - i * PIN_STEP_MS }))
    .filter(({ r, next: n }) => ms(r) !== n || !r.pinnedAt)
    .map(({ r, next: n }) => ({ id: r.id, pinnedAt: new Date(n).toISOString() }))
}

/** Patch-ul comutatorului: fixează acum, sau scoate fixarea. */
export function pinPatch(issue: Pick<Issue, 'pinnedAt'>, now: Date): Pick<Issue, 'pinnedAt'> {
  return { pinnedAt: issue.pinnedAt ? null : now.toISOString() }
}

/**
 * Fixatele deschise urcă primele, în ordinea `comparePinned`; restul își
 * păstrează ordinea primită (sortarea e stabilă). Pentru „Listă" dintr-un
 * proiect: în fiecare grup (layer, temă), nu peste grupuri.
 */
export function pinnedFirst<T extends Pick<Issue, 'pinnedAt' | 'done' | 'id'>>(issues: T[]): T[] {
  const top = issues.filter(isPinnedOpen).sort(comparePinned)
  if (!top.length) return issues
  return [...top, ...issues.filter((i) => !isPinnedOpen(i))]
}

/**
 * Grupul unei zile (Restanțe, Azi, ziua din „7 zile") fără fixatele lui: ele
 * stau deja în grupul „Fixate" de deasupra (`SmartLists.pinned`/`weekPinned`).
 * Numai ce se ARATĂ — numerele numără lista întreagă, ca fără fixare.
 */
export function unpinned<T extends Pick<Issue, 'pinnedAt' | 'done'>>(issues: T[]): T[] {
  return issues.some(isPinnedOpen) ? issues.filter((i) => !isPinnedOpen(i)) : issues
}
