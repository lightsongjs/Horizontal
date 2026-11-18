import { Annotation, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { decorationSpecs } from '../../lib/markdown/decorations'
import { tableField } from './tableEditor'
import { minimalChange, toggleTask } from '../../lib/markdown/tasks'
import { codeTextAt } from '../../lib/markdown/blocks'
import { copyText } from '../../lib/clipboard'

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

/** Numărul, desenat în coloana marcajului — același text ca în document. */
class NumWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(o: NumWidget) { return o.text === this.text }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'md-num'
    s.textContent = this.text
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

// Aceleași glife ca `Icon` (lucide: copy / check / x) — widget-ul e DOM, nu React.
const svg = (d: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
export const COPY_GLYPH = {
  idle: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  ok: svg('<path d="M20 6 9 17l-5-5"/>'),
  fail: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
}

/**
 * Butonul de copiere din colțul blocului de cod (ca `CodeCopy` din cititor).
 * Nu ține textul: îl citește din document la clic (`codeTextAt`), fiindcă
 * widget-ul stă pe primul rând, iar o editare mai jos nu-l redesenează.
 */
class CopyWidget extends WidgetType {
  eq() { return true }
  toDOM(view: EditorView) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'md-copy'
    b.contentEditable = 'false'
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (state: 'idle' | 'ok' | 'fail') => {
      b.classList.toggle('copied', state === 'ok')
      b.classList.toggle('copy-failed', state === 'fail')
      b.innerHTML = COPY_GLYPH[state] + (state === 'ok' ? '<span>Copiat</span>' : '')
      const label = state === 'ok' ? 'Copiat' : state === 'fail' ? 'Nu am putut copia' : 'Copiază codul'
      b.setAttribute('aria-label', label)
      b.title = label
    }
    show('idle')
    // Nu ia focusul și nu mută cursorul: altfel gardul s-ar arăta și, pe
    // telefon, ar urca tastatura.
    const keep = (e: Event) => e.preventDefault()
    b.addEventListener('pointerdown', keep)
    b.addEventListener('mousedown', keep)
    b.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      const text = codeTextAt(view.state.doc.toString(), view.posAtDOM(b))
      const ok = text !== null && await copyText(text)
      show(ok ? 'ok' : 'fail')
      clearTimeout(timer)
      timer = setTimeout(() => show('idle'), ok ? 1600 : 4000)
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
      case 'line': out.push(Decoration.line({ class: s.cls, attributes: s.attrs }).range(s.at)); break
      case 'num': out.push(Decoration.replace({ widget: new NumWidget(s.text) }).range(s.from, s.to)); break
      case 'bullet': out.push(Decoration.replace({ widget: new BulletWidget() }).range(s.from, s.to)); break
      case 'hr': out.push(Decoration.replace({ widget: new HrWidget() }).range(s.from, s.to)); break
      case 'task': out.push(Decoration.replace({ widget: new TaskWidget(s.checked, disabled) }).range(s.from, s.to)); break
      case 'copy': out.push(Decoration.widget({ widget: new CopyWidget(), side: -1 }).range(s.at)); break
    }
  }
  // `\r` dintr-un text CRLF rămâne în document (`lineSeparator`), dar nu se
  // desenează — numai unde nu-l acoperă deja o ascundere.
  const text = doc.toString()
  const hidden = out.filter((r) => r.value.point && r.from < r.to)
  for (let i = text.indexOf('\r'); i >= 0; i = text.indexOf('\r', i + 1)) {
    if (!hidden.some((r) => r.from <= i && i < r.to)) out.push(Decoration.replace({}).range(i, i + 1))
  }
  // `decorationSpecs` nu le dă sortate; `true` = sortează aici.
  return Decoration.set(out, true)
}

/** Rândurile (din documentul nou) atinse de schimbările unei actualizări. */
function changedLines(u: ViewUpdate): { from: number; to: number }[] {
  const doc = u.state.doc
  const out: { from: number; to: number }[] = []
  u.changes.iterChangedRanges((_fa, _ta, from, to) => {
    out.push({ from: doc.lineAt(from).from, to: doc.lineAt(to).to })
  })
  return out
}

/**
 * `old`, cu decorările de pe `lines` luate din `fresh`. Restul rămân exact cum
 * erau — inclusiv pe rândul în compunere, dacă nu e printre ele.
 */
function redrawLines(old: DecorationSet, fresh: DecorationSet, lines: { from: number; to: number }[]): DecorationSet {
  const on = (from: number, to: number) => lines.some((l) => from <= l.to && to >= l.from)
  if (!lines.length) return old
  const add: Range<Decoration>[] = []
  const lo = Math.min(...lines.map((l) => l.from))
  const hi = Math.max(...lines.map((l) => l.to))
  fresh.between(lo, hi, (from, to, value) => { if (on(from, to)) add.push(value.range(from, to)) })
  return old.update({ filter: (from, to) => !on(from, to), add, sort: true })
}

/**
 * Live preview. Cât tastatura compune un cuvânt (`view.composing` — Gboard,
 * corectura automată, glisarea), decorările NU se recalculează, doar se mută
 * odată cu textul: o decorare schimbată sub compunere strică cuvântul (litere
 * dublate sau pierdute). Recalcularea vine la `compositionend`, printr-o
 * tranzacție goală (`MarkdownEditor`).
 */
export const livePreview = (prefixes: () => readonly string[]): Extension => [tableField(prefixes), ViewPlugin.fromClass(class {
  decorations: DecorationSet
  stale = false
  constructor(view: EditorView) { this.decorations = build(view, prefixes()) }
  update(u: ViewUpdate) {
    if (u.view.composing) {
      this.decorations = this.decorations.map(u.changes)
      this.stale = true
      // O bifă NU încheie compunerea: pe telefon, cât descrierea are focus,
      // Gboard ține mereu cuvântul de sub cursor „în compunere", iar atingerea
      // căsuței nu mută cursorul. Doar mutate, decorările ar fi lăsat căsuța
      // desenată ca înainte (documentul se schimbase și se salva), iar a doua
      // atingere o debifa pe ascuns — „bifa nu merge" (D-187). Rândurile bifate
      // se redesenează deci acum; restul așteaptă `compositionend`.
      if (u.transactions.some((t) => t.annotation(Toggle))) {
        this.decorations = redrawLines(this.decorations, build(u.view, prefixes()), changedLines(u))
      }
      return
    }
    const editableChanged = u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)
    if (this.stale || u.docChanged || u.selectionSet || u.focusChanged || editableChanged) {
      this.stale = false
      this.decorations = build(u.view, prefixes())
    }
  }
}, { decorations: (v) => v.decorations })]
