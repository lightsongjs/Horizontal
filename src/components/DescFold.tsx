import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { DescField } from './DescField'
import type { EditorHandle, MarkdownEditorProps } from './MarkdownEditor'
import { DESC_CONTROLS, descCap, foldState, moreLinesLabel, tapRevealsOnly } from '../lib/descFold'
import { Icon } from './Icon'

type Props = MarkdownEditorProps & {
  className?: string
  /**
   * Față de ce se socotește plafonul: `pane` = panoul lateral (`.split-pane`),
   * `viewport` = ecranul vizibil (telefon). `null` = fără pliere: cutia rămâne
   * cum o face CSS-ul (modalul de 94%, unde descrierea e coloana de lectură).
   */
  where: 'pane' | 'viewport' | null
}

type Measure = { content: number; cap: number; line: number }
const ZERO: Measure = { content: 0, cap: 0, line: 0 }

/**
 * Descrierea cu înălțimea textului (macheta `design/panel-thread/index.html`):
 * minimul de rânduri îl dă CSS-ul (`.desc-fit`), plafonul și plierea le dă
 * `lib/descFold.ts`. Peste plafon cutia se oprește, cu estompare și „Arată tot
 * · încă N rânduri"; desfăcută, butonul devine „Restrânge" la coada textului.
 *
 * Textul rămâne întreg în CodeMirror — pliat e doar desenul. Focusul (click în
 * text, Tab) o desface: nu scrii în ce nu vezi. Pe telefon (`viewport`) o
 * atingere pe textul pliat NU ia focusul: doar îl desface, iar abia a doua
 * atingere scrie (`tapRevealsOnly`, D-196) — întâi citești, apoi editezi. Desfăcută rămâne cât trăiește
 * componenta, adică cât stă tichetul deschis (cheia panoului o remontează).
 *
 * Cum cutia nu mai are înălțime fixă, CodeMirror nu mai umple tot câmpul: o
 * atingere sub text (în minimul de rânduri) ar cădea pe scroller și n-ar scrie
 * nimic. `onMouseDown` pe cutie pune atunci cursorul la capăt.
 */
export const DescFold = forwardRef<EditorHandle, Props>(function DescFold({ className = '', where, onFocus, ...p }, ref) {
  const inner = useRef<EditorHandle>(null)
  useImperativeHandle(ref, () => ({
    focus: () => inner.current?.focus(),
    focusEnd: () => inner.current?.focusEnd(),
    format: (cmd) => inner.current?.format(cmd),
  }), [])

  const box = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<Measure>(ZERO)
  const [open, setOpen] = useState(false)
  const { folds, hidden } = where ? foldState(m.content, m.cap, m.line) : { folds: false, hidden: 0 }
  const capped = folds && !open

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !where) { setM(ZERO); return }
    const host = where === 'pane' ? el.closest<HTMLElement>('.split-pane') : null
    let child: Element | null = null
    const measure = () => {
      const c = el.firstElementChild as HTMLElement | null
      const cs = getComputedStyle(el)
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      // Înălțimea NATURALĂ a textului: copilul (editorul sau textarea-ul de
      // rezervă) nu se micșorează sub plafon, doar e tăiat de cutie.
      const content = (c ? c.offsetHeight : el.scrollHeight) + pad
      const lineEl = el.querySelector('.cm-content') ?? c ?? el
      const ls = getComputedStyle(lineEl)
      const line = parseFloat(ls.lineHeight) || parseFloat(ls.fontSize) * 1.2 || 0
      const hostH = host ? host.clientHeight : (window.visualViewport?.height ?? window.innerHeight)
      const next = { content, cap: descCap(hostH, host ? 'pane' : 'viewport'), line }
      setM((prev) => (prev.content === next.content && prev.cap === next.cap && prev.line === next.line ? prev : next))
    }
    const ro = new ResizeObserver(measure)
    const watchChild = () => {
      if (child === el.firstElementChild) return
      if (child) ro.unobserve(child)
      child = el.firstElementChild
      if (child) ro.observe(child)
    }
    // Editorul sosește leneș (Suspense): textarea-ul de rezervă e înlocuit.
    const mo = new MutationObserver(() => { watchChild(); measure() })
    mo.observe(el, { childList: true })
    watchChild()
    ro.observe(el)
    if (host) ro.observe(host)
    const vv = window.visualViewport
    vv?.addEventListener('resize', measure)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      ro.disconnect()
      mo.disconnect()
      vv?.removeEventListener('resize', measure)
      window.removeEventListener('resize', measure)
    }
  }, [where])

  /**
   * Pe telefon, pliată: o atingere pe text doar o arată întreagă (D-196). În
   * faza de captură, ÎNAINTEA editorului: `preventDefault` pe `mousedown`
   * ține focusul (deci tastatura) jos, iar `stopPropagation` oprește
   * CodeMirror să pună cursorul. Bifa și linkurile trec neatinse.
   */
  const onBoxDownCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const onControl = !!(e.target as HTMLElement).closest(DESC_CONTROLS)
    if (!tapRevealsOnly(where, capped, onControl)) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(true)
  }

  const onBoxDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!where || p.readOnly || e.button !== 0) return
    const t = e.target as HTMLElement
    // În text CodeMirror își pune singur cursorul (și desface prin focus);
    // „Arată tot" stă în cutie, dar e buton, nu loc de scris.
    if (t.closest('.cm-content, .md-fallback, .desc-more')) return
    e.preventDefault()
    setOpen(true)
    inner.current?.focusEnd()
  }

  const collapse = () => {
    setOpen(false)
    const el = box.current
    if (el?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    // Butonul urcă odată cu textul strâns; dacă începutul cutiei a ieșit peste
    // marginea de sus, derulăm înapoi la el. Numai containerul, nu pagina.
    requestAnimationFrame(() => {
      const scroller = el?.closest<HTMLElement>('.if-body, .kb-sheet')
      if (!el || !scroller) return
      const gap = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      if (gap < 0) scroller.scrollTop += gap - 8
    })
  }

  const empty = p.value.trim() === ''
  const cls = `desc-box ${className}${where ? ' desc-fit' : ''}${where && empty ? ' desc-empty' : ''}${capped ? ' capped' : ''}`
  // În cutie, nu sub ea (macheta `design/desc-box`): pliat stă jos-stânga peste
  // estompare, desfăcut stă la coada textului.
  const more = folds && (
    <button
      type="button"
      className={`desc-more${open ? ' open' : ''}`}
      aria-expanded={open}
      onClick={() => (open ? collapse() : setOpen(true))}
    >
      <Icon name="showMore" size={15} />
      <span>{open ? 'Restrânge' : 'Arată tot'}</span>
      {!open && <span className="desc-more-n">· {moreLinesLabel(hidden)}</span>}
    </button>
  )
  return (
    <DescField
      {...p}
      ref={inner}
      fieldRef={box}
      className={cls}
      style={capped ? ({ '--desc-cap': `${m.cap}px` } as CSSProperties) : undefined}
      onMouseDown={onBoxDown}
      onMouseDownCapture={onBoxDownCapture}
      onFocus={() => { setOpen(true); onFocus?.() }}
      after={more}
    />
  )
})
