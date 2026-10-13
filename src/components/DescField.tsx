import { Suspense, forwardRef, lazy, useImperativeHandle, useRef } from 'react'
import type { EditorHandle, FormatCmd, MarkdownEditorProps } from './MarkdownEditor'

const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

/** Chemat la pornire, ca editorul să fie gata până deschizi primul tichet. */
export const preloadEditor = () => { void import('./MarkdownEditor') }

/**
 * Descrierea: editorul CodeMirror, încărcat leneș (~100 KB nu întârzie primul
 * cadru). Cât se încarcă, un textarea simplu ține locul, cu aceleași valori —
 * nimic scris acolo nu se pierde la schimbare.
 */
export const DescField = forwardRef<EditorHandle, MarkdownEditorProps & { className?: string }>(
  function DescField({ className = '', ...p }, ref) {
    const editor = useRef<EditorHandle>(null)
    const fallback = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => ({
      focus: () => (editor.current ? editor.current.focus() : fallback.current?.focus()),
      format: (cmd: FormatCmd) => editor.current?.format(cmd),
    }), [])
    return (
      <div className={`md-field ${className}`}>
        <Suspense
          fallback={
            <textarea
              ref={fallback}
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
          <MarkdownEditor ref={editor} {...p} />
        </Suspense>
      </div>
    )
  },
)
