/**
 * Modul „× Valuri” din tabul Teme (H-13): tichetele pe rânduri, grupate pe
 * teme, valurile pe coloane. Regulile, pure; componenta e `WaveGrid.tsx`.
 *
 * Nimic nou în bază: rândul e un tichet, grupul e tema lui, coloana e un val,
 * punctul e `issue.wave`. Singurul comportament nou e avertismentul pe
 * dependențe (`depWarning`) — doar informație, nu blochează nimic, fiindcă
 * dependențele dintre valuri nu blochează nicăieri în aplicație.
 */
import type { Issue, Theme, Wave } from './types'
import { isTempIssueId } from './issueId'

/** Ordinea naturală a numelor: „Pasul 2” înaintea lui „Pasul 10”; fără majuscule, ș după s (româna). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'ro', { numeric: true, sensitivity: 'base' })
}

/** Coloanele: Notițele (valul 0) primele, ca în banda de valuri, apoi valurile după `position`. */
export function gridColumns(waves: Wave[]): Wave[] {
  const notes = waves.filter((w) => w.number === 0)
  const rest = waves.filter((w) => w.number !== 0).sort((a, b) => a.position - b.position)
  return [...notes, ...rest]
}

/** Numărul din ID (`HZ-12` → 12), ca rândurile să stea în ordinea creării; provizoriile la coadă. */
function idNumber(id: string): number {
  if (isTempIssueId(id)) return Number.POSITIVE_INFINITY
  const m = /-(\d+)$/.exec(id)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

/**
 * Ordinea rândurilor într-o temă: după ID, stabilă. Nu după layer — layerul
 * se mișcă la o mutare, iar rândul ar sări de sub cursor.
 */
export function compareRows(a: Issue, b: Issue): number {
  return idNumber(a.id) - idNumber(b.id) || a.id.localeCompare(b.id)
}

export const NO_THEME_KEY = ''

export interface GridGroup {
  /** Cheia temei; `''` = „Fără temă”. */
  key: string
  name: string
  color: string
  ids: string[]
}

/**
 * Grupurile, în ordinea naturală a numelor temelor, cu „Fără temă” ultima.
 * `filter` = cheia temei alese în jetoane (`'all'` = toate); o temă aleasă
 * se arată și goală, ca în lista temelor. Un tichet cu o temă ștearsă cade
 * în „Fără temă”, ca în tabul Teme.
 */
export function gridGroups(
  themes: Theme[],
  issues: Issue[],
  opts: { filter: string; hideDone: boolean },
): GridGroup[] {
  const known = new Set(themes.map((t) => t.key))
  const shown = issues.filter((i) => !(opts.hideDone && i.done))
  const sorted = [...themes].sort((a, b) => naturalCompare(a.name, b.name))
  const out: GridGroup[] = []
  for (const t of sorted) {
    if (opts.filter !== 'all' && opts.filter !== t.key) continue
    const ids = shown.filter((i) => i.theme === t.key).sort(compareRows).map((i) => i.id)
    if (!ids.length && opts.filter === 'all') continue
    out.push({ key: t.key, name: t.name, color: t.color, ids })
  }
  if (opts.filter === 'all') {
    const ids = shown.filter((i) => !i.theme || !known.has(i.theme)).sort(compareRows).map((i) => i.id)
    if (ids.length) out.push({ key: NO_THEME_KEY, name: 'Fără temă', color: 'var(--txt-faint)', ids })
  }
  return out
}

/**
 * Valul în care ajunge tichetul la `h` / `l` (`d` = -1 / 1), oprit la capete.
 * `null` = nu se mișcă (e deja la capăt, sau valul lui nu e o coloană).
 */
export function stepWave(columns: Wave[], current: number, d: -1 | 1): number | null {
  const ix = columns.findIndex((w) => w.number === current)
  if (ix < 0) return null
  const next = columns[ix + d]
  return next ? next.number : null
}

/** Valul de la capăt: `0` = Notițe (prima coloană), `$` = ultimul val. */
export function edgeWave(columns: Wave[], which: 'first' | 'last'): number | null {
  const w = which === 'first' ? columns[0] : columns[columns.length - 1]
  return w ? w.number : null
}

export interface DepWarning {
  /** Dependența care vine mai târziu (sau e încă nehotărâtă, în Notițe). */
  id: string
  wave: number
}

/**
 * Tichetul e pus într-un val mai devreme decât o dependență DESCHISĂ a lui,
 * sau dependența e încă în Notițe („nehotărât”). Ordinea valurilor e
 * `position` (coloanele), nu `number`. Tichetul din Notițe nu avertizează —
 * nici el nu e hotărât. Dependențele din alt proiect nu contează: valurile
 * lor nu se compară cu ale noastre.
 */
export function depWarning(issue: Issue, byId: Record<string, Issue | undefined>, columns: Wave[]): DepWarning | null {
  if (issue.wave === 0) return null
  const rank = (n: number) => columns.findIndex((w) => w.number === n)
  const mine = rank(issue.wave)
  if (mine < 0) return null
  for (const id of issue.deps) {
    const dep = byId[id]
    if (!dep || dep.done || dep.projectId !== issue.projectId) continue
    if (dep.wave === 0 || rank(dep.wave) > mine) return { id: dep.id, wave: dep.wave }
  }
  return null
}

/** Câte tichete DESCHISE are fiecare val, printre `issues` (antetul coloanei, capul grupului). */
export function openCounts(issues: Issue[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const i of issues) if (!i.done) m.set(i.wave, (m.get(i.wave) ?? 0) + 1)
  return m
}

/** Numele scurt al valului în antet: „Notițe” pentru 0, altfel numele lui („Val 1”, „II”). */
export function waveTitle(w: Wave): string {
  return w.number === 0 ? (w.label.trim() || 'Notițe') : w.name
}
