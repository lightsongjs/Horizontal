import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { newTable } from '../../lib/markdown/table'
import { focusTableAt } from './tableEditor'

/**
 * Meniul „/” (ca în Obsidian): pe un rând gol — sau imediat după marcajul unei
 * liste — „/” deschide blocurile, filtrate pe ce scrii după el. Numai acolo:
 * după un cuvânt, „și / sau” sau „1/2” sunt text, nu o comandă.
 * Fiecare intrare se caută și în română, și în engleză („/table”, „/tabel”).
 */
type Cmd = { label: string; hint: string; keys: string; insert: string; caret?: number; table?: boolean }

const CMDS: Cmd[] = [
  { label: 'Tabel', hint: '', keys: 'tabel table grila', insert: '', table: true },
  { label: 'Listă de bifat', hint: '- [ ]', keys: 'bifat bife checklist todo task sarcini', insert: '- [ ] ' },
  { label: 'Listă', hint: '-', keys: 'lista bullet buline list', insert: '- ' },
  { label: 'Listă numerotată', hint: '1.', keys: 'numerotata numbered ordered numere', insert: '1. ' },
  { label: 'Titlu 1', hint: '#', keys: 'titlu heading h1', insert: '# ' },
  { label: 'Titlu 2', hint: '##', keys: 'titlu heading h2 subtitlu', insert: '## ' },
  { label: 'Titlu 3', hint: '###', keys: 'titlu heading h3', insert: '### ' },
  { label: 'Citat', hint: '>', keys: 'citat quote', insert: '> ' },
  { label: 'Cod', hint: '```', keys: 'cod code bloc', insert: '```\n\n```', caret: 4 },
  { label: 'Separator', hint: '---', keys: 'separator linie hr divider', insert: '---\n' },
]

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Ce comenzi se potrivesc cu ce s-a scris după „/” — pur, pentru teste. */
export function slashMatches(query: string): string[] {
  const q = fold(query.trim())
  return CMDS.filter((c) => !q || fold(c.label).includes(q) || c.keys.split(' ').some((k) => k.startsWith(q))).map((c) => c.label)
}

function apply(cmd: Cmd) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const line = view.state.doc.lineAt(from)
    if (cmd.table) {
      // Tabelul își ia rândul lui (marcajul de listă din față iese), iar sub
      // el rămâne un rând — altfel Esc din ultima celulă n-ar avea unde duce.
      // Rândul gol de după îl încheie (în GFM textul lipit de tabel e un rând al lui).
      const after = view.state.doc.sliceString(to, line.to)
      const insert = newTable() + '\n\n' + after
      view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + newTable().length + 2 }, userEvent: 'input.complete' })
      requestAnimationFrame(() => focusTableAt(view, line.from, 0, 0))
      return
    }
    // Un bloc ia locul marcajului de listă scris înainte de „/”.
    view.dispatch({
      changes: { from: line.from, to, insert: cmd.insert },
      selection: { anchor: line.from + (cmd.caret ?? cmd.insert.length) },
      userEvent: 'input.complete',
    })
  }
}

function source(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?\/[\p{L}\d]*$/u)
  if (!m) return null
  const slash = m.from + m.text.lastIndexOf('/')
  const q = ctx.state.sliceDoc(slash + 1, ctx.pos)
  const labels = new Set(slashMatches(q))
  const options = CMDS.filter((c) => labels.has(c.label)).map((c, i): Completion => ({
    label: c.label, detail: c.hint, apply: apply(c), boost: -i,
  }))
  if (!options.length) return null
  return { from: slash, to: ctx.pos, options, filter: false }
}

export const slashMenu = autocompletion({
  override: [source],
  icons: false,
  activateOnTyping: true,
  closeOnBlur: true,
  tooltipClass: () => 'md-slash',
})
