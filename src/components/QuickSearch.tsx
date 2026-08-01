import { useState, useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import type { Issue } from '../lib/types'

interface Props {
  onClose: () => void
}

// Lowercase + strip diacritics (ă→a, â→a, î→i, ș→s, ț→t, …) so a query
// like "mada" matches a title like "Mădălin". NFD keeps one base character
// per letter, so positions stay aligned with the original text in highlight().
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function fuzzy(query: string, text: string): boolean {
  if (!query) return true
  const q = fold(query)
  const t = fold(text)
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

// Substring, case-insensitive match against the full id ("H-04") and its
// numeric part ("04"). Deliberately NOT the fuzzy subsequence matcher above:
// a subsequence match on "04" would match almost any id containing a 0
// then a 4 anywhere, which is far too loose for jumping straight to a
// ticket by number. Substring is the tight, predictable behaviour someone
// typing a number expects.
//
// Note: because the match is substring-on-numeric-part rather than exact
// numeric equality, a single digit like "4" matches both "H-04" and "H-14"
// (both numeric parts contain "4"). That is the literal, and simplest,
// reading of "substring match on the numeric part" — no special-casing to
// prefer an exact numeric match was added, since the ticket didn't ask for it.
function matchesId(query: string, id: string): boolean {
  if (!query) return false
  const q = query.toLowerCase()
  const idLower = id.toLowerCase()
  if (idLower.includes(q)) return true
  const numericPart = id.match(/\d+/)?.[0] ?? ''
  return numericPart.includes(q)
}

/**
 * Pure ranking function extracted so the matching logic can be unit-tested
 * without mounting the component. A result matches on title (existing
 * fuzzy subsequence match, unchanged) or on id (substring match, see
 * matchesId). Id matches rank before title-only matches. Ranking happens
 * BEFORE the results are capped to `limit`, so an id match is never pushed
 * out by title matches that happen to sort earlier.
 */
export function rankIssues(query: string, issues: Issue[], limit = 10): Issue[] {
  if (!query) return issues.slice(0, limit)

  const idMatches: Issue[] = []
  const titleMatches: Issue[] = []
  for (const issue of issues) {
    if (matchesId(query, issue.id)) {
      idMatches.push(issue)
    } else if (fuzzy(query, issue.title)) {
      titleMatches.push(issue)
    }
  }
  return [...idMatches, ...titleMatches].slice(0, limit)
}

function highlight(query: string, text: string): React.ReactNode {
  if (!query) return text
  const q = fold(query)
  const result: React.ReactNode[] = []
  let qi = 0
  let segStart = 0
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (fold(text[i]) === q[qi]) {
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

  const filtered = rankIssues(query, issues)

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
