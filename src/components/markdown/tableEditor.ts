import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { toBlocks, type Inline } from '../../lib/markdown/blocks'
import { mdParser } from '../../lib/markdown/parse'
import { minimalChange } from '../../lib/markdown/tasks'
import {
  cellIn, deleteCol, deleteRow, editCell, formatTable, insertCol, insertRow, parseTable, setCell, type TableModel,
} from '../../lib/markdown/table'

/**
 * Tabelul din editor: desenat MEREU, editat pe celule (cerința omului,
 * 2026-10-24: „la clic să-și păstreze forma de tabel”). Un clic pe o celulă
 * o face câmp (`textarea`) cu markdown-ul brut NUMAI al ei; restul rămân
 * desenate. Fiecare tastă scrie doar golul celulei în document (`editCell`),
 * deci un tabel aliniat rămâne aliniat, iar anularea grupează literele ca la
 * scrisul obișnuit. Operațiile de structură (rând, coloană) rescriu tabelul în
 * forma minimă — acolo nu mai e nimic de păstrat.
 *
 * Widgetul își păstrează DOM-ul între scrieri (`updateDOM`): un widget nou
 * la fiecare tastă ar fi demontat câmpul cu focusul în el.
 */

/** Cu marcajul omului: „Editează ca text” pentru tabelul care începe aici. */
const rawAt = StateEffect.define<number>()

type Field = { ranges: { from: number; to: number }[]; raw: number[]; deco: DecorationSet }

/** Celula în editare, pe tabel — doar una în tot documentul, ca focusul. */
type Pos = { r: number; c: number }

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

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

const PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
const DOTS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'

/** Un buton care nu ia focusul: câmpul din celulă rămâne cu tastatura sus. */
function keepFocus(b: HTMLElement) {
  const keep = (e: Event) => e.preventDefault()
  b.addEventListener('pointerdown', keep)
  b.addEventListener('mousedown', keep)
}

class Controller {
  view: EditorView
  w: TableWidget
  model: TableModel
  cells: Inline[][][] = []
  editing: (Pos & { ta: HTMLTextAreaElement; td: HTMLElement }) | null = null
  menu: HTMLElement | null = null
  readonly wrap: HTMLElement
  readonly scroll: HTMLElement
  readonly table: HTMLTableElement
  readonly addCol: HTMLButtonElement
  readonly addRow: HTMLButtonElement
  readonly more: HTMLButtonElement

  constructor(view: EditorView, w: TableWidget) {
    this.view = view
    this.w = w
    this.model = parseTable(w.text) ?? { align: [], rows: [] }
    this.wrap = el('div', 'md-table-wrap md-table-edit')
    this.scroll = el('div', 'md-table-scroll')
    this.table = el('table', 'md-table')
    this.scroll.append(this.table)
    this.addCol = el('button', 'md-table-add md-table-add-col')
    this.addRow = el('button', 'md-table-add md-table-add-row')
    this.more = el('button', 'md-table-more')
    for (const [b, label, html] of [[this.addCol, 'Coloană nouă', PLUS], [this.addRow, 'Rând nou', PLUS], [this.more, 'Tabel: rânduri și coloane', DOTS]] as const) {
      b.type = 'button'
      b.title = label
      b.setAttribute('aria-label', label)
      b.innerHTML = html
      keepFocus(b)
    }
    this.addCol.addEventListener('click', () => this.structure((m) => insertCol(m, m.align.length), { r: this.editing?.r ?? 0, c: this.model.align.length }))
    this.addRow.addEventListener('click', () => this.structure((m) => insertRow(m, m.rows.length), { r: this.model.rows.length, c: this.editing?.c ?? 0 }))
    this.more.addEventListener('click', () => (this.menu ? this.closeMenu() : this.openMenu()))
    this.wrap.append(this.scroll, this.addCol, this.addRow)
    this.wrap.addEventListener('mousedown', (e) => this.onMouseDown(e))
    ;(this.wrap as HTMLElement & { hzTable?: Controller }).hzTable = this
    this.render()
  }

  get from() { return this.view.posAtDOM(this.wrap) }
  get editable() { return this.w.canEdit }

  /** Desenul întreg (structura s-a schimbat sau e prima oară). */
  render() {
    const keep = this.editing ? { r: this.editing.r, c: this.editing.c, at: this.editing.ta.selectionStart } : null
    this.editing = null
    this.more.remove()
    const b = toBlocks(this.w.text, this.w.prefixes)[0]
    this.cells = b && b.t === 'table' ? [b.head, ...b.rows] : this.model.rows.map((r) => r.map((c) => [{ t: 'text' as const, text: c }]))
    this.table.replaceChildren()
    this.wrap.classList.toggle('editable', this.editable)
    const head = el('thead'), body = el('tbody')
    if (this.model.rows[0]?.every((c) => !c.trim()) && !this.editable) head.className = 'md-thead-empty'
    this.model.rows.forEach((row, r) => {
      const tr = el('tr')
      row.forEach((_, c) => {
        const td = el(r === 0 ? 'th' : 'td')
        td.dataset.r = String(r)
        td.dataset.c = String(c)
        const a = this.model.align[c]
        if (a) td.style.textAlign = a
        this.paint(td, r, c)
        tr.append(td)
      })
      ;(r === 0 ? head : body).append(tr)
    })
    this.table.append(head, body)
    if (keep && this.model.rows[keep.r]?.[keep.c] !== undefined) this.focusCell(keep.r, keep.c, keep.at)
  }

  /** O celulă desenată (nu în editare). */
  paint(td: HTMLElement, r: number, c: number) {
    const d = el('div', 'md-cell')
    inlineDom(this.cells[r]?.[c] ?? [], d)
    // Numai într-un antet complet gol (tabel nou): colțul gol lăsat deliberat
    // („| | La Netvisor |”) nu e o celulă de completat.
    if (r === 0 && this.editable && this.model.rows[0].every((x) => !x.trim())) d.dataset.ph = `Coloana ${c + 1}`
    td.replaceChildren(d)
  }

  td(r: number, c: number): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)
  }

  /** O versiune nouă a textului (tasta noastră, anulare, rebază din store). */
  update(w: TableWidget) {
    const prev = this.model
    const editableChanged = w.canEdit !== this.w.canEdit
    this.w = w
    this.model = parseTable(w.text) ?? { align: [], rows: [] }
    const same = !editableChanged && prev.rows.length === this.model.rows.length && prev.align.length === this.model.align.length &&
      prev.align.every((a, i) => a === this.model.align[i])
    if (!same) {
      // Structura s-a schimbat sub noi (o anulare a unui rând nou): celula din
      // editare poate să nu mai existe, deci cursorul se întoarce în editor.
      const ed = this.editing
      this.render()
      if (ed && !this.editing) this.exit('above-start')
      return
    }
    const b = toBlocks(w.text, w.prefixes)[0]
    this.cells = b && b.t === 'table' ? [b.head, ...b.rows] : this.cells
    this.model.rows.forEach((row, r) => row.forEach((v, c) => {
      const ed = this.editing
      if (ed && ed.r === r && ed.c === c) {
        // Câmpul ține rândul nou, documentul `<br>`: se compară descifrat.
        if (ed.ta.value !== cellIn(v)) { ed.ta.value = cellIn(v); this.mirror() }
        return
      }
      if (prev.rows[r][c] !== v || r === 0) { const td = this.td(r, c); if (td) this.paint(td, r, c) }
    }))
  }

  /** Celula `r`,`c` devine câmp. `at` = poziția cursorului (implicit la capăt). */
  focusCell(r: number, c: number, at?: number) {
    if (!this.editable) return
    const td = this.td(r, c)
    if (!td) return
    if (this.editing && (this.editing.r !== r || this.editing.c !== c)) this.close()
    if (!this.editing) {
      const grow = el('div', 'md-cell-grow')
      const ta = el('textarea', 'md-cell-input')
      ta.rows = 1
      ta.value = cellIn(this.model.rows[r][c])
      ta.spellcheck = true
      ta.setAttribute('aria-label', r === 0 ? `Antet, coloana ${c + 1}` : `Rândul ${r}, coloana ${c + 1}`)
      if (r === 0 && this.model.rows[0].every((x) => !x.trim())) ta.placeholder = `Coloana ${c + 1}`
      grow.append(ta)
      td.replaceChildren(grow)
      td.append(this.more)
      this.editing = { r, c, ta, td }
      this.mirror()
      ta.addEventListener('input', () => this.onInput())
      ta.addEventListener('keydown', (e) => this.onKey(e))
      ta.addEventListener('blur', () => setTimeout(() => {
        // Focusul a plecat din tabel (nu pe altă celulă, nu în meniu).
        if (this.editing?.ta === ta && document.activeElement !== ta && !this.menu) this.close()
      }, 0))
    }
    const ta = this.editing!.ta
    ta.focus({ preventScroll: true })
    const p = at ?? ta.value.length
    ta.setSelectionRange(p, p)
    // Pe telefon, celula urcă deasupra tastaturii.
    requestAnimationFrame(() => ta.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }

  /** Textul ascuns de sub câmp dă mărimea celulei (rândul crește singur). */
  mirror() {
    const ed = this.editing
    if (ed) ed.ta.parentElement!.dataset.v = ed.ta.value + ' '
  }

  close() {
    const ed = this.editing
    if (!ed) return
    this.editing = null
    this.closeMenu()
    this.more.remove()
    if (ed.td.isConnected) this.paint(ed.td, ed.r, ed.c)
  }

  write(next: string, userEvent: string) {
    const c = minimalChange(this.w.text, next)
    if (!c) return
    const from = this.from
    this.view.dispatch({ changes: { from: from + c.from, to: from + c.to, insert: c.insert }, userEvent })
  }

  onInput() {
    const ed = this.editing!
    // Rândurile noi (Shift/Ctrl+Enter, sau lipite) rămân rânduri în câmp și
    // pleacă în document ca `<br>` (`cellOut`); doar CR-ul lipit se aduce la `\n`.
    if (ed.ta.value.includes('\r')) {
      const at = ed.ta.selectionStart
      ed.ta.value = ed.ta.value.replace(/\r\n?/g, '\n')
      ed.ta.setSelectionRange(Math.min(at, ed.ta.value.length), Math.min(at, ed.ta.value.length))
    }
    this.mirror()
    const v = ed.ta.value
    const next = editCell(this.w.text, ed.r, ed.c, v) ?? formatTable(setCell(this.model, ed.r, ed.c, v))
    this.write(next, 'input.type')
  }

  /** O operație de structură: tabelul rescris, apoi focusul pe `to`. */
  structure(op: (m: TableModel) => TableModel, to: Pos | null) {
    if (!this.editable) return
    this.closeMenu()
    const next = op(this.model)
    if (next === this.model) return
    this.close()
    this.write(formatTable(next), 'input.table')
    if (to) this.focusCell(Math.min(to.r, next.rows.length - 1), Math.min(to.c, next.align.length - 1))
  }

  /** Cursorul înapoi în editor, deasupra sau dedesubt. Un rând gol se face dacă nu e. */
  exit(where: 'above' | 'below' | 'above-start') {
    this.close()
    const v = this.view
    const from = this.from
    const to = from + this.w.text.length
    if (where === 'below') {
      // În GFM un rând scris imediat sub tabel e încă un rând al lui; tabelul
      // se încheie abia la un rând gol. Deci cursorul ajunge DUPĂ rândul gol
      // (făcut acum dacă lipsește), nu lipit de tabel.
      const doc = v.state.doc
      if (to >= doc.length) v.dispatch({ changes: { from: to, insert: '\n\n' }, selection: { anchor: to + 2 } })
      else {
        const l1 = doc.lineAt(to + 1)
        const l2 = l1.number < doc.lines ? doc.line(l1.number + 1) : null
        if (l1.text.trim()) v.dispatch({ changes: { from: to, insert: '\n\n' }, selection: { anchor: to + 2 } })
        else if (l2 && !l2.text.trim()) v.dispatch({ selection: { anchor: l2.from } })
        else v.dispatch({ changes: { from: l1.from, insert: '\n' }, selection: { anchor: l1.from + 1 } })
      }
    } else if (where === 'above') {
      if (from === 0) v.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 } })
      else v.dispatch({ selection: { anchor: from - 1 } })
    } else {
      v.dispatch({ selection: { anchor: Math.max(0, from - 1) } })
    }
    v.focus()
  }

  onKey(e: KeyboardEvent) {
    const ed = this.editing
    if (!ed) return
    const { r, c } = ed
    const rows = this.model.rows.length, cols = this.model.align.length
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    // Anularea e a editorului, nu a câmpului: istoria nativă a unui textarea
    // nou n-ar ști nimic din ce s-a scris înainte.
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault()
      if (k === 'y' || e.shiftKey) redo(this.view)
      else undo(this.view)
      return
    }
    if (e.isComposing) return
    // Shift / Ctrl / ⌘ + Enter: rând nou ÎN celulă (`<br>` în sursă). Oprit
    // aici, ca Ctrl+Enter să nu ajungă și la „salvează” din formular
    // (`IssueForm`, pe `window`) sau la dispecerul Vim.
    if (e.key === 'Enter' && !e.altKey && (e.shiftKey || mod)) {
      e.preventDefault()
      e.stopPropagation()
      ed.ta.setRangeText('\n', ed.ta.selectionStart, ed.ta.selectionEnd, 'end')
      this.onInput()
      return
    }
    if (e.altKey || mod) return
    const go = (rr: number, cc: number) => { e.preventDefault(); this.focusCell(rr, cc) }
    switch (e.key) {
      case 'Tab':
        if (e.shiftKey) {
          if (c > 0) go(r, c - 1)
          else if (r > 0) go(r - 1, cols - 1)
          else { e.preventDefault(); this.exit('above') }
        } else if (c < cols - 1) go(r, c + 1)
        else if (r < rows - 1) go(r + 1, 0)
        else { e.preventDefault(); this.structure((m) => insertRow(m, m.rows.length), { r: rows, c: 0 }) }
        return
      case 'Enter':
        e.preventDefault()
        if (r < rows - 1) this.focusCell(r + 1, c)
        else this.structure((m) => insertRow(m, m.rows.length), { r: rows, c })
        return
      case 'ArrowUp':
        // Într-o celulă cu mai multe rânduri, ↑/↓ merg întâi printre ele.
        if (e.shiftKey || (ed.ta.selectionStart > 0 && ed.ta.value.lastIndexOf('\n', ed.ta.selectionStart - 1) >= 0)) return
        if (r > 0) go(r - 1, c)
        else { e.preventDefault(); this.exit('above') }
        return
      case 'ArrowDown':
        if (e.shiftKey || ed.ta.value.indexOf('\n', ed.ta.selectionEnd) >= 0) return
        if (r < rows - 1) go(r + 1, c)
        else { e.preventDefault(); this.exit('below') }
        return
    }
  }

  onMouseDown(e: MouseEvent) {
    const t = e.target as HTMLElement
    if (t.closest('.md-table-add, .md-table-more, .md-cell-input')) return
    // Linkurile: Ctrl/⌘+clic le deschide (sau orice clic, fără drept de
    // scriere) — le lasă editorului (`ignoreEvent`). Altfel clicul scrie.
    if (t.closest('[data-href],[data-ref]') && (e.ctrlKey || e.metaKey || !this.editable)) return
    e.preventDefault()
    const td = t.closest<HTMLElement>('th, td')
    if (td && this.editable) this.focusCell(Number(td.dataset.r), Number(td.dataset.c))
  }

  openMenu() {
    const ed = this.editing
    if (!ed) return
    const { r, c } = ed
    const m = el('div', 'md-table-menu')
    m.setAttribute('role', 'menu')
    const item = (label: string, run: () => void, opts: { off?: boolean; danger?: boolean } = {}) => {
      const b = el('button', `md-table-mi${opts.danger ? ' danger' : ''}`)
      b.type = 'button'
      b.textContent = label
      b.setAttribute('role', 'menuitem')
      b.disabled = !!opts.off
      keepFocus(b)
      b.addEventListener('click', run)
      m.append(b)
    }
    const sep = () => m.append(el('div', 'md-table-sep'))
    item('Rând deasupra', () => this.structure((x) => insertRow(x, r), { r, c }), { off: r === 0 })
    item('Rând dedesubt', () => this.structure((x) => insertRow(x, r + 1), { r: r + 1, c }))
    item('Coloană în stânga', () => this.structure((x) => insertCol(x, c), { r, c }))
    item('Coloană în dreapta', () => this.structure((x) => insertCol(x, c + 1), { r, c: c + 1 }))
    sep()
    item('Editează ca text', () => {
      this.closeMenu()
      this.close()
      const from = this.from
      this.view.dispatch({ effects: rawAt.of(from), selection: { anchor: from } })
      this.view.focus()
    })
    sep()
    item('Șterge rândul', () => this.structure((x) => deleteRow(x, r), { r: Math.max(0, r - 1), c }), { off: r === 0, danger: true })
    item('Șterge coloana', () => this.structure((x) => deleteCol(x, c), { r, c: Math.max(0, c - 1) }), { off: this.model.align.length <= 1, danger: true })
    item('Șterge tabelul', () => {
      this.closeMenu()
      this.close()
      const from = this.from
      const end = from + this.w.text.length
      const to = this.view.state.doc.sliceString(end, end + 1) === '\n' ? end + 1 : end
      this.view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: 'delete.table' })
      this.view.focus()
    }, { danger: true })
    // În `body`, cu poziție fixă: cutia descrierii (pliată) și foaia
    // (`transform`) ar fi tăiat-o.
    document.body.append(m)
    // Pe telefon: foaie de jos, deasupra tastaturii (`--kb`), ca meniurile de jetoane.
    if (document.documentElement.hasAttribute('data-narrow')) m.classList.add('sheet-like')
    const b = this.more.getBoundingClientRect()
    const h = m.offsetHeight, w = m.offsetWidth
    const below = b.bottom + 4 + h <= window.innerHeight
    if (!m.classList.contains('sheet-like')) {
      m.style.top = `${below ? b.bottom + 4 : Math.max(4, b.top - 4 - h)}px`
      m.style.left = `${Math.max(4, Math.min(b.right - w, window.innerWidth - w - 4))}px`
    }
    this.menu = m
    const off = (ev: Event) => {
      if (m.contains(ev.target as Node) || this.more.contains(ev.target as Node)) return
      this.closeMenu()
    }
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault(); ev.stopPropagation()
      this.closeMenu()
    }
    document.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', esc, true)
    ;(m as HTMLElement & { hzOff?: () => void }).hzOff = () => {
      document.removeEventListener('pointerdown', off, true)
      window.removeEventListener('keydown', esc, true)
    }
  }

  closeMenu() {
    const m = this.menu as (HTMLElement & { hzOff?: () => void }) | null
    if (!m) return
    this.menu = null
    m.hzOff?.()
    m.remove()
    if (this.editing && document.activeElement !== this.editing.ta) this.editing.ta.focus({ preventScroll: true })
  }

  destroy() {
    this.closeMenu()
  }
}

/** Esc în celulă: un pas — înapoi în editor, sub tabel. În captură, ca panoul
 *  (`SplitView`) și dispecerul Vim să nu-l vadă. */
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return
    const ta = e.target instanceof HTMLTextAreaElement && e.target.classList.contains('md-cell-input') ? e.target : null
    const ctl = (ta?.closest('.md-table-wrap') as (HTMLElement & { hzTable?: Controller }) | null)?.hzTable
    if (!ctl || ctl.menu) return
    e.preventDefault()
    e.stopPropagation()
    ctl.exit('below')
  }, true)
}

const ctlOf = (dom: HTMLElement) => (dom as HTMLElement & { hzTable?: Controller }).hzTable

class TableWidget extends WidgetType {
  constructor(readonly text: string, readonly prefixes: readonly string[], readonly canEdit: boolean) { super() }
  /** Celulele sunt câmpuri: CodeMirror nu-și ia înapoi focusul și selecția din ele. */
  get editable() { return true }
  eq(o: TableWidget) { return o.text === this.text && o.canEdit === this.canEdit && o.prefixes.join() === this.prefixes.join() }
  toDOM(view: EditorView) { return new Controller(view, this).wrap }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const ctl = ctlOf(dom)
    if (!ctl) return false
    ctl.view = view
    ctl.update(this)
    return true
  }
  destroy(dom: HTMLElement) { ctlOf(dom)?.destroy() }
  ignoreEvent(e: Event) {
    // Doar clicul pe un link, cu Ctrl/⌘ sau fără drept de scriere, e al editorului.
    const t = e.target instanceof HTMLElement ? e.target : null
    if (e.type !== 'mousedown' || !t?.closest('[data-href],[data-ref]')) return true
    const m = e as MouseEvent
    return !(m.ctrlKey || m.metaKey || !this.canEdit)
  }
}

/** Celula `r`,`c` a tabelului care începe la `from` primește focusul. */
export function focusTableAt(view: EditorView, from: number, r: number, c: number): boolean {
  for (const w of view.contentDOM.querySelectorAll<HTMLElement>('.md-table-wrap')) {
    const ctl = ctlOf(w)
    if (!ctl || view.posAtDOM(w) !== from) continue
    ctl.focusCell(r === -1 ? ctl.model.rows.length - 1 : r, c)
    return true
  }
  return false
}

function tableRanges(state: EditorState) {
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

export const tableField = (prefixes: () => readonly string[]): Extension => {
  const decoOf = (state: EditorState, f: Omit<Field, 'deco'>) => {
    const out: Range<Decoration>[] = []
    const editable = state.facet(EditorView.editable)
    for (const r of f.ranges) {
      const a = state.doc.lineAt(r.from), z = state.doc.lineAt(r.to)
      if (f.raw.includes(a.from)) continue
      out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(a.from, z.to), prefixes(), editable), block: true }).range(a.from, z.to))
    }
    return Decoration.set(out)
  }
  const field = StateField.define<Field>({
    create(state) {
      const f = { ranges: tableRanges(state), raw: [] as number[] }
      return { ...f, deco: decoOf(state, f) }
    },
    update(v, tr) {
      const marked = tr.effects.filter((e) => e.is(rawAt)).map((e) => e.value as number)
      const editableChanged = tr.startState.facet(EditorView.editable) !== tr.state.facet(EditorView.editable)
      if (!tr.docChanged && !tr.selection && !marked.length && !editableChanged) return v
      const ranges = tr.docChanged ? tableRanges(tr.state) : v.ranges
      // „Ca text” ține cât cursorul stă în tabel; plecat de acolo, se desenează la loc.
      const sel = tr.state.selection.main
      const raw = [...v.raw.map((p) => tr.changes.mapPos(p)), ...marked].filter((p) => {
        const t = ranges.find((x) => tr.state.doc.lineAt(x.from).from === p)
        if (!t) return false
        const z = tr.state.doc.lineAt(t.to)
        return sel.from <= z.to && sel.to >= p
      })
      const f = { ranges, raw }
      return { ...f, deco: decoOf(tr.state, f) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return field
}

/**
 * ↓ de pe rândul de deasupra intră în prima celulă a antetului, ↑ de pe
 * rândul de dedesubt în ultimul rând — altfel cursorul ar sări peste tabel.
 */
export const tableEntryKeys = [
  {
    key: 'ArrowDown',
    run: (v: EditorView) => {
      const s = v.state.selection.main
      if (!s.empty) return false
      const line = v.state.doc.lineAt(s.head)
      if (line.number >= v.state.doc.lines) return false
      // Pe un rând rupt în mai multe, ↓ merge întâi pe rândul vizual următor.
      if (v.moveVertically(s, true).head <= line.to && v.moveVertically(s, true).head !== s.head) return false
      const next = v.state.doc.line(line.number + 1)
      if (!tableRanges(v.state).some((t) => t.from === next.from)) return false
      return focusTableAt(v, next.from, 0, 0)
    },
  },
  {
    key: 'ArrowUp',
    run: (v: EditorView) => {
      const s = v.state.selection.main
      if (!s.empty) return false
      const line = v.state.doc.lineAt(s.head)
      if (line.number <= 1) return false
      const up = v.moveVertically(s, false).head
      if (up >= line.from && up !== s.head) return false
      const prev = v.state.doc.line(line.number - 1)
      const t = tableRanges(v.state).find((x) => v.state.doc.lineAt(x.to).number === prev.number)
      if (!t) return false
      return focusTableAt(v, v.state.doc.lineAt(t.from).from, -1, 0)
    },
  },
]
