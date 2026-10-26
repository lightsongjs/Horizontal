import type { Align } from './blocks'

/**
 * Tabelul ca date, pentru editarea pe celule (`livePreview`): textul brut al
 * fiecărei celule (markdown inline, cu `\|` deja desfăcut în `|`), rândul 0 =
 * antetul. Pur, ca să se testeze fără DOM.
 *
 * La scriere tabelul se rescrie în forma minimă (`| a | b |`, fără spații de
 * aliniere): o tastă schimbă câteva caractere, nu tot tabelul, iar un tabel
 * scris de o unealtă se normalizează abia la prima editare a omului.
 */
export type TableModel = { align: Align[]; rows: string[][] }

/** O linie de tabel → celulele ei. Barele de la capete sunt opționale (GFM). */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue }
    if (ch === '|') { cells.push(cur); cur = ''; continue }
    cur += ch
  }
  cells.push(cur)
  const t = line.trim()
  if (t.startsWith('|')) cells.shift()
  if (t.endsWith('|') && !t.endsWith('\\|')) cells.pop()
  return cells.map((c) => c.trim())
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(':'), r = cell.endsWith(':')
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null
}

/** Sursa unui tabel (rândurile lui, fără nimic în jur) → model. */
export function parseTable(src: string): TableModel | null {
  const lines = src.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines.length < 2) return null
  const head = splitRow(lines[0])
  const n = head.length
  if (!n) return null
  const delim = splitRow(lines[1])
  const fit = (r: string[]) => Array.from({ length: n }, (_, i) => r[i] ?? '')
  return {
    align: Array.from({ length: n }, (_, i) => (delim[i] ? alignOf(delim[i]) : null)),
    rows: [head, ...lines.slice(2).filter((l) => l.trim()).map((l) => fit(splitRow(l)))],
  }
}

const DELIM: Record<string, string> = { left: ':---', center: ':---:', right: '---:', none: '---' }

/**
 * Rândul nou dintr-o celulă. GFM nu-l poate ține în sursă (rândul de tabel e o
 * singură linie), deci convenția e `<br>` — singurul HTML pe care îl
 * desenăm, și numai în celule. Câmpul celulei arată un rând nou adevărat:
 * `cellIn` la deschidere, `cellOut` la scriere.
 */
const BR = /<br\s*\/?>/gi
export const isBrTag = (s: string) => /^<br\s*\/?>$/i.test(s)

/** Markdown-ul celulei → textul din câmp (`<br>`, `<br/>`, `<BR />` → rând nou). */
export const cellIn = (c: string) => c.replace(BR, '\n')

/** Textul din câmp → markdown-ul celulei: rândul nou devine `<br>`, `|` se scapă. */
export const cellOut = (c: string) => c.replace(/\r\n?|\n/g, '<br>').replace(/\|/g, '\\|').trim()

export function formatTable(m: TableModel): string {
  const row = (cells: string[]) => `| ${cells.map(cellOut).join(' | ')} |`
  return [
    row(m.rows[0]),
    `| ${m.align.map((a) => DELIM[a ?? 'none']).join(' | ')} |`,
    ...m.rows.slice(1).map(row),
  ].join('\n')
}

export function newTable(cols = 3, bodyRows = 2): string {
  const empty = Array.from({ length: cols }, () => '')
  return formatTable({ align: empty.map(() => null), rows: Array.from({ length: bodyRows + 1 }, () => [...empty]) })
}

const clone = (m: TableModel): TableModel => ({ align: [...m.align], rows: m.rows.map((r) => [...r]) })

export function setCell(m: TableModel, r: number, c: number, text: string): TableModel {
  const n = clone(m)
  n.rows[r][c] = text
  return n
}

/** Rând gol pe poziția `at` (≥ 1: antetul rămâne primul). */
export function insertRow(m: TableModel, at: number): TableModel {
  const n = clone(m)
  n.rows.splice(Math.max(1, Math.min(at, n.rows.length)), 0, m.align.map(() => ''))
  return n
}

export function insertCol(m: TableModel, at: number): TableModel {
  const n = clone(m)
  const i = Math.max(0, Math.min(at, n.align.length))
  n.align.splice(i, 0, null)
  for (const r of n.rows) r.splice(i, 0, '')
  return n
}

/** Antetul nu se șterge (fără el nu mai e tabel). */
export function deleteRow(m: TableModel, r: number): TableModel {
  if (r < 1 || r >= m.rows.length) return m
  const n = clone(m)
  n.rows.splice(r, 1)
  return n
}

/** Ultima coloană nu se șterge — „Șterge tabelul” e altă comandă. */
export function deleteCol(m: TableModel, c: number): TableModel {
  if (m.align.length <= 1 || c < 0 || c >= m.align.length) return m
  const n = clone(m)
  n.align.splice(c, 1)
  for (const r of n.rows) r.splice(c, 1)
  return n
}

export function setAlign(m: TableModel, c: number, a: Align): TableModel {
  const n = clone(m)
  n.align[c] = a
  return n
}

/**
 * Golurile dintre bare ale fiecărui rând, ca poziții în `src` (rândul 0 =
 * antetul; rândul de aliniere nu are celule). Barele de la capete nu
 * deschid o celulă.
 */
function cellGaps(src: string): [number, number][][] {
  const out: [number, number][][] = []
  let start = 0
  src.split('\n').forEach((line, li) => {
    const base = start
    start += line.length + 1
    if (li === 1 || (li > 1 && !line.trim())) return
    const end = line.replace(/\r$/, '').length
    const bars: number[] = []
    for (let i = 0; i < end; i++) {
      if (line[i] === '\\') { i++; continue }
      if (line[i] === '|') bars.push(i)
    }
    const lead = line.length - line.trimStart().length
    const trail = line.slice(0, end).trimEnd().length
    const edges: [number, number][] = []
    let pos = 0
    for (const b of bars) { edges.push([pos, b]); pos = b + 1 }
    edges.push([pos, end])
    if (bars[0] === lead) edges.shift()
    if (bars.length && bars[bars.length - 1] === trail - 1) edges.pop()
    out.push(edges.map(([a, b]) => [base + a, base + b]))
  })
  return out
}

/**
 * Scrierea unei celule în sursă, fără să atingă restul tabelului: un tabel
 * aliniat de om sau de o unealtă rămâne aliniat (documentul ESTE stringul),
 * iar tastele vecine sunt schimbări alăturate — anularea le grupează ca la
 * scrisul obișnuit. `null` = celula nu există în sursă (rând scurt): atunci
 * apelantul rescrie tabelul cu `formatTable`.
 */
export function editCell(src: string, r: number, c: number, text: string): string | null {
  const gap = cellGaps(src)[r]?.[c]
  if (!gap) return null
  const [a, b] = gap
  const raw = src.slice(a, b)
  const v = cellOut(text)
  if (!raw.trim()) return src.slice(0, a) + (v ? ` ${v} ` : raw || ' ') + src.slice(b)
  const s = a + (raw.length - raw.trimStart().length)
  const e = a + raw.trimEnd().length
  if (!v) return src.slice(0, a) + ' ' + src.slice(b)
  return src.slice(0, s) + v + src.slice(e)
}
