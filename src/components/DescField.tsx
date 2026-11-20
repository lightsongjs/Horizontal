import { Suspense, forwardRef, lazy, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type MutableRefObject, type ReactNode, type Ref } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorHandle, FormatCmd, MarkdownEditorProps } from './MarkdownEditor'

/**
 * Un chunk care nu sosește (offline după un deploy nou, rețea căzută) n-are voie
 * să golească aplicația: câmpul rămâne un textarea simplu (`PlainEditor`), cu
 * același contract — se scrie și se salvează, doar fără live preview.
 */
const MarkdownEditor = lazy(() => editorModule().catch(() => ({ default: PlainEditor })))

/**
 * Editorul, odată sosit. `lazy` suspendă la PRIMA randare chiar cu modulul
 * deja adus (promisiunea lui se rezolvă abia la tick-ul următor), deci primul
 * tichet deschis arăta textarea-ul de rezervă un cadru și abia apoi editorul.
 * Cu modulul în mână, `DescField` îl folosește direct.
 */
let loadedEditor: typeof import('./MarkdownEditor').default | null = null
const editorModule = () => import('./MarkdownEditor').then((m) => { loadedEditor = m.default; return m })

/**
 * Chemat la pornire, ca editorul să fie gata până deschizi primul tichet.
 *
 * Adusul chunk-ului nu ajunge: primul `EditorView` din sesiune costa încă
 * ~100ms pe telefon (4× CPU) — compilarea codului CodeMirror și a
 * live-preview-ului la prima folosire —, deci primul tichet deschis își arăta
 * descrierea cu un cadru gol în plus față de al doilea
 * (`docs/agent/viteza-deschidere.md`). De-aia, în idle, un editor ascuns se
 * montează o dată peste un text care atinge toate decorările, și pleacă.
 */
export const preloadEditor = () => {
  editorModule().then((m) => whenIdle(() => warmEditor(m.default))).catch(() => {})
}

const WARM_DOC = '## Titlu\n\nText **gros**, *cursiv*, `cod`, [link](https://example.com) și H-1.\n\n- [ ] de făcut\n- [x] făcut\n  - sub\n1. unu\n\n> citat\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'

function whenIdle(fn: () => void) {
  // Safari n-are `requestIdleCallback`.
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 3000 })
  else setTimeout(fn, 300)
}

function warmEditor(Editor: typeof import('./MarkdownEditor').default) {
  // Fără `md-editor` în pagină după încălzire: testele de browser îl caută.
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.inert = true
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:360px;visibility:hidden;pointer-events:none'
  document.body.appendChild(box)
  const root = createRoot(box)
  const noop = () => {}
  root.render(<Editor value={WARM_DOC} onChange={noop} onCommit={noop} readOnly ariaLabel="" prefixes={['H']} />)
  // Două cadre: CodeMirror își măsoară rândurile în `requestAnimationFrame`.
  requestAnimationFrame(() => requestAnimationFrame(() => { root.unmount(); box.remove() }))
}

/**
 * Descrierea: editorul CodeMirror, încărcat leneș (~250 KB, ~82 KB gzip, nu
 * întârzie primul cadru). Cât se încarcă, un textarea simplu ține locul, cu
 * aceleași valori — nimic scris acolo nu se pierde la schimbare. Dacă
 * editorul sosește cu cursorul în textarea, focusul trece în editor, la
 * același loc (tastatura de pe telefon nu coboară).
 */
/**
 * Cutia însăși (`fieldRef`, `style`, `onMouseDown`): `DescFold` o măsoară și o
 * pliază. `after` stă în cutie, DUPĂ editor („Arată tot"), ca editorul să
 * rămână primul copil — pe el îl măsoară `DescFold`.
 */
type BoxProps = {
  className?: string
  style?: CSSProperties
  fieldRef?: Ref<HTMLDivElement>
  onMouseDown?(e: MouseEvent<HTMLDivElement>): void
  /** Înaintea editorului (faza de captură): pliată, o atingere doar arată tot. */
  onMouseDownCapture?(e: MouseEvent<HTMLDivElement>): void
  after?: ReactNode
}

export const DescField = forwardRef<EditorHandle, MarkdownEditorProps & BoxProps>(
  function DescField({ className = '', style, fieldRef, onMouseDown, onMouseDownCapture, after, ...p }, ref) {
    const editor = useRef<EditorHandle>(null)
    const fallback = useRef<HTMLTextAreaElement>(null)
    const handoff = useRef<number | null>(null)
    // Ales o dată pe câmp: o schimbare de tip (leneș → direct) l-ar remonta,
    // cu tot cu focusul și cursorul.
    const [Editor] = useState(() => loadedEditor ?? MarkdownEditor)
    useImperativeHandle(ref, () => ({
      focus: () => (editor.current ? editor.current.focus() : fallback.current?.focus()),
      focusEnd: () => (editor.current ? editor.current.focusEnd() : textareaEnd(fallback.current)),
      format: (cmd: FormatCmd) => editor.current?.format(cmd),
    }), [])
    return (
      <div ref={fieldRef} className={`md-field ${className}`} style={style} onMouseDown={onMouseDown} onMouseDownCapture={onMouseDownCapture}>
        <Suspense
          fallback={
            <Fallback
              el={fallback}
              handoff={handoff}
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
          <Editor ref={editor} {...p} takeFocus={() => { const at = handoff.current; handoff.current = null; return at }} />
        </Suspense>
        {after}
      </div>
    )
  },
)

/** Focus cu cursorul la capăt, pentru textarea-ul de rezervă. */
function textareaEnd(t: HTMLTextAreaElement | null) {
  if (!t) return
  t.focus()
  t.setSelectionRange(t.value.length, t.value.length)
}

/**
 * Textarea-ul de rezervă. Curățenia efectului de layout rulează ÎNAINTE ca
 * React să-l scoată din DOM, deci încă vede dacă avea focusul și unde era
 * cursorul — editorul care îl înlocuiește le preia (`takeFocus`).
 */
function Fallback({ el, handoff, ...rest }: { el: MutableRefObject<HTMLTextAreaElement | null>; handoff: MutableRefObject<number | null> } & JSX.IntrinsicElements['textarea']) {
  useLayoutEffect(() => () => {
    const t = el.current
    handoff.current = t && document.activeElement === t ? t.selectionStart : null
  }, [el, handoff])
  return <textarea ref={el} spellCheck={false} {...rest} />
}

/** Descrierea fără CodeMirror: rezerva pentru un chunk care n-a putut fi adus. */
const PlainEditor = forwardRef<EditorHandle, MarkdownEditorProps>(function PlainEditor(p, ref) {
  const el = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => el.current?.focus(), focusEnd: () => textareaEnd(el.current), format: () => {} }), [])
  return (
    <textarea
      ref={el}
      className="md-fallback"
      spellCheck={false}
      value={p.value}
      readOnly={p.readOnly}
      placeholder={p.placeholder}
      aria-label={p.ariaLabel}
      onChange={(e) => p.onChange(e.target.value)}
      onFocus={p.onFocus}
      onBlur={p.onBlur}
    />
  )
})
