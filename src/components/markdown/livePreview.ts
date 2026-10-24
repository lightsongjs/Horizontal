import { Annotation, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { decorationSpecs } from '../../lib/markdown/decorations'
import { toBlocks, type Inline } from '../../lib/markdown/blocks'
import { mdParser } from '../../lib/markdown/parse'
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

/** Rândurile din celula unui tabel, ca DOM — aceleași clase ca restul editorului. */
function inlineDom(list: Inline[], into: HTMLElement) {
  for (const x of list) {
    switch (x.t) {
      case 'text': into.append(x.text); break
      case 'br': into.append(document.createElement('br')); break
      case 'code': { const c = document.createElement('code'); c.className = 'md-code'; c.textContent = x.text; into.append(c); break }
      case 'ref': { const r = document.createElement('span'); r.className = 'md-ref'; r.dataset.ref = x.id; r.textContent = x.id; into.append(r); break }
      case 'link': { const a = document.createElement('span'); a.className = 'md-link'; a.dataset.href = x.href; inlineDom(x.children, a); into.append(a); break }
      default: { const e = document.createElement(x.t); inlineDom(x.children, e); into.append(e) }
    }
  }
}

/**
 * Tabelul desenat cât cursorul nu e în el. Un clic pe un rând pune cursorul
 * pe rândul de text corespunzător (antetul = primul, apoi după rândul `|---|`),
 * deci tabelul se deschide ca text exact unde ai dat clic.
 */
class TableWidget extends WidgetType {
  constructor(readonly text: string, readonly prefixes: readonly string[]) { super() }
  eq(o: TableWidget) { return o.text === this.text && o.prefixes.join() === this.prefixes.join() }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'md-table-wrap'
    const b = toBlocks(this.text, this.prefixes)[0]
    if (!b || b.t !== 'table') { wrap.textContent = this.text; return wrap }
    const t = document.createElement('table')
    t.className = 'md-table'
    const row = (cells: Inline[][], tag: 'th' | 'td', line: number) => {
      const tr = document.createElement('tr')
      tr.dataset.line = String(line)
      cells.forEach((c, j) => {
        const td = document.createElement(tag)
        if (b.align[j]) td.style.textAlign = b.align[j]!
        inlineDom(c, td)
        tr.append(td)
      })
      return tr
    }
    const head = document.createElement('thead')
    head.append(row(b.head, 'th', 0))
    const body = document.createElement('tbody')
    b.rows.forEach((r, k) => body.append(row(r, 'td', k + 2)))
    t.append(head, body)
    wrap.append(t)
    wrap.addEventListener('mousedown', (e) => {
      const el = e.target as HTMLElement
      // Linkurile le lasă editorului (regula lui: deschise cât nu scrii).
      if (el.closest('[data-href],[data-ref]') && !view.hasFocus) return
      e.preventDefault()
      if (!view.state.facet(EditorView.editable)) return
      const from = view.posAtDOM(wrap)
      const line = view.state.doc.lineAt(from).number + Number(el.closest('tr')?.dataset.line ?? 0)
      const at = view.state.doc.line(Math.min(line, view.state.doc.lines))
      view.focus()
      view.dispatch({ selection: { anchor: at.to } })
    })
    return wrap
  }
  ignoreEvent(e: Event) {
    return !(e.target instanceof HTMLElement && e.target.closest('[data-href],[data-ref]'))
  }
}

const setFocus = StateEffect.define<boolean>()

type Tables = { ranges: { from: number; to: number }[]; focused: boolean; deco: DecorationSet }

/**
 * Tabelele ca bloc: un widget care acoperă mai multe rânduri trebuie să vină
 * dintr-un `StateField` (un `ViewPlugin` n-are voie să înlocuiască peste
 * capete de rând). Regula e a marcajelor de bloc, dar pe tot tabelul: desenat
 * cât cursorul (sau selecția) nu atinge niciunul din rândurile lui, text cât
 * îl atinge — un tabel se editează ca text. Focusul intră în stare prin
 * `focusChangeEffect`: fără focus, cursorul rămas în tabel nu-l mai ține brut.
 */
const tableField = (prefixes: () => readonly string[]): Extension => {
  const rangesOf = (state: EditorState) => {
    const out: { from: number; to: number }[] = []
    mdParser.parse(state.doc.toString()).iterate({
      enter(n) {
        if (n.name === 'Table') { out.push({ from: n.from, to: n.to }); return false }
        // Un tabel într-o listă sau într-un citat rămâne text: widgetul de
        // bloc ar fi înghițit marcajele din fața rândurilor.
        if (n.name !== 'Document') return false
      },
    })
    return out
  }
  const decoOf = (state: EditorState, ranges: Tables['ranges'], focused: boolean) => {
    const out: Range<Decoration>[] = []
    for (const r of ranges) {
      const a = state.doc.lineAt(r.from), z = state.doc.lineAt(r.to)
      const touched = focused && state.selection.ranges.some((s) => s.from <= z.to && s.to >= a.from)
      if (touched) continue
      out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(a.from, z.to), prefixes()), block: true }).range(a.from, z.to))
    }
    return Decoration.set(out)
  }
  const field = StateField.define<Tables>({
    create(state) {
      const ranges = rangesOf(state)
      return { ranges, focused: false, deco: decoOf(state, ranges, false) }
    },
    update(v, tr) {
      let focused = v.focused
      for (const e of tr.effects) if (e.is(setFocus)) focused = e.value
      if (!tr.docChanged && !tr.selection && focused === v.focused) return v
      const ranges = tr.docChanged ? rangesOf(tr.state) : v.ranges
      return { ranges, focused, deco: decoOf(tr.state, ranges, focused) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return [field, EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing))]
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
