import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder, tooltips } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  continueList, indentLines, minimalChange, removeMarker, toggleLinePrefix, toggleWrap, type Edit,
} from '../lib/markdown/tasks'
import { Echoes } from '../lib/markdown/rebase'
import { External, Toggle, livePreview } from './markdown/livePreview'
import { tableEntryKeys } from './markdown/tableEditor'
import { slashMenu } from './markdown/slash'

export type FormatCmd = 'task' | 'bullet' | 'bold' | 'indent' | 'outdent'
/** `focusEnd`: cursorul la capătul textului — o atingere sub text (`DescFold`). */
export type EditorHandle = { focus(): void; focusEnd(): void; format(cmd: FormatCmd): void }
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
  /**
   * Chemat o dată, la montare: unde era cursorul în textarea-ul de rezervă,
   * dacă avea focusul când a sosit editorul (`DescField`). `null` = n-avea.
   */
  takeFocus?(): number | null
}

/** O celulă de tabel în compunere (Gboard, diacritice). */
const composingCells = new WeakSet<Element>()
if (typeof document !== 'undefined') {
  document.addEventListener('compositionstart', (e) => { if (e.target instanceof HTMLTextAreaElement) composingCells.add(e.target) }, true)
  document.addEventListener('compositionend', (e) => { if (e.target instanceof HTMLTextAreaElement) composingCells.delete(e.target) }, true)
}
function cellComposing(root: Element | null): boolean {
  const a = document.activeElement
  return !!root && a instanceof HTMLTextAreaElement && a.classList.contains('md-cell-input') && root.contains(a) && composingCells.has(a)
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
  // Ce a trimis editorul însuși: o valoare care se întoarce prin ciorna
  // autosave-ului e ecou, nu rebază (`Echoes`).
  const echoes = useRef(new Echoes())

  const apply = (v: EditorView, value: string) => {
    const doc = v.state.doc.toString()
    if (!echoes.current.shouldApply(value, doc)) return
    echoes.current.applied()
    const c = minimalChange(doc, value)
    // Rebaza nu intră în istoric: un Ctrl+Z ar fi desfăcut-o și ar fi trimis
    // înapoi, ca scriere a omului, textul de dinainte de ea.
    if (c) v.dispatch({ changes: c, annotations: [External.of(true), Transaction.addToHistory.of(false)] })
  }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          // Documentul ESTE descrierea, octet cu octet. Implicit CodeMirror
          // desparte rândurile și pe `\r\n`, iar `toString()` întoarce `\n`:
          // un text venit de pe Windows s-ar fi rescris la prima bifă (și,
          // prin rebaza cu `\r`, cu un rând gol în plus la fiecare rând).
          // Așa `\r` rămâne un caracter la capăt de rând, ascuns de plugin.
          EditorState.lineSeparator.of('\n'),
          history(),
          keymap.of([...tableEntryKeys, ...markdownKeys]),
          slashMenu,
          // Meniul „/” în `body`: cutia pliată a descrierii l-ar fi tăiat.
          tooltips({ parent: document.body }),
          keymap.of([...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'), ...historyKeymap]),
          EditorView.lineWrapping,
          editable.current.of(EditorView.editable.of(!p.readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel, autocapitalize: 'sentences', spellcheck: 'true' }),
          cmPlaceholder(p.placeholder ?? ''),
          livePreview(() => props.current.prefixes),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(External))) return
            const next = u.state.doc.toString()
            echoes.current.emitted(next)
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
    // Focusul „în descriere” e al cutiei întregi, nu doar al lui CodeMirror:
    // o celulă de tabel (`tableEditor`) e un câmp în interiorul editorului, iar
    // `hasFocus` l-ar fi raportat ca ieșire (bara de format, rândul de fir).
    const root = host.current!
    let inside = false
    const onIn = () => { if (!inside) { inside = true; props.current.onFocus?.() } }
    const onOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return
      // Meniul unui tabel stă în `body`; focusul revine în celulă imediat.
      setTimeout(() => {
        if (root.contains(document.activeElement)) return
        if (inside) { inside = false; props.current.onBlur?.() }
      }, 0)
    }
    // Compunerea dintr-o celulă: CodeMirror n-o vede (`view.composing`), deci
    // rebaza din store se amână și pentru ea, ca pentru editor.
    const onCellCompEnd = () => setTimeout(() => {
      if (cellComposing(root)) return
      if (pending.current !== null) { apply(v, pending.current); pending.current = null }
    }, 0)
    root.addEventListener('focusin', onIn)
    root.addEventListener('focusout', onOut)
    root.addEventListener('compositionend', onCellCompEnd)
    const at = p.takeFocus?.() ?? null
    if (at !== null && !p.readOnly) {
      v.focus()
      v.dispatch({ selection: { anchor: Math.min(at, v.state.doc.length) } })
    }
    // Pentru testele de browser (Playwright): textul real, cu sintaxa ascunsă inclusă.
    ;(host.current as HTMLDivElement & { hzValue?: () => string }).hzValue = () => v.state.doc.toString()
    return () => {
      root.removeEventListener('focusin', onIn)
      root.removeEventListener('focusout', onOut)
      root.removeEventListener('compositionend', onCellCompEnd)
      v.destroy(); view.current = null
    }
    // Montat o dată: valoarea și drepturile intră prin efectele de mai jos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    if (v.composing || cellComposing(host.current)) { pending.current = p.value; return }
    apply(v, p.value)
  }, [p.value])

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!p.readOnly)) })
  }, [p.readOnly])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    focusEnd: () => {
      const v = view.current
      if (!v) return
      v.focus()
      v.dispatch({ selection: { anchor: v.state.doc.length } })
    },
    format: (cmd) => { if (view.current) runEdit(view.current, OPS[cmd]) },
  }), [])

  return <div ref={host} className="md-editor" />
})

export default MarkdownEditor
