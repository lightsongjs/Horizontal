import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { toBlocks, type Block, type Inline } from '../lib/markdown/blocks'
import { toggleTask } from '../lib/markdown/tasks'
import { Icon } from './Icon'
import { copyText } from '../lib/clipboard'

type Props = {
  text: string
  /** Prefixele proiectelor cunoscute — `HZ-12` devine legătură doar pentru ele. */
  prefixes: readonly string[]
  /** Fără el căsuțele sunt doar desen (fir, fără drept de scriere). */
  onToggle?(next: string): void
  onRef?(id: string): void
  className?: string
}

/** O atingere pe căsuță nu ia focusul — tastatura nu urcă, foaia nu sare. */
const keep = (e: SyntheticEvent) => e.preventDefault()

/**
 * Descrierea, citită. Elemente React, nu `innerHTML`: textul vine și de la
 * unelte (ticket-kit), iar un HTML brut rămâne text, deci n-avem ce sanitiza.
 * Aceeași gramatică ca editorul (`mdParser`), ca citit și scris să arate la fel.
 */
export function MarkdownView({ text, prefixes, onToggle, onRef, className = '' }: Props) {
  const key = prefixes.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => toBlocks(text, prefixes), [text, key])
  const inl = (list: Inline[]): ReactNode[] => list.map((x, i) => {
    switch (x.t) {
      case 'text': return x.text
      case 'br': return <br key={i} />
      case 'strong': return <strong key={i}>{inl(x.children)}</strong>
      case 'em': return <em key={i}>{inl(x.children)}</em>
      case 'del': return <del key={i}>{inl(x.children)}</del>
      case 'code': return <code key={i} className="md-code">{x.text}</code>
      case 'link': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" className="md-link">{inl(x.children)}</a>
      case 'ref': return onRef
        ? <button key={i} type="button" className="md-ref" onClick={() => onRef(x.id)}>{x.id}</button>
        : <span key={i} className="md-ref">{x.id}</span>
    }
  })
  const blk = (list: Block[]): ReactNode[] => list.map((b, i) => {
    switch (b.t) {
      case 'h': {
        const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'
        return <H key={i} className={`md-h${b.level}`}>{inl(b.children)}</H>
      }
      case 'p': return <p key={i}>{inl(b.children)}</p>
      case 'quote': return <blockquote key={i}>{blk(b.children)}</blockquote>
      case 'pre': return (
        <div key={i} className="md-pre-box">
          <pre className="md-pre"><code>{b.text}</code></pre>
          <CodeCopy text={b.text} />
        </div>
      )
      case 'hr': return <div key={i} className="md-hr" role="separator">⁂</div>
      case 'table': return (
        <div key={i} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{b.head.map((c, j) => <th key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inl(c)}</th>)}</tr></thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inl(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      case 'ul':
      case 'ol': {
        const L = b.t
        return (
          <L key={i} start={L === 'ol' && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, j) => it.task ? (
              <li key={j} className={`md-li md-li-task${it.task.checked ? ' done' : ''}`}>
                <button
                  type="button"
                  className={`md-task${it.task.checked ? ' on' : ''}`}
                  role="checkbox"
                  aria-checked={it.task.checked}
                  disabled={!onToggle}
                  onPointerDown={keep}
                  onMouseDown={keep}
                  onClick={() => onToggle?.(toggleTask(text, it.task!.at))}
                >
                  {it.task.checked && <Icon name="check" size={13} />}
                </button>
                <div className="md-li-body">{blk(it.children)}</div>
              </li>
            ) : (
              <li key={j} className="md-li">{blk(it.children)}</li>
            ))}
          </L>
        )
      }
    }
  })
  return <div className={`md ${className}`}>{blk(blocks)}</div>
}

/**
 * Butonul de copiere din colțul unui bloc de cod, ca pe GitHub. Același aspect
 * ca widget-ul din editor (`livePreview.ts`, clasa `.md-copy`): bifă și
 * „Copiat” la o copiere confirmată, ✕ când n-a mers.
 */
export function CodeCopy({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = async () => {
    const ok = await copyText(text)
    setState(ok ? 'ok' : 'fail')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), ok ? 1600 : 4000)
  }
  const label = state === 'ok' ? 'Copiat' : state === 'fail' ? 'Nu am putut copia' : 'Copiază codul'
  return (
    <button
      type="button"
      className={`md-copy${state === 'ok' ? ' copied' : ''}${state === 'fail' ? ' copy-failed' : ''}`}
      aria-label={label}
      title={label}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={(e) => { e.stopPropagation(); void copy() }}
    >
      <Icon name={state === 'ok' ? 'check' : state === 'fail' ? 'close' : 'copy'} size={15} />
      {state === 'ok' && <span>Copiat</span>}
    </button>
  )
}
