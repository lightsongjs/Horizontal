/**
 * Cursorul listei (modul Vim), ca funcții pure peste rândurile de pe ecran.
 *
 * Un rând are id-ul tichetului și cheia grupului în care stă (ziua în „Azi" /
 * „7 zile", layerul în „Listă", proiectul într-un filtru). Rândurile vin în
 * ordinea în care sunt DESENATE — fixatele întâi, restanțele, zilele — deci
 * „următorul" e mereu cel de dedesubt de pe ecran, nu cel din vreo listă de date.
 *
 * Toate întorc id-ul noului cursor, sau null când lista e goală. Un cursor
 * care nu mai e în listă (rândul a ieșit) pornește de la capăt — pentru
 * vecinul celui ieșit e `neighborAfterRemove`.
 */

export interface CursorRow {
  id: string
  group: string
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * `n` rânduri în jos (`d = 1`) sau în sus (`d = -1`), oprit la capete.
 * Fără cursor (sau cu unul ieșit din listă), prima apăsare alege primul rând
 * în jos, ultimul în sus — nu sare peste el.
 */
export function step(rows: CursorRow[], cur: string | null, d: 1 | -1, n = 1): string | null {
  if (!rows.length) return null
  const ix = cur ? rows.findIndex((r) => r.id === cur) : -1
  if (ix < 0) return d > 0 ? rows[0].id : rows[rows.length - 1].id
  return rows[clamp(ix + d * Math.max(1, n), 0, rows.length - 1)].id
}

/** Grupurile, în ordinea de pe ecran, cu rândurile lor. */
function groupsOf(rows: CursorRow[]): CursorRow[][] {
  const out: CursorRow[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last[0].group === r.group) last.push(r)
    else out.push([r])
  }
  return out
}

/**
 * Primul rând din grupul următor / anterior (`J` / `K`), `n` grupuri mai
 * departe. În sus, dintr-un rând care nu e primul al grupului, prima apăsare
 * urcă la capul grupului propriu — ca `{` în Vim.
 */
export function stepGroup(rows: CursorRow[], cur: string | null, d: 1 | -1, n = 1): string | null {
  const gs = groupsOf(rows)
  if (!gs.length) return null
  const gi = cur ? gs.findIndex((g) => g.some((r) => r.id === cur)) : -1
  if (gi < 0) return d > 0 ? gs[0][0].id : gs[gs.length - 1][0].id
  let times = Math.max(1, n)
  let at = gi
  if (d < 0 && gs[gi][0].id !== cur) { at = gi; times -= 1 }
  at = clamp(at + d * times, 0, gs.length - 1)
  return gs[at][0].id
}

export function first(rows: CursorRow[]): string | null {
  return rows[0]?.id ?? null
}

export function last(rows: CursorRow[]): string | null {
  return rows[rows.length - 1]?.id ?? null
}

/**
 * Cursorul era pe `cur`, iar rândul a ieșit (bifat, șters, mutat): unde
 * ajunge. `before` = rândurile de dinainte, `after` = cele de acum. Primul
 * de DEDESUBT care a rămas, altfel primul de deasupra — ca la o listă de
 * fișiere după ștergere. Cursorul încă pe ecran rămâne unde e.
 */
export function neighborAfterRemove(before: CursorRow[], after: CursorRow[], cur: string | null): string | null {
  if (!after.length) return null
  if (cur && after.some((r) => r.id === cur)) return cur
  const alive = new Set(after.map((r) => r.id))
  const ix = cur ? before.findIndex((r) => r.id === cur) : -1
  if (ix < 0) return after[0].id
  for (let k = ix + 1; k < before.length; k++) if (alive.has(before[k].id)) return before[k].id
  for (let k = ix - 1; k >= 0; k--) if (alive.has(before[k].id)) return before[k].id
  return after[0].id
}

/** Intervalul vizual (`v`): rândurile dintre ancoră și cursor, inclusiv, în ordinea de pe ecran. */
export function rangeBetween(rows: CursorRow[], anchor: string | null, cur: string | null): string[] {
  const a = anchor ? rows.findIndex((r) => r.id === anchor) : -1
  const b = cur ? rows.findIndex((r) => r.id === cur) : -1
  if (a < 0 && b < 0) return []
  if (a < 0 || b < 0) return [rows[Math.max(a, b)].id]
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)
}

/** Fără diacritice și fără majuscule: „sedinta" găsește „Ședința". */
export function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Rândurile al căror titlu conține textul căutat (`/`, `f`). Text gol = niciunul. */
export function matching(rows: (CursorRow & { title: string })[], query: string): string[] {
  const q = foldText(query.trim())
  if (!q) return []
  return rows.filter((r) => foldText(r.title).includes(q)).map((r) => r.id)
}

/**
 * Potrivirea următoare (`n`) / anterioară (`N`) față de cursor, cu ocolire la
 * capăt — ca în Vim, unde căutarea se reia de sus. Fără cursor, prima / ultima.
 */
export function nextMatch(rows: CursorRow[], matches: string[], cur: string | null, d: 1 | -1, n = 1): string | null {
  const set = new Set(matches)
  const hits = rows.filter((r) => set.has(r.id)).map((r) => r.id)
  if (!hits.length) return null
  let at = cur ? rows.findIndex((r) => r.id === cur) : -1
  let pick: string | null = null
  for (let k = 0; k < Math.max(1, n); k++) {
    const after = rows.slice(at + 1).find((r) => set.has(r.id))?.id
    const before = [...rows.slice(0, Math.max(0, at))].reverse().find((r) => set.has(r.id))?.id
    pick = d > 0 ? (after ?? hits[0]) : (at < 0 ? hits[hits.length - 1] : (before ?? hits[hits.length - 1]))
    at = rows.findIndex((r) => r.id === pick)
  }
  return pick
}
