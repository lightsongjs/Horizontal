# Descrierea în markdown (live preview) — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** descrierea tichetului se scrie și se citește ca markdown randat pe loc (Obsidian Live Preview), cu căsuțe bifabile dintr-o atingere, în Literata, nu mono.

**Architecture:** O singură gramatică, `@lezer/markdown` (fără tabele), stă sub două straturi:
- `MarkdownView`: cititor React, fără `innerHTML`, în chunk-ul principal.
- `MarkdownEditor`: CodeMirror 6 cu un plugin propriu de decorări, într-un chunk lazy.

Toată logica de text e în funcții pure din `src/lib/markdown/`, cu fixtures: arborele de blocuri, specificația decorărilor, bifa, continuarea listei, formatarea, diff-ul minim. Documentul editorului ESTE stringul `desc`, deci textul salvat e exact cel scris.

**Tech Stack:** React 18, TypeScript, Vite 5 + VitePWA (injectManifest), vitest 2, Playwright, `@lezer/markdown`, `@codemirror/{state,view,commands}`.

**Spec:** `docs/superpowers/specs/2026-10-12-descriere-markdown-design.md` (mockup: `design/markdown-descriere.html`)

## Global Constraints

- Orice `font-size` din CSS e `calc(Npx * var(--text-scale))`. `src/lib/textScale.test.ts` pică pe un px fix.
- Fără chenare decorative, un singur accent (`--accent`), fără gradient, iconițe prin `<Icon name=…>` cu nume de ROL (fără emoji). Raze doar `--r-s` / `--r-m` / `--r` / `50%`.
- Textul NU se „curăță” niciodată la salvare. Bifa schimbă exact un caracter. Deschiderea și închiderea fără editare nu scriu nimic.
- Linkuri permise: doar `http:`, `https:`, `mailto:` (`www.` → `https://`). Restul rămâne text.
- Subsetul markdown e cel din spec. Tabelele NU sunt activate în parser (rămân text).
- Comentariile din fir sunt doar citire, cu căsuțe statice.
- Foaia rapidă, bara Linux, `TicketActivity` și widget-ul NU se ating.
- Fără focus la deschiderea foii de pe telefon. Bifa nu ia focusul (`preventDefault` pe `pointerdown` și `mousedown`).
- Rebaza din store nu se aplică cât `view.composing`; se aplică la `compositionend`.
- NU se face `git push` până la Task 8, pasul de verificare pe telefon (push pe master = producție).
- În shell, `grep` e stricat în mediul ăsta: folosește `command grep`.

## Review Focus

1. **Descrieri vechi scrise ca text simplu.** Un rând urmat de `---` devine titlu setext, iar un rând indentat cu 4 spații devine bloc de cod. Omul se așteaptă ca textul să nu dispară și rândurile să rămână rânduri. Testul de fixtures din Task 1 („text vechi”) fixează asta: niciun caracter de conținut pierdut, iar Enter simplu e `br`.
2. **Sfârșit de rând CRLF** (text venit din API sau ticket-kit pe Windows). Bifa și continuarea listei nu au voie să mănânce `\r`. Test în Task 2.
3. **Bifă pe text vechi:** bifezi din cardul de dependență cu descrierea între timp schimbată pe alt dispozitiv, iar pe linia aceea nu mai e o căsuță. Se așteaptă: nimic nu se scrie. Test în Task 2 (`toggleTask` pe o linie fără căsuță întoarce textul identic).
4. **`javascript:` / `data:` în link** scrise de o unealtă AI. Se așteaptă: text, nu link. Test în Task 1.
5. **Utilizator fără drept de scriere.** Căsuțele sunt dezactivate, editorul read-only, linkurile merg. Test în Task 3 (`MarkdownView` fără `onToggle` → `disabled`) și în Task 6 (editorul read-only).

---

## Structura fișierelor

| Fișier | Rol |
|---|---|
| `src/lib/markdown/parse.ts` | `mdParser`: `@lezer/markdown` cu TaskList + Strikethrough + Autolink |
| `src/lib/markdown/safeUrl.ts` | `safeHref(raw)` |
| `src/lib/markdown/blocks.ts` | `toBlocks(text, prefixes)`: arbore JSON pentru cititor |
| `src/lib/markdown/tasks.ts` | `toggleTask`, `taskProgress`, `continueList`, `removeMarker`, `toggleLinePrefix`, `indentLines`, `toggleWrap`, `minimalChange` |
| `src/lib/markdown/decorations.ts` | `decorationSpecs(text, reveal, prefixes)`: ce ascunde sau desenează editorul |
| `src/lib/markdown/*.test.ts` | fixtures |
| `src/components/MarkdownView.tsx` | cititorul |
| `src/components/TaskProgress.tsx` | jetonul „2/5” |
| `src/components/markdown/livePreview.ts` | ViewPlugin-ul CM6 + widget-uri (chunk lazy) |
| `src/components/MarkdownEditor.tsx` | editorul CM6 (chunk lazy, `export default`) |
| `src/components/DescField.tsx` | `Suspense` + textarea de rezervă + handle `focus`/`format` |
| `src/components/FormatBar.tsx` | bara de pe telefon |
| `src/styles.css` | blocul „Markdown” (`.md`, `.md-editor`, `.md-format`, `.md-progress`) |

---

### Task 1: Parserul, URL-urile sigure și arborele cititorului

**Files:**
- Modify: `package.json` (dependențe)
- Create: `src/lib/markdown/parse.ts`, `src/lib/markdown/safeUrl.ts`, `src/lib/markdown/blocks.ts`
- Test: `src/lib/markdown/blocks.test.ts`

**Interfaces:**
- Produces:
  - `mdParser` (lezer `MarkdownParser`)
  - `safeHref(raw: string): string | null`
  - `refPattern(prefixes: readonly string[]): RegExp | null`
  - tipurile `Inline`, `Block`, `Item`
  - `toBlocks(text: string, prefixes: readonly string[]): Block[]`

- [ ] **Step 1: Instalează dependențele**

```bash
npm i @lezer/markdown @lezer/common @codemirror/state @codemirror/view @codemirror/commands
```

- [ ] **Step 2: Scrie testul care pică** — `src/lib/markdown/blocks.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { toBlocks } from './blocks'
import { safeHref } from './safeUrl'

const P = ['HZ', 'APO']

describe('safeHref', () => {
  it.each([
    ['https://a.ro', 'https://a.ro'],
    ['http://a.ro/x?y=1', 'http://a.ro/x?y=1'],
    ['mailto:a@b.ro', 'mailto:a@b.ro'],
    ['www.a.ro', 'https://www.a.ro'],
    ['javascript:alert(1)', null],
    ['data:text/html,x', null],
    ['  JAVASCRIPT:x', null],
    ['/relativ', null],
  ])('%s → %s', (raw, out) => expect(safeHref(raw)).toBe(out))
})

describe('toBlocks', () => {
  it('titluri: h4–h6 cad pe nivelul 3', () => {
    expect(toBlocks('# A\n## B\n#### C', P)).toEqual([
      { t: 'h', level: 1, children: [{ t: 'text', text: 'A' }] },
      { t: 'h', level: 2, children: [{ t: 'text', text: 'B' }] },
      { t: 'h', level: 3, children: [{ t: 'text', text: 'C' }] },
    ])
  })

  it('inline: bold, italic, tăiat, cod, link', () => {
    expect(toBlocks('a **b** *c* ~~d~~ `e` [f](https://g.ro)', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'a ' },
        { t: 'strong', children: [{ t: 'text', text: 'b' }] },
        { t: 'text', text: ' ' },
        { t: 'em', children: [{ t: 'text', text: 'c' }] },
        { t: 'text', text: ' ' },
        { t: 'del', children: [{ t: 'text', text: 'd' }] },
        { t: 'text', text: ' ' },
        { t: 'code', text: 'e' },
        { t: 'text', text: ' ' },
        { t: 'link', href: 'https://g.ro', children: [{ t: 'text', text: 'f' }] },
      ],
    }])
  })

  it('un link nesigur rămâne text', () => {
    expect(toBlocks('[x](javascript:alert(1))', P)).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'x' }] },
    ])
  })

  it('URL gol devine link', () => {
    expect(toBlocks('vezi https://a.ro', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'vezi ' },
        { t: 'link', href: 'https://a.ro', children: [{ t: 'text', text: 'https://a.ro' }] },
      ],
    }])
  })

  it('căsuțe, cu poziția marcajului și listă imbricată', () => {
    const s = '- [ ] unu\n  - [x] doi\n- trei'
    expect(toBlocks(s, P)).toEqual([{
      t: 'ul', start: 1, items: [
        {
          task: { checked: false, at: 2 },
          children: [
            { t: 'p', children: [{ t: 'text', text: 'unu' }] },
            { t: 'ul', start: 1, items: [
              { task: { checked: true, at: 14 }, children: [{ t: 'p', children: [{ t: 'text', text: 'doi' }] }] },
            ] },
          ],
        },
        { task: null, children: [{ t: 'p', children: [{ t: 'text', text: 'trei' }] }] },
      ],
    }])
  })

  it('listă numerotată își ține începutul', () => {
    expect(toBlocks('3. a\n4. b', P)[0]).toMatchObject({ t: 'ol', start: 3 })
  })

  it('citat, separator, bloc de cod', () => {
    expect(toBlocks('> zis\n\n---\n\n```js\nx = 1\ny\n```', P)).toEqual([
      { t: 'quote', children: [{ t: 'p', children: [{ t: 'text', text: 'zis' }] }] },
      { t: 'hr' },
      { t: 'pre', text: 'x = 1\ny' },
    ])
  })

  it('referințe la tichete cunoscute; provizoriile și prefixele străine rămân text', () => {
    expect(toBlocks('vezi HZ-12, APO-3, XY-4 și HZ-~ab12', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'vezi ' },
        { t: 'ref', id: 'HZ-12' },
        { t: 'text', text: ', ' },
        { t: 'ref', id: 'APO-3' },
        { t: 'text', text: ', XY-4 și HZ-~ab12' },
      ],
    }])
  })

  it('text vechi: Enter simplu rămâne rând nou, nimic nu se pierde', () => {
    expect(toBlocks('rândul unu\nrândul doi\n\nparagraf', P)).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'rândul unu' }, { t: 'br' }, { t: 'text', text: 'rândul doi' }] },
      { t: 'p', children: [{ t: 'text', text: 'paragraf' }] },
    ])
  })

  it('tabelele nu sunt activate: rămân text', () => {
    const b = toBlocks('| a | b |\n|---|---|\n| 1 | 2 |', P)
    expect(b.every((x) => x.t === 'p' || x.t === 'h')).toBe(true)
  })

  it('HTML brut rămâne text', () => {
    expect(toBlocks('<b>x</b>', P)).toEqual([{ t: 'p', children: [{ t: 'text', text: '<b>x</b>' }] }])
  })
})
```

- [ ] **Step 3: Rulează testul și verifică faptul că pică**

Run: `npx vitest run src/lib/markdown/blocks.test.ts`
Expected: FAIL, cu „Failed to resolve import ./blocks”.

- [ ] **Step 4: Implementează**

`src/lib/markdown/parse.ts`:

```ts
import { parser, TaskList, Strikethrough, Autolink } from '@lezer/markdown'

/**
 * O singură gramatică pentru cititor și editor, ca ce vezi citind să fie
 * exact ce vezi scriind. Fără `Table`: tabelele nu sunt în subset și rămân text.
 */
export const mdParser = parser.configure([TaskList, Strikethrough, Autolink])
```

`src/lib/markdown/safeUrl.ts`:

```ts
/**
 * Singurele scheme pe care le deschidem — aceeași regulă ca `openExternal` din
 * cutia Linux. Textul vine și de la unelte (ticket-kit), deci un
 * `javascript:` scris acolo rămâne text, nu link.
 */
export function safeHref(raw: string): string | null {
  const s = raw.trim()
  if (/^www\./i.test(s)) return `https://${s}`
  return /^(https?:|mailto:)/i.test(s) ? s : null
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `PREFIX-N` pentru prefixele cunoscute; un ID provizoriu (`HZ-~…`) nu se potrivește. */
export function refPattern(prefixes: readonly string[]): RegExp | null {
  const ps = prefixes.filter(Boolean)
  if (!ps.length) return null
  return new RegExp(`\\b(?:${ps.map(esc).join('|')})-\\d+\\b`, 'g')
}
```

`src/lib/markdown/blocks.ts`:

```ts
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
```

- [ ] **Step 5: Rulează testul și verifică faptul că trece**

Run: `npx vitest run src/lib/markdown/blocks.test.ts`
Expected: PASS. Dacă un fixture pică din cauza unei forme exacte de arbore din lezer (de exemplu `QuoteMark` în interiorul `Paragraph`), corectează implementarea, nu testul. Excepția e când rezultatul nou e la fel de corect pentru om; atunci notează motivul în mesajul de commit.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/markdown
git commit -m "feat(markdown): parser, linkuri sigure și arborele cititorului"
```

---

### Task 2: Operațiile pe text (bifa, liste, formatare, diff)

**Files:**
- Create: `src/lib/markdown/tasks.ts`
- Test: `src/lib/markdown/tasks.test.ts`

**Interfaces:**
- Consumes: `mdParser` (Task 1)
- Produces:
  - `type Edit = { text: string; anchor: number; head?: number }`
  - `toggleTask(text: string, pos: number): string`: bifează căsuța de pe linia care conține `pos`.
  - `taskProgress(text: string): { done: number; total: number }`
  - `continueList(text: string, pos: number): Edit | null`
  - `removeMarker(text: string, pos: number): Edit | null`
  - `toggleLinePrefix(text: string, from: number, to: number, kind: 'task' | 'bullet'): Edit`
  - `indentLines(text: string, from: number, to: number, dir: 1 | -1): Edit | null`
  - `toggleWrap(text: string, from: number, to: number, mark: '**' | '*'): Edit`
  - `minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null`

- [ ] **Step 1: Scrie testul care pică** — `src/lib/markdown/tasks.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  continueList, indentLines, minimalChange, removeMarker, taskProgress,
  toggleLinePrefix, toggleTask, toggleWrap,
} from './tasks'

describe('toggleTask', () => {
  it('bifează și debifează, schimbând exact un caracter', () => {
    const s = 'a\n- [ ] unu\n- [x] doi'
    const once = toggleTask(s, 5)
    expect(once).toBe('a\n- [x] unu\n- [x] doi')
    expect(toggleTask(once, 5)).toBe(s)
    expect(toggleTask(s, 15)).toBe('a\n- [ ] unu\n- [ ] doi')
  })
  it('X mare se debifează', () => expect(toggleTask('- [X] a', 0)).toBe('- [ ] a'))
  it('o linie care nu (mai) e căsuță → textul identic', () => {
    expect(toggleTask('- unu\ntext', 2)).toBe('- unu\ntext')
  })
  it('păstrează CRLF', () => {
    expect(toggleTask('- [ ] a\r\n- [ ] b\r\n', 9)).toBe('- [ ] a\r\n- [x] b\r\n')
  })
  it('căsuță numerotată, indentată, în citat', () => {
    expect(toggleTask('  1. [ ] a', 0)).toBe('  1. [x] a')
    expect(toggleTask('> - [ ] a', 0)).toBe('> - [x] a')
  })
})

describe('taskProgress', () => {
  it('numără căsuțele, nu și pe cele din cod', () => {
    expect(taskProgress('- [x] a\n- [ ] b\n  - [X] c\n```\n- [ ] nu\n```')).toEqual({ done: 2, total: 3 })
  })
  it('fără căsuțe → 0/0', () => expect(taskProgress('text [ ] simplu')).toEqual({ done: 0, total: 0 }))
})

describe('continueList', () => {
  it('continuă o căsuță, nebifată', () => {
    expect(continueList('- [x] unu', 9)).toEqual({ text: '- [x] unu\n- [ ] ', anchor: 16 })
  })
  it('continuă buline și numere', () => {
    expect(continueList('* a', 3)).toEqual({ text: '* a\n* ', anchor: 6 })
    expect(continueList('  9. a', 6)).toEqual({ text: '  9. a\n  10. ', anchor: 13 })
  })
  it('Enter în mijlocul textului rupe rândul în două elemente', () => {
    expect(continueList('- ab', 3)).toEqual({ text: '- a\n- b', anchor: 6 })
  })
  it('element gol → iese din listă', () => {
    expect(continueList('- a\n- [ ] ', 10)).toEqual({ text: '- a\n', anchor: 4 })
  })
  it('în afara listei, sau în marcaj → null (Enter obișnuit)', () => {
    expect(continueList('text', 4)).toBeNull()
    expect(continueList('- a', 1)).toBeNull()
  })
  it('păstrează CRLF-ul rândului', () => {
    expect(continueList('- a\r\n- b', 3)).toEqual({ text: '- a\n- \r\n- b', anchor: 6 })
  })
})

describe('removeMarker', () => {
  it('la începutul conținutului scoate marcajul', () => {
    expect(removeMarker('- [ ] a', 6)).toEqual({ text: 'a', anchor: 0 })
    expect(removeMarker('x\n1. a', 5)).toEqual({ text: 'x\na', anchor: 2 })
  })
  it('un element indentat întâi iese un nivel', () => {
    expect(removeMarker('  - a', 4)).toEqual({ text: '- a', anchor: 2 })
  })
  it('altundeva → null', () => {
    expect(removeMarker('- ab', 3)).toBeNull()
    expect(removeMarker('ab', 0)).toBeNull()
  })
})

describe('toggleLinePrefix', () => {
  it('căsuță: text → căsuță → text', () => {
    const on = toggleLinePrefix('a', 1, 1, 'task')
    expect(on).toEqual({ text: '- [ ] a', anchor: 7 })
    expect(toggleLinePrefix(on.text, 7, 7, 'task')).toEqual({ text: 'a', anchor: 1 })
  })
  it('căsuță peste o bulină o transformă', () => {
    expect(toggleLinePrefix('- a', 3, 3, 'task')).toEqual({ text: '- [ ] a', anchor: 7 })
  })
  it('listă pe mai multe rânduri', () => {
    expect(toggleLinePrefix('a\nb', 0, 3, 'bullet')).toEqual({ text: '- a\n- b', anchor: 2, head: 7 })
  })
})

describe('indentLines', () => {
  it('indentează și scoate indentarea doar pe elementele de listă', () => {
    expect(indentLines('- a\ntext', 0, 8, 1)).toEqual({ text: '  - a\ntext', anchor: 2, head: 10 })
    expect(indentLines('  - a', 4, 4, -1)).toEqual({ text: '- a', anchor: 2 })
  })
  it('în afara listei → null (Tab rămâne navigare)', () => {
    expect(indentLines('text', 0, 0, 1)).toBeNull()
  })
})

describe('toggleWrap', () => {
  it('fără selecție pune perechea și cursorul la mijloc', () => {
    expect(toggleWrap('ab', 1, 1, '**')).toEqual({ text: 'a****b', anchor: 3 })
  })
  it('învelește și desface selecția', () => {
    const w = toggleWrap('a b c', 2, 3, '**')
    expect(w).toEqual({ text: 'a **b** c', anchor: 4, head: 5 })
    expect(toggleWrap(w.text, 4, 5, '**')).toEqual({ text: 'a b c', anchor: 2, head: 3 })
  })
})

describe('minimalChange', () => {
  it('doar intervalul schimbat', () => {
    expect(minimalChange('abcdef', 'abXdef')).toEqual({ from: 2, to: 3, insert: 'X' })
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' })
    expect(minimalChange('x', 'x')).toBeNull()
  })
})
```

- [ ] **Step 2: Rulează testul și verifică faptul că pică**

Run: `npx vitest run src/lib/markdown/tasks.test.ts`
Expected: FAIL, cu „Failed to resolve import ./tasks”.

- [ ] **Step 3: Implementează** — `src/lib/markdown/tasks.ts`

```ts
import { mdParser } from './parse'

/**
 * Operațiile pe textul descrierii. Toate lucrează pe string și întorc string:
 * editorul le aplică prin `minimalChange`, cititorul le trimite ca patch. Nu
 * „curăță” nimic în afara liniei atinse — textul omului rămâne al lui.
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
```

- [ ] **Step 4: Rulează testul și verifică faptul că trece**

Run: `npx vitest run src/lib/markdown/tasks.test.ts`
Expected: PASS. Cazurile de poziție (`anchor`/`head`) din `mapLines` sunt cele mai probabile să pice. Corectează calculul, nu testul: testul spune unde se așteaptă omul să-i rămână cursorul.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown/tasks.ts src/lib/markdown/tasks.test.ts
git commit -m "feat(markdown): bifa, continuarea listei și formatarea, pure"
```

---

### Task 3: Cititorul — `MarkdownView`, stilurile, cardul de dependență și firul

**Files:**
- Create: `src/components/MarkdownView.tsx`
- Test: `src/components/MarkdownView.test.tsx`
- Modify: `src/styles.css` (bloc nou „Markdown”, plus `.issue-desc`, `.thread-comment-text`, `.thread-textarea`)
- Modify: `src/components/IssueSheet.tsx:71`, `src/components/Thread.tsx:328`

**Interfaces:**
- Consumes: `toBlocks`, `toggleTask` (Task 1–2)
- Produces:
  - `MarkdownView({ text, prefixes, onToggle?, onRef?, className? })`, unde `onToggle(next: string)` primește textul întreg după bifă;
  - clasele CSS `.md`, `.md-task`, `.md-ref`, `.md-hr`, refolosite de editor în Task 6.

- [ ] **Step 1: Scrie testul care pică** — `src/components/MarkdownView.test.tsx`

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from './MarkdownView'

const html = (text: string, toggle = true) =>
  renderToStaticMarkup(<MarkdownView text={text} prefixes={['HZ']} onToggle={toggle ? () => {} : undefined} onRef={() => {}} />)

describe('MarkdownView', () => {
  it('căsuța e un checkbox accesibil, cu rândul bifat marcat', () => {
    const h = html('- [x] gata\n- [ ] nu')
    expect(h).toContain('role="checkbox"')
    expect(h).toContain('aria-checked="true"')
    expect(h).toContain('class="md-li md-li-task done"')
  })
  it('fără onToggle căsuțele sunt dezactivate (fir, fără drept de scriere)', () => {
    expect(html('- [ ] a', false)).toContain('disabled=""')
  })
  it('linkurile se deschid în altă filă, fără opener', () => {
    expect(html('[x](https://a.ro)')).toContain('<a href="https://a.ro" target="_blank" rel="noopener noreferrer"')
  })
  it('HTML-ul brut e scăpat, nu interpretat', () => {
    expect(html('<img src=x onerror=alert(1)>')).not.toContain('<img')
  })
  it('separatorul e ⁂', () => expect(html('a\n\n---\n\nb')).toContain('⁂'))
})
```

- [ ] **Step 2: Rulează testul și verifică faptul că pică**

Run: `npx vitest run src/components/MarkdownView.test.tsx`
Expected: FAIL, cu „Failed to resolve import ./MarkdownView”.

- [ ] **Step 3: Implementează** — `src/components/MarkdownView.tsx`

```tsx
import { useMemo, type ReactNode, type PointerEvent } from 'react'
import { toBlocks, type Block, type Inline } from '../lib/markdown/blocks'
import { toggleTask } from '../lib/markdown/tasks'
import { Icon } from './Icon'

type Props = {
  text: string
  /** Prefixele proiectelor cunoscute — `HZ-12` devine legătură doar pentru ele. */
  prefixes: readonly string[]
  /** Fără el căsuțele sunt doar desen (fir, fără drept de scriere). */
  onToggle?(next: string): void
  onRef?(id: string): void
  className?: string
}

/** O atingere pe căsuță nu ia focusul — tastatura nu urcă, foaia nu sare. */
const keep = (e: PointerEvent) => e.preventDefault()

/**
 * Descrierea, citită. Elemente React, nu `innerHTML`: textul vine și de la
 * unelte (ticket-kit), iar un HTML brut rămâne text, deci n-avem ce sanitiza.
 * Aceeași gramatică ca editorul (`mdParser`), ca citit și scris să arate la fel.
 */
export function MarkdownView({ text, prefixes, onToggle, onRef, className = '' }: Props) {
  const key = prefixes.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => toBlocks(text, prefixes), [text, key])
  const inl = (list: Inline[]): ReactNode[] => list.map((x, i) => {
    switch (x.t) {
      case 'text': return x.text
      case 'br': return <br key={i} />
      case 'strong': return <strong key={i}>{inl(x.children)}</strong>
      case 'em': return <em key={i}>{inl(x.children)}</em>
      case 'del': return <del key={i}>{inl(x.children)}</del>
      case 'code': return <code key={i} className="md-code">{x.text}</code>
      case 'link': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" className="md-link">{inl(x.children)}</a>
      case 'ref': return onRef
        ? <button key={i} type="button" className="md-ref" onClick={() => onRef(x.id)}>{x.id}</button>
        : <span key={i} className="md-ref">{x.id}</span>
    }
  })
  const blk = (list: Block[]): ReactNode[] => list.map((b, i) => {
    switch (b.t) {
      case 'h': {
        const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'
        return <H key={i} className={`md-h${b.level}`}>{inl(b.children)}</H>
      }
      case 'p': return <p key={i}>{inl(b.children)}</p>
      case 'quote': return <blockquote key={i}>{blk(b.children)}</blockquote>
      case 'pre': return <pre key={i} className="md-pre"><code>{b.text}</code></pre>
      case 'hr': return <div key={i} className="md-hr" role="separator">⁂</div>
      case 'ul':
      case 'ol': {
        const L = b.t
        return (
          <L key={i} start={L === 'ol' && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, j) => it.task ? (
              <li key={j} className={`md-li md-li-task${it.task.checked ? ' done' : ''}`}>
                <button
                  type="button"
                  className={`md-task${it.task.checked ? ' on' : ''}`}
                  role="checkbox"
                  aria-checked={it.task.checked}
                  disabled={!onToggle}
                  onPointerDown={keep}
                  onMouseDown={keep}
                  onClick={() => onToggle?.(toggleTask(text, it.task!.at))}
                >
                  {it.task.checked && <Icon name="check" size={13} />}
                </button>
                <div className="md-li-body">{blk(it.children)}</div>
              </li>
            ) : (
              <li key={j} className="md-li">{blk(it.children)}</li>
            ))}
          </L>
        )
      }
    }
  })
  return <div className={`md ${className}`}>{blk(blocks)}</div>
}
```

Titlurile din descriere sunt `h3`–`h5` în DOM, ca să nu concureze cu titlul tichetului (`h2`). Aspectul îl dă clasa, nu tag-ul.

- [ ] **Step 4: Rulează testul și verifică faptul că trece**

Run: `npx vitest run src/components/MarkdownView.test.tsx`
Expected: PASS

- [ ] **Step 5: Stilurile** — adaugă în `src/styles.css`, după regula `.issue-desc` (în jur de linia 1194), blocul de mai jos. Apoi schimbă `.issue-desc`: scoate `white-space: pre-wrap` și culoarea `--txt-dim`, fiindcă descrierea e conținutul principal.

```css
/* ── Markdown: descrierea citită (MarkdownView) și scrisă (MarkdownEditor) ──
   Serif pentru limbă, mono pentru cod și cifre. Fără chenare: blocurile se
   despart prin spațiu și suprafață, citatul n-are bară. Aceleași clase în
   cititor și în editor, ca cele două să nu se poată despărți vizual. */
.md, .md-editor .cm-content {
  font-family: var(--display);
  font-optical-sizing: auto;
  font-size: calc(16px * var(--text-scale));
  line-height: 1.6;
  color: var(--txt);
  overflow-wrap: break-word;
}
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 0 0 0.65em; }
.md h3, .md h4, .md h5 { margin: 1.3em 0 0.35em; }
.md-h1, .md-editor .md-h1 { font-size: calc(20px * var(--text-scale)); font-weight: 600; }
.md-h2, .md-editor .md-h2 { font-size: calc(17px * var(--text-scale)); font-weight: 600; }
.md-h3, .md-editor .md-h3 {
  font-family: var(--mono); font-size: calc(12px * var(--text-scale)); font-weight: 500;
  text-transform: uppercase; letter-spacing: .06em; color: var(--txt-dim);
}
.md strong, .md-editor .md-strong { font-weight: 600; }
.md em, .md-editor .md-em { font-style: italic; }
.md del, .md-editor .md-del { text-decoration: line-through; color: var(--txt-dim); }
.md-code, .md-editor .md-code {
  font-family: var(--mono); font-size: 0.86em;
  background: var(--surface-2); padding: 1px 5px; border-radius: var(--r-s);
}
.md-pre {
  margin: 0.8em 0; padding: 12px 14px; border-radius: var(--r-m);
  background: var(--surface-2); overflow-x: auto;
  font-family: var(--mono); font-size: calc(13px * var(--text-scale)); line-height: 1.55;
}
.md-pre code { font: inherit; }
.md blockquote { margin: 0 0 0.65em; padding-left: 14px; font-style: italic; color: var(--txt-dim); }
.md-link, .md-editor .md-link {
  color: var(--accent);
  text-decoration: underline 1px;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  cursor: pointer;
}
.md-ref {
  font-family: var(--mono); font-size: 0.86em; color: var(--accent);
  background: none; border: 0; padding: 0; cursor: pointer;
}
.md-hr { text-align: center; margin: 1.2em 0; font-family: var(--mono); color: var(--txt-faint); }
.md ul, .md ol { margin: 0 0 0.65em; padding-left: 1.4em; }
.md li { margin: 0.15em 0; }
.md li > p { margin: 0; }
.md ul > li.md-li:not(.md-li-task) { list-style: none; position: relative; }
.md ul > li.md-li:not(.md-li-task)::before, .md-editor .md-bullet {
  content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: var(--txt-faint); vertical-align: middle;
}
.md ul > li.md-li:not(.md-li-task)::before { position: absolute; left: -0.95em; top: 0.72em; }
.md ol { font-variant-numeric: tabular-nums; }
.md ol > li::marker, .md-editor .md-num { font-family: var(--mono); color: var(--txt-dim); }
.md-li-task { list-style: none; display: flex; gap: 10px; align-items: flex-start; margin-left: -1.4em; }
.md-li-body { flex: 1; min-width: 0; }
/* Căsuța: 18px desenați, 44px de atins (pseudo-elementul). */
.md-task {
  position: relative; flex: none; width: 18px; height: 18px; margin-top: 0.22em;
  border: 0; padding: 0; border-radius: var(--r-s); cursor: pointer;
  background: transparent; box-shadow: inset 0 0 0 1.5px var(--txt-faint);
  color: var(--bg); display: inline-grid; place-items: center;
  transition: background 120ms, box-shadow 120ms;
  vertical-align: -0.2em;
}
.md-task::after { content: ''; position: absolute; inset: -13px; }
.md-task.on { background: var(--accent); box-shadow: none; }
.md-task:disabled { cursor: default; }
.md-li-task.done > .md-li-body, .md-editor .md-done {
  color: var(--txt-faint);
  text-decoration: line-through 1px;
  text-decoration-color: var(--txt-faint);
  transition: color 120ms;
}
```

Firul: în `src/styles.css:4221`, `.thread-comment-text` pierde `white-space: pre-wrap`. Adaugă regula următoare, ca un comentariu să fie mai mic decât descrierea:

```css
.thread-comment-text.md { font-size: calc(15px * var(--text-scale)); line-height: 1.55; }
```

În `.thread-textarea` (caută regula), `font-family` devine `var(--display)`, iar `font-size` devine `calc(15px * var(--text-scale))`.

- [ ] **Step 6: Leagă cititorul** în `src/components/IssueSheet.tsx`

Adaugă importurile `MarkdownView` și `useCanWriteIn` (din `../hooks`). În componentă:

```tsx
  const { byId, waves, unblockedBy, themeOf, assignees, myAssigneeId, projects, updateIssue } = useHorizontal()
  const { openEditIssue, pushSheet, showToast } = useUI()
  const it = byId[issueId]
  const canWrite = useCanWriteIn(it?.projectId ?? null)
  if (!it) return null
  const prefixes = projects.map((p) => p.prefix)
  // …
  const openRef = (id: string) => (byId[id] ? navigateTo(id) : showToast(`${id} nu e încărcat — deschide-i proiectul.`))
```

`useCanWriteIn` trebuie chemat ÎNAINTE de `if (!it) return null`, altfel e un hook condiționat. Înlocuiește linia 71:

```tsx
        {it.desc && (
          <MarkdownView
            className="issue-desc"
            text={it.desc}
            prefixes={prefixes}
            onToggle={canWrite ? (desc) => void updateIssue(it.id, { desc }) : undefined}
            onRef={openRef}
          />
        )}
```

În `src/components/Thread.tsx:328`, înlocuiește `<div className="thread-comment-text">{e.body}</div>` cu:

```tsx
<MarkdownView className="thread-comment-text" text={e.body} prefixes={prefixes} onRef={openRef} />
```

Calculează `prefixes` și `openRef` în `Thread`, la fel ca mai sus (`projects`, `byId`, `pushSheet`, `showToast` din store / `useUI`). Fără `onToggle`: un comentariu e istorie.

- [ ] **Step 7: Verifică**

Run: `npx vitest run src/components/MarkdownView.test.tsx src/lib && npm run typecheck`
Expected: PASS, inclusiv `textScale.test.ts` (fără px fix în CSS-ul nou).

- [ ] **Step 8: Commit**

```bash
git add src/components/MarkdownView.tsx src/components/MarkdownView.test.tsx src/components/IssueSheet.tsx src/components/Thread.tsx src/styles.css
git commit -m "feat(markdown): descrierea și firul se citesc randat, în Literata"
```

---

### Task 4: Jetonul „2/5” pe card și pe rând

**Files:**
- Create: `src/components/TaskProgress.tsx`
- Modify: `src/components/TicketCard.tsx:89-95`, `src/components/TaskRow.tsx:83`, `src/components/ListView.tsx:227`, `src/styles.css`
- Modify: `scripts/test-layout.mjs` (verificare nouă)

**Interfaces:**
- Consumes: `taskProgress` (Task 2)
- Produces: `TaskProgress({ desc }: { desc: string })` și `hasTasks(desc: string): boolean`

- [ ] **Step 1: Implementează** — `src/components/TaskProgress.tsx`

```tsx
import { useMemo } from 'react'
import { taskProgress } from '../lib/markdown/tasks'

/** Ieftin, ca un card să nu parseze o descriere fără căsuțe. */
export const hasTasks = (desc: string) => /\[[ xX]\]/.test(desc)

/**
 * „2/5” lângă titlu, numai dacă descrierea are căsuțe — fără ele absența e
 * informația, ca la `DueChip`. Mono: e o cifră.
 */
export function TaskProgress({ desc }: { desc: string }) {
  const p = useMemo(() => taskProgress(desc), [desc])
  if (!p.total) return null
  return (
    <span className={`md-progress${p.done === p.total ? ' all' : ''}`} title={`${p.done} din ${p.total} bifate`}>
      {p.done}/{p.total}
    </span>
  )
}
```

CSS, lângă blocul „Markdown”:

```css
.md-progress {
  font-family: var(--mono); font-size: calc(11px * var(--text-scale));
  color: var(--txt-dim); font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;
}
.md-progress.all { color: var(--txt-faint); }
```

- [ ] **Step 2: Pune-l pe card și pe rânduri**

- `TicketCard.tsx`: adaugă `|| hasTasks(it.desc)` în condiția `.tk-sub`, iar `<TaskProgress desc={it.desc} />` ca prim copil al lui `.tk-sub`.
- `TaskRow.tsx`: `<TaskProgress desc={issue.desc} />` primul în `.t-tail`.
- `ListView.tsx`: `<TaskProgress desc={it.desc} />` imediat înainte de `{it.urgent && …}` din `.row-tail`.

- [ ] **Step 3: Verificarea de layout** — în `scripts/test-layout.mjs`, adaugă la secțiunea de rânduri de listă (unde se construiește un `.task-row` static; caută `task-row`) o variantă cu `<span class="md-progress">12/15</span>` în `.t-tail`. Verifică la 320–430px că `.list-title` are lățimea > 80px și că `.md-progress` nu se taie (`scrollWidth <= clientWidth`). Urmează tiparul `check(...)` existent din fișier.

- [ ] **Step 4: Rulează**

Run: `npm run typecheck && npx vitest run && npm run test:layout`
Expected: totul PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskProgress.tsx src/components/TicketCard.tsx src/components/TaskRow.tsx src/components/ListView.tsx src/styles.css scripts/test-layout.mjs
git commit -m "feat(markdown): progresul căsuțelor pe card și pe rând"
```

---

### Task 5: Specificația decorărilor editorului (pură)

**Files:**
- Create: `src/lib/markdown/decorations.ts`
- Test: `src/lib/markdown/decorations.test.ts`

**Interfaces:**
- Consumes: `mdParser`, `safeHref`, `refPattern` (Task 1)
- Produces:

```ts
export type DecoSpec =
  | { k: 'hide'; from: number; to: number }
  | { k: 'mark'; from: number; to: number; cls: string; attrs?: Record<string, string> }
  | { k: 'line'; at: number; cls: string }
  | { k: 'bullet'; from: number; to: number }
  | { k: 'task'; from: number; to: number; checked: boolean }
  | { k: 'hr'; from: number; to: number }
export function decorationSpecs(text: string, reveal: ReadonlySet<number>, prefixes: readonly string[]): DecoSpec[]
```

`reveal` conține indicii de linie (de la 0) pe care stă cursorul. Pe ele sintaxa inline rămâne vizibilă. Marcajele de bloc (bulina, căsuța) se desenează mereu.

- [ ] **Step 1: Scrie testul care pică** — `src/lib/markdown/decorations.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { decorationSpecs, type DecoSpec } from './decorations'

const none = new Set<number>()
const of = (specs: DecoSpec[], k: DecoSpec['k']) => specs.filter((s) => s.k === k)

describe('decorationSpecs', () => {
  it('ascunde ** în afara liniei cu cursorul, le arată pe ea', () => {
    const s = 'a **b**'
    expect(of(decorationSpecs(s, none, []), 'hide')).toEqual([{ k: 'hide', from: 2, to: 4 }, { k: 'hide', from: 5, to: 7 }])
    expect(of(decorationSpecs(s, new Set([0]), []), 'hide')).toEqual([])
    expect(of(decorationSpecs(s, new Set([0]), []), 'mark')).toContainEqual({ k: 'mark', from: 2, to: 7, cls: 'md-strong' })
  })
  it('titlul: clasa pe linie mereu, „## ” ascuns doar fără cursor', () => {
    const d = decorationSpecs('## T', none, [])
    expect(d).toContainEqual({ k: 'line', at: 0, cls: 'md-h2' })
    expect(d).toContainEqual({ k: 'hide', from: 0, to: 3 })
    expect(of(decorationSpecs('## T', new Set([0]), []), 'hide')).toEqual([])
  })
  it('căsuța e desenată și pe linia cu cursorul; rândul bifat e tăiat', () => {
    const d = decorationSpecs('- [x] gata', new Set([0]), [])
    expect(d).toContainEqual({ k: 'task', from: 0, to: 5, checked: true })
    expect(d).toContainEqual({ k: 'mark', from: 5, to: 10, cls: 'md-done' })
  })
  it('bulina înlocuiește „-”, numărul doar se colorează', () => {
    expect(of(decorationSpecs('- a', none, []), 'bullet')).toEqual([{ k: 'bullet', from: 0, to: 1 }])
    expect(decorationSpecs('1. a', none, [])).toContainEqual({ k: 'mark', from: 0, to: 2, cls: 'md-num' })
  })
  it('linkul: textul rămâne, sintaxa se ascunde, href-ul sigur e pe mark', () => {
    const d = decorationSpecs('[x](https://a.ro)', none, [])
    expect(d).toContainEqual({ k: 'mark', from: 0, to: 17, cls: 'md-link', attrs: { 'data-href': 'https://a.ro' } })
    expect(of(d, 'hide')).toEqual([{ k: 'hide', from: 0, to: 1 }, { k: 'hide', from: 2, to: 17 }])
  })
  it('linkul nesigur nu primește href', () => {
    const d = decorationSpecs('[x](javascript:a)', none, [])
    expect(d.some((s) => s.k === 'mark' && s.attrs)).toBe(false)
  })
  it('referința la tichet, nu și în cod', () => {
    const d = decorationSpecs('HZ-1 `HZ-2`', none, ['HZ'])
    expect(d).toContainEqual({ k: 'mark', from: 0, to: 4, cls: 'md-ref', attrs: { 'data-ref': 'HZ-1' } })
    expect(d.filter((s) => s.k === 'mark' && s.cls === 'md-ref')).toHaveLength(1)
  })
  it('separatorul devine ⁂ doar fără cursor; codul primește clasa pe fiecare linie', () => {
    expect(of(decorationSpecs('---', none, []), 'hr')).toEqual([{ k: 'hr', from: 0, to: 3 }])
    expect(of(decorationSpecs('---', new Set([0]), []), 'hr')).toEqual([])
    const d = decorationSpecs('```\na\n```', none, [])
    expect(d.filter((s) => s.k === 'line' && s.cls.includes('md-pre'))).toHaveLength(3)
  })
  it('citatul: clasa pe linie, „> ” ascuns', () => {
    const d = decorationSpecs('> a', none, [])
    expect(d).toContainEqual({ k: 'line', at: 0, cls: 'md-quote' })
    expect(d).toContainEqual({ k: 'hide', from: 0, to: 2 })
  })
  it('nimic ascuns nu traversează un rând nou', () => {
    const d = decorationSpecs('**a\nb**', none, [])
    expect(d.filter((s) => (s.k === 'hide' || s.k === 'bullet' || s.k === 'task' || s.k === 'hr'))
      .every((s) => !'**a\nb**'.slice((s as { from: number }).from, (s as { to: number }).to).includes('\n'))).toBe(true)
  })
})
```

- [ ] **Step 2: Rulează testul și verifică faptul că pică**

Run: `npx vitest run src/lib/markdown/decorations.test.ts`
Expected: FAIL, cu „Failed to resolve import ./decorations”.

- [ ] **Step 3: Implementează** — `src/lib/markdown/decorations.ts`

```ts
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
 */
export type DecoSpec =
  | { k: 'hide'; from: number; to: number }
  | { k: 'mark'; from: number; to: number; cls: string; attrs?: Record<string, string> }
  | { k: 'line'; at: number; cls: string }
  | { k: 'bullet'; from: number; to: number }
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
          const next = n.node.nextSibling
          if (next?.name === 'Task') {
            const m = next.getChild('TaskMarker')!
            const checked = text[m.from + 1] !== ' '
            out.push({ k: 'task', from: n.from, to: m.to, checked })
            if (checked) out.push({ k: 'mark', from: m.to, to: next.to, cls: 'md-done' })
          } else if (/[-*+]/.test(text[n.from])) {
            out.push({ k: 'bullet', from: n.from, to: n.to })
          } else {
            out.push({ k: 'mark', from: n.from, to: n.to, cls: 'md-num' })
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
```

- [ ] **Step 4: Rulează testul și verifică faptul că trece**

Run: `npx vitest run src/lib/markdown/decorations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown/decorations.ts src/lib/markdown/decorations.test.ts
git commit -m "feat(markdown): specificația decorărilor live preview, pură"
```

---

### Task 6: Editorul CM6 în foaia de pe telefon, cu bara de formatare

**Files:**
- Create: `src/components/markdown/livePreview.ts`, `src/components/MarkdownEditor.tsx`, `src/components/DescField.tsx`, `src/components/FormatBar.tsx`
- Modify: `src/components/Icon.tsx` (patru roluri noi), `src/components/EditSheet.tsx`, `src/App.tsx` (preîncărcare), `src/styles.css`
- Modify: `scripts/test-nav.mjs` (liniile 551, 557, 600, 619 + verificări noi)

**Interfaces:**
- Consumes:
  - `decorationSpecs` (Task 5)
  - `toggleTask`, `continueList`, `removeMarker`, `toggleLinePrefix`, `indentLines`, `toggleWrap`, `minimalChange`, `Edit` (Task 2)
  - clasele CSS din Task 3
- Produces:
  - `type FormatCmd = 'task' | 'bullet' | 'bold' | 'indent' | 'outdent'`
  - `type EditorHandle = { focus(): void; format(cmd: FormatCmd): void }`
  - `type MarkdownEditorProps = { value: string; onChange(next: string): void; onCommit(next: string): void; onFocus?(): void; onBlur?(): void; readOnly?: boolean; placeholder?: string; ariaLabel: string; prefixes: readonly string[]; onRef?(id: string): void }`
  - `DescField` (forwardRef `EditorHandle`, props `MarkdownEditorProps & { className?: string }`)
  - `preloadEditor(): void`
  - `FormatBar({ onFormat })`
  - pe elementul `.md-editor`, proprietatea `hzValue(): string`, folosită de testele de browser

- [ ] **Step 1: Iconițele.** În `src/components/Icon.tsx`, importă `SquareCheck` (dacă nu e deja), `List`, `Bold` și `ListIndentIncrease` din `lucide-react`. Adaugă în `ICONS`:

```ts
  // Bara de formatare a descrierii (telefon) — roluri, nu desene.
  mdTask: SquareCheck,
  mdList: List,
  mdBold: Bold,
  mdIndent: ListIndentIncrease,
```

- [ ] **Step 2: Pluginul** — `src/components/markdown/livePreview.ts`

```ts
import { Annotation, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { decorationSpecs } from '../../lib/markdown/decorations'
import { minimalChange, toggleTask } from '../../lib/markdown/tasks'

/** O schimbare venită din store (rebază), nu de la om — nu se trimite înapoi. */
export const External = Annotation.define<boolean>()
/** O bifă: pleacă imediat (`onCommit`), nu după pauza textului. */
export const Toggle = Annotation.define<boolean>()

const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'md-bullet'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}

class HrWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'md-hr'
    s.textContent = '⁂'
    return s
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly disabled: boolean) { super() }
  eq(o: TaskWidget) { return o.checked === this.checked && o.disabled === this.disabled }
  toDOM(view: EditorView) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `md-task${this.checked ? ' on' : ''}`
    b.setAttribute('role', 'checkbox')
    b.setAttribute('aria-checked', String(this.checked))
    b.disabled = this.disabled
    if (this.checked) b.innerHTML = CHECK
    // Bifa nu ia focusul: altfel o atingere ar ridica tastatura.
    const keep = (e: Event) => e.preventDefault()
    b.addEventListener('pointerdown', keep)
    b.addEventListener('mousedown', keep)
    b.addEventListener('click', (e) => {
      e.preventDefault()
      if (!view.state.facet(EditorView.editable)) return
      const text = view.state.doc.toString()
      const c = minimalChange(text, toggleTask(text, view.posAtDOM(b)))
      if (c) view.dispatch({ changes: c, annotations: Toggle.of(true) })
    })
    return b
  }
  ignoreEvent() { return true }
}

function build(view: EditorView, prefixes: readonly string[]): DecorationSet {
  const doc = view.state.doc
  const reveal = new Set<number>()
  if (view.hasFocus) {
    for (const r of view.state.selection.ranges) {
      for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) reveal.add(l - 1)
    }
  }
  const disabled = !view.state.facet(EditorView.editable)
  const out: Range<Decoration>[] = []
  for (const s of decorationSpecs(doc.toString(), reveal, prefixes)) {
    switch (s.k) {
      case 'hide': out.push(Decoration.replace({}).range(s.from, s.to)); break
      case 'mark': out.push(Decoration.mark({ class: s.cls, attributes: s.attrs }).range(s.from, s.to)); break
      case 'line': out.push(Decoration.line({ class: s.cls }).range(s.at)); break
      case 'bullet': out.push(Decoration.replace({ widget: new BulletWidget() }).range(s.from, s.to)); break
      case 'hr': out.push(Decoration.replace({ widget: new HrWidget() }).range(s.from, s.to)); break
      case 'task': out.push(Decoration.replace({ widget: new TaskWidget(s.checked, disabled) }).range(s.from, s.to)); break
    }
  }
  return Decoration.set(out, true)
}

/**
 * Live preview. Cât tastatura compune un cuvânt (`view.composing` — Gboard,
 * corectura automată, glisarea), decorările NU se recalculează, doar se mută
 * odată cu textul: o decorare schimbată sub compunere strică cuvântul (litere
 * dublate sau pierdute). Recalcularea vine la `compositionend`, printr-o
 * tranzacție goală (`MarkdownEditor`).
 */
export const livePreview = (prefixes: () => readonly string[]) => ViewPlugin.fromClass(class {
  decorations: DecorationSet
  stale = false
  constructor(view: EditorView) { this.decorations = build(view, prefixes()) }
  update(u: ViewUpdate) {
    if (u.view.composing) {
      this.decorations = this.decorations.map(u.changes)
      this.stale = true
      return
    }
    const editableChanged = u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)
    if (this.stale || u.docChanged || u.selectionSet || u.focusChanged || editableChanged) {
      this.stale = false
      this.decorations = build(u.view, prefixes())
    }
  }
}, { decorations: (v) => v.decorations })
```

- [ ] **Step 3: Editorul** — `src/components/MarkdownEditor.tsx`

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  continueList, indentLines, minimalChange, removeMarker, toggleLinePrefix, toggleWrap, type Edit,
} from '../lib/markdown/tasks'
import { External, Toggle, livePreview } from './markdown/livePreview'

export type FormatCmd = 'task' | 'bullet' | 'bold' | 'indent' | 'outdent'
export type EditorHandle = { focus(): void; format(cmd: FormatCmd): void }
export type MarkdownEditorProps = {
  value: string
  onChange(next: string): void
  onCommit(next: string): void
  onFocus?(): void
  onBlur?(): void
  readOnly?: boolean
  placeholder?: string
  ariaLabel: string
  prefixes: readonly string[]
  onRef?(id: string): void
}

type Op = (text: string, from: number, to: number) => Edit | null

function runEdit(view: EditorView, op: Op): boolean {
  if (!view.state.facet(EditorView.editable)) return false
  const text = view.state.doc.toString()
  const sel = view.state.selection.main
  const r = op(text, sel.from, sel.to)
  if (!r) return false
  const c = minimalChange(text, r.text)
  view.dispatch({
    changes: c ?? undefined,
    selection: { anchor: r.anchor, head: r.head ?? r.anchor },
    userEvent: 'input',
    scrollIntoView: true,
  })
  return true
}

const OPS: Record<FormatCmd, Op> = {
  task: (t, f, to) => toggleLinePrefix(t, f, to, 'task'),
  bullet: (t, f, to) => toggleLinePrefix(t, f, to, 'bullet'),
  bold: (t, f, to) => toggleWrap(t, f, to, '**'),
  indent: (t, f, to) => indentLines(t, f, to, 1),
  outdent: (t, f, to) => indentLines(t, f, to, -1),
}

/**
 * Enter continuă lista, Backspace la începutul unui element scoate marcajul
 * (întâi indentarea), Tab doar în listă — în afara ei rămâne navigare.
 * Ctrl+Enter NU e al editorului: e „salvează” în formular, deci `Mod-Enter`
 * iese din `defaultKeymap`.
 */
const markdownKeys = [
  { key: 'Enter', run: (v: EditorView) => runEdit(v, (t, f, to) => (f === to ? continueList(t, f) : null)) },
  { key: 'Backspace', run: (v: EditorView) => runEdit(v, (t, f, to) => (f === to ? removeMarker(t, f) : null)) },
  { key: 'Tab', run: (v: EditorView) => runEdit(v, OPS.indent) },
  { key: 'Shift-Tab', run: (v: EditorView) => runEdit(v, OPS.outdent) },
  { key: 'Mod-b', run: (v: EditorView) => runEdit(v, OPS.bold) },
  { key: 'Mod-i', run: (v: EditorView) => runEdit(v, (t, f, to) => toggleWrap(t, f, to, '*')) },
  { key: 'Mod-l', run: (v: EditorView) => runEdit(v, OPS.task) },
]

/**
 * Descrierea, scrisă: CodeMirror 6 cu live preview. Documentul ESTE stringul
 * descrierii — decorările ascund doar pe ecran, deci textul salvat e exact cel
 * scris. Chunk separat (`DescField` îl încarcă leneș).
 */
const MarkdownEditor = forwardRef<EditorHandle, MarkdownEditorProps>(function MarkdownEditor(p, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const props = useRef(p)
  props.current = p
  const editable = useRef(new Compartment())
  const pending = useRef<string | null>(null)

  const apply = (v: EditorView, value: string) => {
    const c = minimalChange(v.state.doc.toString(), value)
    if (c) v.dispatch({ changes: c, annotations: External.of(true) })
  }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          history(),
          keymap.of(markdownKeys),
          keymap.of([...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'), ...historyKeymap]),
          EditorView.lineWrapping,
          editable.current.of(EditorView.editable.of(!p.readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel, autocapitalize: 'sentences', spellcheck: 'true' }),
          cmPlaceholder(p.placeholder ?? ''),
          livePreview(() => props.current.prefixes),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged) (u.view.hasFocus ? props.current.onFocus : props.current.onBlur)?.()
            if (!u.docChanged || u.transactions.some((t) => t.annotation(External))) return
            const next = u.state.doc.toString()
            if (u.transactions.some((t) => t.annotation(Toggle))) props.current.onCommit(next)
            else props.current.onChange(next)
          }),
          EditorView.domEventHandlers({
            // Linkurile: o atingere le deschide cât NU scrii; când scrii, sunt
            // text de corectat. Ctrl/⌘+click le deschide oricând.
            mousedown: (e, ev) => {
              const el = (e.target as HTMLElement).closest<HTMLElement>('[data-href],[data-ref]')
              if (!el || (ev.hasFocus && !(e.ctrlKey || e.metaKey))) return false
              e.preventDefault()
              if (el.dataset.href) window.open(el.dataset.href, '_blank', 'noopener,noreferrer')
              else if (el.dataset.ref) props.current.onRef?.(el.dataset.ref)
              return true
            },
            compositionend: (_e, ev) => {
              // După compunere: rebaza amânată, apoi o tranzacție goală care
              // lasă pluginul să-și recalculeze decorările.
              setTimeout(() => {
                if (ev.composing) return
                if (pending.current !== null) { apply(ev, pending.current); pending.current = null }
                ev.dispatch({})
              }, 0)
              return false
            },
          }),
        ],
      }),
    })
    view.current = v
    // Pentru testele de browser (Playwright): textul real, cu sintaxa ascunsă inclusă.
    ;(host.current as HTMLDivElement & { hzValue?: () => string }).hzValue = () => v.state.doc.toString()
    return () => { v.destroy(); view.current = null }
    // Montat o dată: valoarea și drepturile intră prin efectele de mai jos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    if (v.composing) { pending.current = p.value; return }
    apply(v, p.value)
  }, [p.value])

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!p.readOnly)) })
  }, [p.readOnly])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    format: (cmd) => { if (view.current) runEdit(view.current, OPS[cmd]) },
  }), [])

  return <div ref={host} className="md-editor" />
})

export default MarkdownEditor
```

- [ ] **Step 4: Câmpul** — `src/components/DescField.tsx`

```tsx
import { Suspense, forwardRef, lazy, useImperativeHandle, useRef } from 'react'
import type { EditorHandle, FormatCmd, MarkdownEditorProps } from './MarkdownEditor'

const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

/** Chemat la pornire, ca editorul să fie gata până deschizi primul tichet. */
export const preloadEditor = () => { void import('./MarkdownEditor') }

/**
 * Descrierea: editorul CodeMirror, încărcat leneș (~100 KB nu întârzie primul
 * cadru). Cât se încarcă, un textarea simplu ține locul, cu aceleași valori —
 * nimic scris acolo nu se pierde la schimbare.
 */
export const DescField = forwardRef<EditorHandle, MarkdownEditorProps & { className?: string }>(
  function DescField({ className = '', ...p }, ref) {
    const editor = useRef<EditorHandle>(null)
    const fallback = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => ({
      focus: () => (editor.current ? editor.current.focus() : fallback.current?.focus()),
      format: (cmd: FormatCmd) => editor.current?.format(cmd),
    }), [])
    return (
      <div className={`md-field ${className}`}>
        <Suspense
          fallback={
            <textarea
              ref={fallback}
              className="md-fallback"
              value={p.value}
              readOnly={p.readOnly}
              placeholder={p.placeholder}
              aria-label={p.ariaLabel}
              onChange={(e) => p.onChange(e.target.value)}
              onFocus={p.onFocus}
              onBlur={p.onBlur}
            />
          }
        >
          <MarkdownEditor ref={editor} {...p} />
        </Suspense>
      </div>
    )
  },
)
```

În `src/App.tsx`, într-un efect existent de montare (sau unul nou, `[]`), cheamă preîncărcarea după primul cadru:

```ts
useEffect(() => {
  const id = window.setTimeout(preloadEditor, 1500)
  return () => window.clearTimeout(id)
}, [])
```

- [ ] **Step 5: Bara** — `src/components/FormatBar.tsx`

```tsx
import type { PointerEvent, MouseEvent } from 'react'
import type { FormatCmd } from './MarkdownEditor'
import { Icon, type IconName } from './Icon'

const ITEMS: [FormatCmd, IconName, string][] = [
  ['task', 'mdTask', 'Căsuță'],
  ['bullet', 'mdList', 'Listă'],
  ['bold', 'mdBold', 'Îngroșat'],
  ['indent', 'mdIndent', 'Indentează'],
]

/** Nu iau focusul: tastatura rămâne sus, cursorul în descriere. */
const keep = (e: PointerEvent | MouseEvent) => e.preventDefault()

/**
 * Patru gesturi deasupra tastaturii, numai cât descrierea are focus. Restul
 * (titluri, linkuri) se scrie de mână. Ieșirea dintr-o indentare e Backspace
 * la începutul elementului.
 */
export function FormatBar({ onFormat }: { onFormat(cmd: FormatCmd): void }) {
  return (
    <div className="md-format" role="toolbar" aria-label="Formatare">
      {ITEMS.map(([cmd, icon, label]) => (
        <button key={cmd} type="button" className="qs-ico" aria-label={label} title={label}
          onPointerDown={keep} onMouseDown={keep} onClick={() => onFormat(cmd)}>
          <Icon name={icon} size={17} />
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Leagă-le în `EditSheet.tsx`**

- Importuri: `DescField` (și `type EditorHandle` din `./MarkdownEditor`), `FormatBar`. Scoate `QuickDesc` din import.
- `const descRef = useRef<EditorHandle>(null)` în loc de `HTMLTextAreaElement`.
- `const [descFocus, setDescFocus] = useState(false)`
- Din store: `projects` există deja, iar `const prefixes = projects.map((p) => p.prefix)`. Din `useUI` ia și `pushSheet`. Apoi:
  `const openRef = (id: string) => (byId[id] ? pushSheet({ kind: 'issue', issueId: id }) : showToast(\`${id} nu e încărcat — deschide-i proiectul.\`))`
  (`byId` din `useHorizontal()`).
- Înlocuiește `<QuickDesc … />` cu:

```tsx
        <DescField
          ref={descRef}
          className="es-desc"
          value={d.desc}
          readOnly={!canWrite}
          placeholder={canWrite ? 'Descriere' : ''}
          ariaLabel="Descrierea sarcinii"
          prefixes={prefixes}
          onRef={openRef}
          onChange={(desc) => a.type({ desc })}
          onCommit={(desc) => void a.commit({ desc })}
          onFocus={() => setDescFocus(true)}
          onBlur={() => { setDescFocus(false); void a.flush() }}
        />
```

- Imediat înainte de `<div className="qs-bar">`: `{descFocus && canWrite && <FormatBar onFormat={(c) => descRef.current?.format(c)} />}`.
- Titlul: `descRef.current?.focus()` rămâne la fel (handle-ul are `focus`).

- [ ] **Step 7: Stilurile editorului** — în blocul „Markdown” din `src/styles.css`:

```css
/* Editorul: tema de bază a CodeMirror se injectează la runtime, DUPĂ foaia
   noastră, și pune `monospace` pe `.cm-scroller` — de-aia `.md-editor.cm-editor`
   (specificitate mai mare), nu doar `.md-editor`. */
.md-field { position: relative; }
.md-editor .cm-editor, .md-editor .cm-editor.cm-focused { outline: none; background: transparent; }
.md-editor .cm-editor .cm-scroller { font-family: var(--display); line-height: 1.6; overflow: visible; }
.md-editor .cm-content { padding: 4px 0; caret-color: var(--accent); }
.md-editor .cm-line { padding: 0; }
.md-editor .cm-editor.cm-focused { box-shadow: 0 0 0 2px var(--accent-soft); border-radius: var(--r-m); }
.md-editor .cm-placeholder { color: var(--txt-faint); font-style: italic; }
.md-editor .cm-line.md-h1, .md-editor .cm-line.md-h2 { padding-top: 0.5em; }
.md-editor .cm-line.md-quote { padding-left: 14px; font-style: italic; color: var(--txt-dim); }
.md-editor .cm-line.md-pre {
  font-family: var(--mono); font-size: calc(13px * var(--text-scale));
  background: var(--surface-2); padding: 0 14px;
}
.md-editor .md-bullet { margin: 0 0.55em 0 0.25em; }
.md-editor .md-task { margin: 0 0.45em 0 0; }
.md-editor .md-hr { display: inline-block; width: 100%; }
.md-fallback {
  width: 100%; min-height: 6em; resize: none; border: 0; outline: none; background: transparent;
  color: var(--txt); font-family: var(--display); font-size: calc(16px * var(--text-scale)); line-height: 1.6;
}
.md-format { display: flex; gap: 4px; padding: 4px 0; }
```

Câmpul `.es-desc` preia din `.qa-desc` (din CSS-ul foii) doar spațiile. Caută regula care stilizează `.edit-sheet .qa-desc` și mută-i proprietățile de spațiere/minim pe `.edit-sheet .es-desc`. Proprietățile de font rămân cele din blocul „Markdown”. `min-height` și creșterea spre ~43% din foaie se păstrează exact cum erau.

- [ ] **Step 8: Actualizează `scripts/test-nav.mjs`**

Sus, lângă `check`:

```js
// Descrierea e un editor CodeMirror (contenteditable), nu un textarea:
// textul real (cu sintaxa ascunsă) se citește prin `hzValue`.
async function descOf(page, scope) {
  const ed = page.locator(`${scope} .md-editor`)
  await ed.waitFor({ timeout: 5000 })
  return ed.evaluate((el) => el.hzValue())
}
async function typeDesc(page, scope, text) {
  const c = page.locator(`${scope} .md-editor .cm-content`)
  await c.waitFor({ timeout: 5000 })
  await c.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(text)
}
```

Înlocuiește:
- linia 551 → `await typeDesc(tel, '.edit-sheet', 'Descriere salvată singură')`;
- linia 557 → `const reDesc = await descOf(tel, '.edit-sheet').catch(() => null)`;
- liniile 600 și 619 → `await tel.locator('.edit-sheet .md-editor .cm-content').focus()`.

Adaugă, după verificarea „descrierea s-a salvat după pauză”:

```js
  // ── Căsuțele din descriere: o atingere bifează, fără focus și fără tastatură ──
  await typeDesc(tel, '.edit-sheet', '- [ ] unu')
  await tel.keyboard.press('Enter')
  await tel.keyboard.type('doi')
  check('Enter continuă lista cu o căsuță nouă', (await descOf(tel, '.edit-sheet')) === '- [ ] unu\n- [ ] doi', JSON.stringify(await descOf(tel, '.edit-sheet')))
  await tel.locator('.edit-sheet .md-editor .cm-content').evaluate((el) => el.blur())
  await tel.waitForTimeout(300)
  const vvBefore = await tel.evaluate(() => visualViewport.height)
  const { tap, center } = await touchApi(tel)
  const [bx, by] = await center(tel.locator('.edit-sheet .md-task').first())
  await tap(bx, by)
  await tel.waitForTimeout(300)
  check('atingerea bifează căsuța', (await descOf(tel, '.edit-sheet')) === '- [x] unu\n- [ ] doi', JSON.stringify(await descOf(tel, '.edit-sheet')))
  check('…fără să ia focusul', !(await tel.evaluate(() => !!document.activeElement?.closest('.md-editor'))), 'focusul în afara editorului')
  check('…și fără să micșoreze ecranul', (await tel.evaluate(() => visualViewport.height)) === vvBefore, 'visualViewport neschimbat')
  check('rândul bifat e tăiat', (await tel.locator('.edit-sheet .md-done').count()) === 1, 'un `.md-done`')

  // ── Compunerea (IME): decorările nu stau în calea unui cuvânt în compunere ──
  const cdp = await tel.context().newCDPSession(tel)
  await tel.locator('.edit-sheet .md-editor .cm-content').click()
  await tel.keyboard.press('Control+End')
  await tel.keyboard.press('Enter')
  await cdp.send('Input.imeSetComposition', { text: 'ș', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'ști', selectionStart: 3, selectionEnd: 3 })
  await cdp.send('Input.insertText', { text: 'știu **tot**' })
  await tel.waitForTimeout(200)
  check('compunerea nu dublează și nu pierde litere', (await descOf(tel, '.edit-sheet')).endsWith('- [ ] știu **tot**'), JSON.stringify(await descOf(tel, '.edit-sheet')))
```

Dacă `touchApi` exportă altfel `tap`/`center`, folosește semnăturile din `scripts/lib-touch.mjs` (`tap(x, y)`, `center(locator)` → `[x, y]`; verifică forma exactă întoarsă de `center`).

- [ ] **Step 9: Rulează**

Run: `npm run typecheck && npx vitest run && npm run test:nav && npm run test:layout`
Expected: totul PASS. Dacă `test:nav` pică la „fără să ia focusul”, verifică dacă `ignoreEvent` + `preventDefault` pe `pointerdown`/`mousedown` ajung pe buton. Nu lărgi testul.

- [ ] **Step 10: Commit**

```bash
git add src/components/markdown src/components/MarkdownEditor.tsx src/components/DescField.tsx src/components/FormatBar.tsx src/components/Icon.tsx src/components/EditSheet.tsx src/App.tsx src/styles.css scripts/test-nav.mjs
git commit -m "feat(markdown): editor live preview în foaia de tichet, cu bifă dintr-o atingere"
```

---

### Task 7: Editorul în formularul complet și în panoul lateral

**Files:**
- Modify: `src/components/IssueForm.tsx` (≈474, 1376-1378, 1506-1512), `src/styles.css` (`.desc-fixed` ≈3865, 3139, 3235, 4306-4312, 4440)
- Modify: `scripts/test-quick-add.mjs:208`

**Interfaces:**
- Consumes: `DescField`, `EditorHandle` (Task 6)

- [ ] **Step 1: Înlocuiește textarea**

- `const descRef = useRef<EditorHandle>(null)`. `descRef.current?.focus()` de la Tab în titlu rămâne la fel.
- Pe lângă `projects`, `byId`, `pushSheet` și `showToast` (ia-le din store / `useUI` dacă nu sunt deja în scope), definește `prefixes` și `openRef` exact ca în `EditSheet`.
- Liniile 1505-1512:

```tsx
            <DescField
              ref={descRef}
              className="desc-fixed"
              value={desc}
              readOnly={!canWrite}
              placeholder="Cerințe, notițe, context…"
              ariaLabel="Descrierea tichetului"
              prefixes={prefixes}
              onRef={openRef}
              onChange={setDesc}
              onCommit={setDesc}
            />
```

Formularul complet are încă butonul Salvează: bifa schimbă doar `desc` local și face formularul „murdar”, iar salvarea rămâne explicită. Ctrl+Enter și Ctrl+S rămân la handlerul de pe `window` (editorul nu le consumă, vezi `Mod-Enter` scos în Task 6).

- [ ] **Step 2: CSS-ul `.desc-fixed`** devine containerul care derulează. Fundalul și chenarul dispar (regula 1; câmpul se vede prin inelul de focus al editorului).

```css
.desc-fixed {
  width: 100%;
  height: 560px;
  overflow-y: auto;
  padding: 4px 2px;
}
.desc-fixed .md-editor { max-width: 68ch; }
```

Șterge din `.desc-fixed` `font-family: var(--mono)`, `font-size`, `background`, `border`, `resize` și `transition`. Șterge `.desc-fixed:focus` și `.desc-fixed::placeholder`. Șterge și variantele `[data-theme='light'] .desc-fixed…` (≈4306-4312). Regulile de înălțime de la ≈3139, ≈3235 și ≈4440 rămân, fiindcă țin geometria coloanei.

- [ ] **Step 3: `scripts/test-quick-add.mjs:208`**

```js
  const savedDesc = await page.locator('.desc-fixed .md-editor').first().evaluate((el) => el.hzValue()).catch(() => null)
```

(Adaugă înainte `await page.locator('.desc-fixed .md-editor').first().waitFor({ timeout: 5000 })`.)

- [ ] **Step 4: O verificare de desktop în `test:nav`.** Pe pagina lată existentă (1400px), deschide un tichet în „Listă”. Pune cursorul în descriere, tastează `a`, apasă `Control+b`, tastează `b`. Verifică `hzValue()` === `'a**b**'`, apoi că Ctrl+Enter salvează: formularul se închide sau panoul rămâne și starea „murdar” dispare, după cum se comportă azi Ctrl+Enter în panou. Copiază aserțiunea din testul existent de Ctrl+Enter, dacă există. Altfel verifică prin reîncărcare că descrierea e `a**b**`.

- [ ] **Step 5: Rulează**

Run: `npm run typecheck && npx vitest run && npm run test:nav && npm run test:layout && npm run test:quick-add`
Expected: totul PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/IssueForm.tsx src/styles.css scripts/test-quick-add.mjs scripts/test-nav.mjs
git commit -m "feat(markdown): editorul în formularul complet și în panoul lateral"
```

---

### Task 8: Bancul de probă, documentația, update-ul și verificarea pe telefon

**Files:**
- Modify: `design/build-preview.py` (ecran nou „Descriere”), `CLAUDE.md` (secțiune nouă), `ticket-kit/README.md` (subsetul)

- [ ] **Step 1: Bancul de probă.** În `design/build-preview.py`, adaugă un ecran „Descriere” după tiparul celorlalte. Conține markup static cu exact clasele din Task 3 și Task 6:
  - un `div.md.issue-desc` cu titlu, paragraf cu `strong`/`code.md-code`, `ul` cu `li.md-li.md-li-task.done` / `li.md-li.md-li-task` și `button.md-task.on` / `button.md-task`, `blockquote`, `pre.md-pre`, `div.md-hr`, `a.md-link`, `button.md-ref`;
  - un rând `.task-row` cu `span.md-progress`;
  - un `div.md-format` cu 4 `button.qs-ico`.

  Rulează `python3 design/build-preview.py`, deschide `design/preview.html` în ambele teme și verifică trei lucruri: căsuța nebifată se vede (inelul nu e invizibil pe fundal), textul bifat e lizibil, iar codul are fundal.

- [ ] **Step 2: Mărimea chunk-ului și update-ul**

Run: `npm run build 2>&1 | command grep -E "MarkdownEditor|index-.*\.js"` și `npm run test:upgrade`
Expected: `MarkdownEditor-*.js` e un chunk separat, ~100–130 KB gzip. Chunk-ul principal crește cu cel mult ~25 KB gzip (`@lezer/markdown` + cititorul). `test:upgrade` trece. Notează mărimile în mesajul de commit.

- [ ] **Step 3: `CLAUDE.md`.** Adaugă o secțiune `## Descrierea în markdown` (după „Foaia de tichet (telefon)”), cu aceste reguli și motivele lor:
  - o gramatică (`mdParser`), două straturi (`MarkdownView` / `MarkdownEditor` lazy);
  - documentul ESTE stringul, deci fără „curățare”;
  - marcajele de bloc sunt mereu desenate, sintaxa inline doar pe linia cu cursorul;
  - bifa nu ia focusul și pleacă prin `commit`;
  - rebaza e amânată cât `view.composing`;
  - `.md-editor.cm-editor` din cauza temei CM injectate la runtime;
  - `hzValue` pentru teste;
  - ce NU e încă (foaia rapidă, bara Linux, `TicketActivity`/widget, tabele).

- [ ] **Step 4: `ticket-kit/README.md`.** Adaugă un paragraf despre subsetul markdown suportat în descrieri, cu lista din spec. Apoi sincronizează prin git în `ticket-kit/`: `cd ticket-kit && git add README.md && git commit -m "docs: markdown în descrieri" && git push origin master`. Repo separat; nu e pushul pe master al aplicației.

- [ ] **Step 5: Commit**

```bash
git add design/build-preview.py design/preview.html CLAUDE.md
git commit -m "docs(markdown): bancul de probă, regulile în CLAUDE.md"
```

- [ ] **Step 6: Verificarea pe telefon (POARTĂ înainte de push).** Pornește `npx vite --host` pe rețeaua locală. Deschide în Chrome pe Redmi (sau în APK cu `HORIZONTAL_URL`, dacă e configurat). Verifică manual și notează rezultatul:
  1. Tastare cu diacritice și corectură automată într-un rând de căsuță: nicio literă dublată sau pierdută.
  2. Tastare prin glisare (Gboard) a două cuvinte într-un rând cu `**bold**` alături.
  3. Enter în mijlocul unui cuvânt compus: rândul se rupe corect, iar lista continuă.
  4. Backspace la începutul unui element indentat: întâi iese un nivel, apoi scoate marcajul.
  5. Atingere pe căsuță cu foaia deschisă fără tastatură: tastatura NU urcă.
  6. Atingere pe un link cu foaia nefocusată: se deschide în browser, nu în WebView.
  7. `TEXT_SCALE=1.5 npm run test:layout` trece.

  Dacă vreunul pică, oprește-te și raportează. **Fără push.**

- [ ] **Step 7: Push** (numai după Step 6 curat): `npm test && npm run typecheck && npm run test:upgrade && git push origin master`.
