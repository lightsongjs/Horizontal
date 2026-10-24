import { mdParser } from './parse'
import { refPattern, safeHref } from './safeUrl'

/**
 * Ce face editorul cu fiecare bucată de text — pur, ca să se testeze fără DOM.
 * Stratul CodeMirror (`livePreview.ts`) doar traduce în `Decoration`.
 *
 * Regula de bază (spec): marcajele de BLOC — bulina, căsuța — se desenează
 * mereu, și pe linia cu cursorul, altfel rândul ar sări sub deget. Sintaxa
 * INLINE (`**`, `` ` ``, `[]()`, `## `, `> `) se ascunde doar pe liniile fără
 * cursor (`reveal`).
 *
 * Un rând de listă e desenat ca în cititor: marcajul (căsuță, bulină, număr)
 * stă într-o coloană de lățime fixă (`--md-gutter`), iar textul — și rândurile
 * lui rupte — pornesc după ea. De-aia marcajul înghite indentarea dinaintea lui
 * și spațiul de după (adâncimea o poartă linia, `--md-depth`): lățimea unui
 * spațiu depinde de font, a coloanei nu.
 */
export type DecoSpec =
  | { k: 'hide'; from: number; to: number }
  | { k: 'mark'; from: number; to: number; cls: string; attrs?: Record<string, string> }
  | { k: 'line'; at: number; cls: string; attrs?: Record<string, string> }
  | { k: 'bullet'; from: number; to: number }
  | { k: 'num'; from: number; to: number; text: string }
  | { k: 'task'; from: number; to: number; checked: boolean }
  | { k: 'hr'; from: number; to: number }

const HEAD: Record<string, string> = {
  ATXHeading1: 'md-h1', ATXHeading2: 'md-h2', ATXHeading3: 'md-h3', ATXHeading4: 'md-h3', ATXHeading5: 'md-h3', ATXHeading6: 'md-h3',
  SetextHeading1: 'md-h1', SetextHeading2: 'md-h2',
}
const INLINE: Record<string, string> = { StrongEmphasis: 'md-strong', Emphasis: 'md-em', Strikethrough: 'md-del', InlineCode: 'md-code' }

export function decorationSpecs(text: string, reveal: ReadonlySet<number>, prefixes: readonly string[]): DecoSpec[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const lineOf = (pos: number) => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo
  }
  const shown = (from: number, to: number) => {
    for (let l = lineOf(from); l <= lineOf(to); l++) if (reveal.has(l)) return true
    return false
  }
  const out: DecoSpec[] = []
  const hide = (from: number, to: number) => {
    if (to > from && !text.slice(from, to).includes('\n') && !shown(from, to)) out.push({ k: 'hide', from, to })
  }
  const lines = (from: number, to: number, cls: string) => {
    for (let l = lineOf(from); l <= lineOf(to); l++) out.push({ k: 'line', at: starts[l], cls })
  }
  const noRef: [number, number][] = []
  const scan: [number, number][] = []

  mdParser.parse(text).iterate({
    enter(n) {
      const name = n.name
      if (HEAD[name]) {
        lines(n.from, n.from, HEAD[name])
        scan.push([n.from, n.to])
        return
      }
      if (INLINE[name]) {
        out.push({ k: 'mark', from: n.from, to: n.to, cls: INLINE[name] })
        if (name === 'InlineCode') noRef.push([n.from, n.to])
        return
      }
      switch (name) {
        case 'HeaderMark': {
          const atx = n.node.parent?.name.startsWith('ATX')
          hide(n.from, atx && text[n.to] === ' ' ? n.to + 1 : n.to)
          return
        }
        case 'EmphasisMark':
        case 'StrikethroughMark':
          hide(n.from, n.to)
          return
        case 'CodeMark':
          if (n.node.parent?.name === 'InlineCode') hide(n.from, n.to)
          return
        case 'Link': {
          const marks = n.node.getChildren('LinkMark')
          const url = n.node.getChild('URL')
          const href = url ? safeHref(text.slice(url.from, url.to)) : null
          out.push(href
            ? { k: 'mark', from: n.from, to: n.to, cls: 'md-link', attrs: { 'data-href': href } }
            : { k: 'mark', from: n.from, to: n.to, cls: 'md-link' })
          if (marks[0]) hide(marks[0].from, marks[0].to)
          if (marks[1]) hide(marks[1].from, n.to)
          noRef.push([n.from, n.to])
          return
        }
        case 'URL': {
          const p = n.node.parent?.name
          if (p === 'Link') return
          const href = safeHref(text.slice(n.from, n.to))
          if (href) out.push({ k: 'mark', from: n.from, to: n.to, cls: 'md-link', attrs: { 'data-href': href } })
          noRef.push([n.from, n.to])
          return
        }
        case 'ListMark': {
          // Indentarea dinainte intră în marcaj doar dacă e numai spații —
          // într-un citat (`> - a`) rândul rămâne cum era.
          const ls = starts[lineOf(n.from)]
          const lead = /^[ \t]*$/.test(text.slice(ls, n.from)) ? ls : n.from
          let depth = -1
          for (let p = n.node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') depth++
          const line = (kind: string, extra = '') => {
            if (lead === ls) out.push({ k: 'line', at: ls, cls: `md-li md-li-${kind}${extra}`, attrs: { style: `--md-depth:${Math.max(0, depth)}` } })
          }
          const space = (at: number) => (text[at] === ' ' || text[at] === '\t' ? at + 1 : at)
          const next = n.node.nextSibling
          if (next?.name === 'Task') {
            const m = next.getChild('TaskMarker')!
            const checked = text[m.from + 1] !== ' '
            const to = space(m.to)
            out.push({ k: 'task', from: lead, to, checked })
            line('task', checked ? ' md-li-done' : '')
            if (checked && to < next.to) out.push({ k: 'mark', from: to, to: next.to, cls: 'md-done' })
          } else if (/[-*+]/.test(text[n.from])) {
            out.push({ k: 'bullet', from: lead, to: space(n.to) })
            line('bullet')
          } else {
            out.push({ k: 'num', from: lead, to: space(n.to), text: text.slice(n.from, n.to) })
            line('num')
          }
          return
        }
        case 'Task':
        case 'Paragraph':
          scan.push([n.from, n.to])
          return
        case 'Blockquote':
          lines(n.from, n.to, 'md-quote')
          return
        case 'QuoteMark':
          hide(n.from, text[n.to] === ' ' ? n.to + 1 : n.to)
          return
        case 'FencedCode':
        case 'CodeBlock':
          lines(n.from, n.to, 'md-pre')
          noRef.push([n.from, n.to])
          return false
        case 'Table':
          // Fără cursor în el, tabelul e un widget desenat (`livePreview`);
          // cu cursorul, textul lui brut, pe coloane drepte.
          lines(n.from, n.to, 'md-table-src')
          noRef.push([n.from, n.to])
          return false
        case 'HorizontalRule':
          if (!shown(n.from, n.to)) out.push({ k: 'hr', from: n.from, to: n.to })
          return
      }
    },
  })

  const refs = refPattern(prefixes)
  if (refs) {
    for (const [from, to] of scan) {
      for (const m of text.slice(from, to).matchAll(refs)) {
        const a = from + m.index!, b = a + m[0].length
        if (noRef.some(([x, y]) => a < y && b > x)) continue
        out.push({ k: 'mark', from: a, to: b, cls: 'md-ref', attrs: { 'data-ref': m[0] } })
      }
    }
  }
  return out
}
