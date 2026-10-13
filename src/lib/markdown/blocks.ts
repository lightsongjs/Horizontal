import type { SyntaxNode } from '@lezer/common'
import { mdParser } from './parse'
import { refPattern, safeHref } from './safeUrl'

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'br' }
  | { t: 'strong' | 'em' | 'del'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'ref'; id: string }

export type Item = { task: null | { checked: boolean; at: number }; children: Block[] }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'p'; children: Inline[] }
  | { t: 'ul' | 'ol'; start: number; items: Item[] }
  | { t: 'quote'; children: Block[] }
  | { t: 'pre'; text: string }
  | { t: 'hr' }

const MARKS = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'TaskMarker', 'ListMark', 'StrikethroughMark'])

/**
 * Text simplu → noduri: un `\n` e rând nou (`br`, ca în Obsidian — altfel
 * descrierile vechi s-ar lipi într-un paragraf), iar indentarea de după el
 * (continuarea unui element de listă) nu e conținut.
 */
function pushText(out: Inline[], s: string, refs: RegExp | null) {
  s.split('\n').forEach((piece, i) => {
    if (i > 0) out.push({ t: 'br' })
    const txt = i > 0 ? piece.replace(/^[ \t]+/, '') : piece
    if (!txt) return
    if (!refs) { out.push({ t: 'text', text: txt }); return }
    let last = 0
    for (const m of txt.matchAll(refs)) {
      if (m.index! > last) out.push({ t: 'text', text: txt.slice(last, m.index) })
      out.push({ t: 'ref', id: m[0] })
      last = m.index! + m[0].length
    }
    if (last < txt.length) out.push({ t: 'text', text: txt.slice(last) })
  })
  // Lipește textele vecine (un `Escape` sau o potrivire spartă le-ar fragmenta).
  for (let i = out.length - 1; i > 0; i--) {
    const a = out[i - 1], b = out[i]
    if (a.t === 'text' && b.t === 'text') { a.text += b.text; out.splice(i, 1) }
  }
}

/** Fără spațiile și rândurile goale de la capete (titluri, rândul unei căsuțe). */
function trimEdges(list: Inline[]): Inline[] {
  while (list[0]?.t === 'br') list.shift()
  while (list[list.length - 1]?.t === 'br') list.pop()
  const first = list[0], last = list[list.length - 1]
  if (first?.t === 'text') first.text = first.text.replace(/^\s+/, '')
  if (last?.t === 'text') last.text = last.text.replace(/\s+$/, '')
  return list.filter((x) => x.t !== 'text' || x.text !== '')
}

function pushLink(out: Inline[], raw: string, label: Inline[], refs: RegExp | null) {
  const href = safeHref(raw)
  if (href) out.push({ t: 'link', href, children: label })
  else for (const x of label) x.t === 'text' ? pushText(out, x.text, refs) : out.push(x)
}

function inlines(node: SyntaxNode, from: number, to: number, src: string, refs: RegExp | null): Inline[] {
  const out: Inline[] = []
  let pos = from
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.to <= from) continue
    if (c.from >= to) break
    if (c.from > pos) pushText(out, src.slice(pos, c.from), refs)
    pos = Math.max(pos, c.to)
    switch (c.name) {
      case 'StrongEmphasis': out.push({ t: 'strong', children: inlines(c, c.from, c.to, src, refs) }); break
      case 'Emphasis': out.push({ t: 'em', children: inlines(c, c.from, c.to, src, refs) }); break
      case 'Strikethrough': out.push({ t: 'del', children: inlines(c, c.from, c.to, src, refs) }); break
      case 'InlineCode': {
        const open = c.firstChild!, close = c.lastChild!
        out.push({ t: 'code', text: src.slice(open.to, close === open ? c.to : close.from) })
        break
      }
      case 'Link': {
        const marks: SyntaxNode[] = []
        let url: SyntaxNode | null = null
        for (let k = c.firstChild; k; k = k.nextSibling) {
          if (k.name === 'LinkMark') marks.push(k)
          else if (k.name === 'URL') url = k
        }
        const labelTo = marks[1]?.from ?? c.to
        const label = inlines(c, marks[0].to, labelTo, src, null)
        if (url) pushLink(out, src.slice(url.from, url.to), label, refs)
        else pushText(out, src.slice(c.from, c.to), refs)
        break
      }
      case 'URL': {
        const raw = src.slice(c.from, c.to)
        pushLink(out, raw, [{ t: 'text', text: raw }], refs)
        break
      }
      case 'Autolink': {
        const u = c.getChild('URL')
        const raw = u ? src.slice(u.from, u.to) : src.slice(c.from + 1, c.to - 1)
        pushLink(out, raw, [{ t: 'text', text: raw }], refs)
        break
      }
      case 'Escape': pushText(out, src.slice(c.from + 1, c.to), refs); break
      case 'HardBreak': out.push({ t: 'br' }); break
      default:
        if (!MARKS.has(c.name)) pushText(out, src.slice(c.from, c.to), refs)
    }
  }
  if (to > pos) pushText(out, src.slice(pos, to), refs)
  return out
}

const LEVEL: Record<string, 1 | 2 | 3> = {
  ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3, ATXHeading4: 3, ATXHeading5: 3, ATXHeading6: 3,
  SetextHeading1: 1, SetextHeading2: 2,
}

function item(li: SyntaxNode, src: string, refs: RegExp | null): Item {
  let task: Item['task'] = null
  const children: Block[] = []
  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (c.name === 'ListMark') continue
    if (c.name === 'Task') {
      const m = c.getChild('TaskMarker')!
      task = { checked: src[m.from + 1] !== ' ', at: m.from }
      children.push({ t: 'p', children: trimEdges(inlines(c, m.to, c.to, src, refs)) })
      continue
    }
    const b = block(c, src, refs)
    if (b) children.push(b)
  }
  return { task, children }
}

function block(c: SyntaxNode, src: string, refs: RegExp | null): Block | null {
  const level = LEVEL[c.name]
  if (level) {
    const mark = c.firstChild?.name === 'HeaderMark' && c.name.startsWith('ATX') ? c.firstChild.to : c.from
    return { t: 'h', level, children: trimEdges(inlines(c, mark, c.to, src, refs)) }
  }
  switch (c.name) {
    case 'Paragraph': return { t: 'p', children: trimEdges(inlines(c, c.from, c.to, src, refs)) }
    case 'BulletList':
    case 'OrderedList': {
      const items: Item[] = []
      for (let li = c.firstChild; li; li = li.nextSibling) if (li.name === 'ListItem') items.push(item(li, src, refs))
      const firstMark = c.firstChild?.getChild('ListMark')
      const start = c.name === 'OrderedList' && firstMark ? parseInt(src.slice(firstMark.from, firstMark.to), 10) || 1 : 1
      return { t: c.name === 'OrderedList' ? 'ol' : 'ul', start, items }
    }
    case 'Blockquote': {
      const children: Block[] = []
      for (let k = c.firstChild; k; k = k.nextSibling) { const b = block(k, src, refs); if (b) children.push(b) }
      return { t: 'quote', children }
    }
    case 'FencedCode': {
      const marks = c.getChildren('CodeMark')
      const bodyFrom = src.indexOf('\n', c.from) + 1
      const bodyTo = marks.length > 1 ? marks[marks.length - 1].from : c.to
      if (bodyFrom <= 0 || bodyFrom > bodyTo) return { t: 'pre', text: '' }
      return { t: 'pre', text: src.slice(bodyFrom, bodyTo).replace(/\r?\n$/, '') }
    }
    case 'CodeBlock': {
      const ls = src.lastIndexOf('\n', c.from - 1) + 1
      return { t: 'pre', text: src.slice(ls, c.to).split('\n').map((l) => l.replace(/^( {1,4}|\t)/, '')).join('\n') }
    }
    case 'HorizontalRule': return { t: 'hr' }
    case 'QuoteMark':
    case 'ListMark':
      return null
    default: {
      // HTML brut, referințe de link, orice altceva: text, ca să nu se piardă.
      const out: Inline[] = []
      pushText(out, src.slice(c.from, c.to), refs)
      return out.length ? { t: 'p', children: out } : null
    }
  }
}

/** Arborele de afișat — pur, fără React, ca să se testeze pe fixtures. */
export function toBlocks(text: string, prefixes: readonly string[]): Block[] {
  const refs = refPattern(prefixes)
  const top = mdParser.parse(text).topNode
  const out: Block[] = []
  for (let c = top.firstChild; c; c = c.nextSibling) { const b = block(c, text, refs); if (b) out.push(b) }
  return out
}
