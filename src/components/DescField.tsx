import { Suspense, forwardRef, lazy, useImperativeHandle, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { EditorHandle, FormatCmd, MarkdownEditorProps } from './MarkdownEditor'

const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

/** Chemat la pornire, ca editorul să fie gata până deschizi primul tichet. */
export const preloadEditor = () => { void import('./MarkdownEditor') }

/**
 * Descrierea: editorul CodeMirror, încărcat leneș (~250 KB, ~82 KB gzip, nu
 * întârzie primul cadru). Cât se încarcă, un textarea simplu ține locul, cu
 * aceleași valori — nimic scris acolo nu se pierde la schimbare. Dacă
 * editorul sosește cu cursorul în textarea, focusul trece în editor, la
 * același loc (tastatura de pe telefon nu coboară).
 */
export const DescField = forwardRef<EditorHandle, MarkdownEditorProps & { className?: string }>(
  function DescField({ className = '', ...p }, ref) {
    const editor = useRef<EditorHandle>(null)
    const fallback = useRef<HTMLTextAreaElement>(null)
    const handoff = useRef<number | null>(null)
    useImperativeHandle(ref, () => ({
      focus: () => (editor.current ? editor.current.focus() : fallback.current?.focus()),
      format: (cmd: FormatCmd) => editor.current?.format(cmd),
    }), [])
    return (
      <div className={`md-field ${className}`}>
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
      </div>
    )
  },
)

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
