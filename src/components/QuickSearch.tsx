import { useState, useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'

interface Props {
  onClose: () => void
}

function fuzzy(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

function highlight(query: string, text: string): React.ReactNode {
  if (!query) return text
  const q = query.toLowerCase()
  const result: React.ReactNode[] = []
  let qi = 0
  let segStart = 0
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i].toLowerCase() === q[qi]) {
      if (i > segStart) result.push(text.slice(segStart, i))
      result.push(<mark key={i}>{text[i]}</mark>)
      segStart = i + 1
      qi++
    }
  }
  if (segStart < text.length) result.push(text.slice(segStart))
  return result
}

export function QuickSearch({ onClose }: Props) {
  const { issues } = useHorizontal()
  const { openEditIssue } = useUI()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)

  const filtered = issues.filter((i) => fuzzy(query, i.title)).slice(0, 10)

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = itemsRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const open = (id: string) => {
    openEditIssue(id)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      if (filtered[selected]) open(filtered[selected].id)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="qs-overlay" onClick={onClose}>
      <div className="qs-card" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="qs-input-wrap">
          <svg className="qs-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută tichet…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="qs-esc-badge">esc</kbd>
        </div>

        {filtered.length > 0 && (
          <div className="qs-results" ref={itemsRef}>
            {filtered.map((issue, i) => (
              <button
                key={issue.id}
                className={`qs-item ${i === selected ? 'on' : ''}`}
                onClick={() => open(issue.id)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="qs-item-id">{issue.id}</span>
                <span className="qs-item-title">{highlight(query, issue.title)}</span>
                {issue.done && <span className="qs-item-done">✓</span>}
              </button>
            ))}
          </div>
        )}

        {query && filtered.length === 0 && (
          <div className="qs-empty">Niciun rezultat pentru „{query}"</div>
        )}

        <div className="qs-footer">
          <span><kbd>↑↓</kbd> navighează</span>
          <span><kbd>↵</kbd> deschide</span>
          <span><kbd>esc</kbd> închide</span>
        </div>
      </div>
    </div>
  )
}
