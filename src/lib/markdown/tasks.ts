import { mdParser } from './parse'

/**
 * Operațiile pe textul descrierii. Toate lucrează pe string și întorc string:
 * editorul le aplică prin `minimalChange`, cititorul le trimite ca patch. Nu
 * „curăță" nimic în afara liniei atinse — textul omului rămâne al lui.
 */

export type Edit = { text: string; anchor: number; head?: number }

/** Prefixul unui element de listă: citat?, indentare, marcaj, spațiu, căsuță?. */
const ITEM = /^((?:[ \t]*>)*[ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/
const TASK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/

function lineAt(text: string, pos: number) {
  const from = text.lastIndexOf('\n', pos - 1) + 1
  let to = text.indexOf('\n', pos)
  if (to < 0) to = text.length
  // `\r` din CRLF nu e conținut: rămâne neatins la capătul rândului.
  const end = text[to - 1] === '\r' ? to - 1 : to
  return { from, to: end, text: text.slice(from, end) }
}

export function toggleTask(text: string, pos: number): string {
  const line = lineAt(text, pos)
  const m = TASK.exec(line.text)
  if (!m) return text
  const i = line.from + m[1].length + 1
  return text.slice(0, i) + (m[2] === ' ' ? 'x' : ' ') + text.slice(i + 1)
}

export function taskProgress(text: string): { done: number; total: number } {
  if (!/\[[ xX]\]/.test(text)) return { done: 0, total: 0 }
  let done = 0, total = 0
  mdParser.parse(text).iterate({
    enter(n) {
      if (n.name !== 'TaskMarker') return
      total++
      if (text[n.from + 1] !== ' ') done++
    },
  })
  return { done, total }
}

export function continueList(text: string, pos: number): Edit | null {
  const line = lineAt(text, pos)
  const m = ITEM.exec(line.text)
  if (!m || pos < line.from + m[0].length || pos > line.to) return null
  const content = line.text.slice(m[0].length)
  if (content.trim() === '' && pos === line.to) {
    return { text: text.slice(0, line.from) + text.slice(line.to), anchor: line.from }
  }
  const num = /^\d+/.exec(m[2])
  const mark = num ? `${Number(num[0]) + 1}${m[2].slice(num[0].length)}` : m[2]
  const insert = `\n${m[1]}${mark}${m[3]}${m[4] ? '[ ] ' : ''}`
  return { text: text.slice(0, pos) + insert + text.slice(pos), anchor: pos + insert.length }
}

export function removeMarker(text: string, pos: number): Edit | null {
  const line = lineAt(text, pos)
  const m = ITEM.exec(line.text)
  if (!m || pos !== line.from + m[0].length) return null
  const indent = /^[ \t]*/.exec(m[1])![0]
  if (indent.length > 0 && !m[1].includes('>')) {
    const cut = indent.startsWith('\t') ? 1 : Math.min(2, indent.length)
    return { text: text.slice(0, line.from) + text.slice(line.from + cut), anchor: pos - cut }
  }
  return {
    text: text.slice(0, line.from) + m[1] + text.slice(line.from + m[0].length),
    anchor: line.from + m[1].length,
  }
}

/** Aplică `fn` pe fiecare linie din [from, to] și mută capetele selecției cu ea. */
function mapLines(text: string, from: number, to: number, fn: (line: string) => string): Edit {
  const first = lineAt(text, from).from
  const last = lineAt(text, to)
  const lines = text.slice(first, last.to).split('\n')
  let shift = 0, a = from, h = to
  let at = first
  const out = lines.map((l) => {
    const cr = l.endsWith('\r') ? '\r' : ''
    const body = cr ? l.slice(0, -1) : l
    const next = fn(body)
    const d = next.length - body.length
    // Un capăt de pe linia asta se mută cu diferența, dar nu sub începutul liniei.
    if (from >= at && from <= at + body.length) a = Math.max(at + shift, from + shift + d)
    if (to >= at && to <= at + body.length) h = Math.max(at + shift, to + shift + d)
    at += l.length + 1
    shift += d
    return next + cr
  })
  const res = text.slice(0, first) + out.join('\n') + text.slice(last.to)
  return from === to ? { text: res, anchor: a } : { text: res, anchor: a, head: h }
}

export function toggleLinePrefix(text: string, from: number, to: number, kind: 'task' | 'bullet'): Edit {
  return mapLines(text, from, to, (line) => {
    const m = ITEM.exec(line)
    if (kind === 'task') {
      if (m?.[4]) return m[1] + line.slice(m[0].length)
      if (m) return m[1] + m[2] + m[3] + '[ ] ' + line.slice(m[0].length)
      const ind = /^[ \t]*/.exec(line)![0]
      return ind + '- [ ] ' + line.slice(ind.length)
    }
    if (m) return m[1] + line.slice(m[0].length)
    const ind = /^[ \t]*/.exec(line)![0]
    return ind + '- ' + line.slice(ind.length)
  })
}

export function indentLines(text: string, from: number, to: number, dir: 1 | -1): Edit | null {
  let any = false
  const r = mapLines(text, from, to, (line) => {
    if (!ITEM.exec(line)) return line
    if (dir === 1) { any = true; return '  ' + line }
    const cut = line.startsWith('\t') ? 1 : line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0
    if (cut) any = true
    return line.slice(cut)
  })
  return any ? r : null
}

export function toggleWrap(text: string, from: number, to: number, mark: '**' | '*'): Edit {
  const n = mark.length
  if (from === to) return { text: text.slice(0, from) + mark + mark + text.slice(to), anchor: from + n }
  if (text.slice(from - n, from) === mark && text.slice(to, to + n) === mark) {
    return { text: text.slice(0, from - n) + text.slice(from, to) + text.slice(to + n), anchor: from - n, head: to - n }
  }
  return { text: text.slice(0, from) + mark + text.slice(from, to) + mark + text.slice(to), anchor: from + n, head: to + n }
}

export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null
  let s = 0
  const max = Math.min(a.length, b.length)
  while (s < max && a[s] === b[s]) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
  return { from: s, to: ea, insert: b.slice(s, eb) }
}
