import { Suspense, forwardRef, lazy, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type MutableRefObject, type ReactNode, type Ref } from 'react'
import type { EditorHandle, FormatCmd, MarkdownEditorProps } from './MarkdownEditor'

/**
 * Un chunk care nu sosește (offline după un deploy nou, rețea căzută) n-are voie
 * să golească aplicația: câmpul rămâne un textarea simplu (`PlainEditor`), cu
 * același contract — se scrie și se salvează, doar fără live preview.
 */
const MarkdownEditor = lazy(() => import('./MarkdownEditor').catch(() => ({ default: PlainEditor })))

/** Chemat la pornire, ca editorul să fie gata până deschizi primul tichet. */
export const preloadEditor = () => { import('./MarkdownEditor').catch(() => {}) }

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
          <MarkdownEditor ref={editor} {...p} takeFocus={() => { const at = handoff.current; handoff.current = null; return at }} />
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
  return <textarea ref={el} {...rest} />
}

/** Descrierea fără CodeMirror: rezerva pentru un chunk care n-a putut fi adus. */
const PlainEditor = forwardRef<EditorHandle, MarkdownEditorProps>(function PlainEditor(p, ref) {
  const el = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => el.current?.focus(), focusEnd: () => textareaEnd(el.current), format: () => {} }), [])
  return (
    <textarea
      ref={el}
      className="md-fallback"
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
