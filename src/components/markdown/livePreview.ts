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
  // `decorationSpecs` nu le dă sortate; `true` = sortează aici.
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
