import { useState, useEffect, useRef, useMemo } from 'react'
import { useHorizontal } from '../store'
import { repository } from '../data'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { displayIssueId } from '../lib/issueId'

interface Props {
  onClose: () => void
  /** Deschide un tichet din orice proiect (`openTaskAnywhere`). */
  onOpen: (id: string) => void
}

/** Ce se caută: deschisele din toate proiectele, iar cu „și închise" și cele
 *  bifate. O singură sursă pe tichet, ca la `openIssues`: varianta din
 *  proiectul deschis e cea mai proaspătă. */
export function searchPool(open: Issue[], loaded: Issue[], closed: Issue[] | null): Issue[] {
  const m = new Map<string, Issue>()
  for (const i of open) m.set(i.id, i)
  if (closed) for (const i of closed) m.set(i.id, i)
  for (const i of loaded) m.set(i.id, i)
  const all = [...m.values()]
  return closed ? all : all.filter((i) => !i.done)
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
//
// Guard: `issues` here is already scoped to one project (see store.tsx),
// so every id shares the same prefix (e.g. all "H-…" or all "KATA-…"). A
// purely alphabetic query that happens to be a substring of that prefix
// (the letter "h", or "kata") would otherwise id-match EVERY ticket in the
// project, flooding the id tier and burying genuine title matches on the
// very first keystroke of a normal search. Id matching only makes sense
// for queries that could plausibly be identifying a ticket by number, so
// it's gated on the query containing at least one digit — every case the
// feature exists for ("04", "4", "H-04", "h-04", "kata-12") satisfies this.
function matchesId(query: string, id: string): boolean {
  if (!query || !/\d/.test(query)) return false
  const q = query.toLowerCase()
  const idLower = id.toLowerCase()
  if (idLower.includes(q)) return true
  const numericPart = id.match(/\d+/)?.[0] ?? ''
  return numericPart.includes(q)
}

/**
 * Cele mai noi întâi (`createdAt` descrescător; la egalitate numărul din ID,
 * descrescător). Căutarea e mai ales „ce tocmai am adăugat": omul scrie ceva,
 * își amintește că mai trebuia altceva și vrea să găsească repede ce abia a
 * scris (cerința omului, 2026-10-15). Înainte ordinea era a ecranului de unde
 * se deschidea căutarea — o listă care nu spune nimic despre „recent".
 */
export function newestFirst(a: Issue, b: Issue): number {
  const ta = Date.parse(a.createdAt) || 0
  const tb = Date.parse(b.createdAt) || 0
  if (ta !== tb) return tb - ta
  return idNumber(b.id) - idNumber(a.id)
}
const idNumber = (id: string) => Number(id.match(/\d+/)?.[0] ?? 0)

/** Cât de bine se potrivește titlul: 0 = la început de cuvânt („alex" în
 *  „scrie lui Alex"), 1 = în interiorul unui cuvânt, 2 = doar subsecvență
 *  („alex" în „Adaugă … la … pe Linux"), -1 = deloc. */
export function titleTier(query: string, title: string): number {
  const q = fold(query.trim())
  if (!q) return 0
  const t = fold(title)
  const at = t.indexOf(q)
  if (at >= 0) {
    for (let i = at; i >= 0; i = t.indexOf(q, i + 1)) {
      if (i === 0 || !/[\p{L}\p{N}]/u.test(t[i - 1])) return 0
    }
    return 1
  }
  return fuzzy(q, t) ? 2 : -1
}

/**
 * Pură, ca s-o putem testa fără să montăm componenta. Nivelurile, în ordine:
 * ID (subșir, `matchesId`), apoi titlul pe nivelurile lui `titleTier`. În
 * fiecare nivel, cele mai noi întâi (`newestFirst`). Calitatea potrivirii bate
 * vechimea: „alex" scris întreg într-un titlu vechi stă deasupra unei
 * subsecvențe împrăștiate într-unul de azi. Ordonarea e ÎNAINTE de tăierea la
 * `limit`, ca o potrivire bună să nu fie împinsă afară de una slabă.
 */
export function rankIssues(query: string, issues: Issue[], limit = 10): Issue[] {
  const sorted = [...issues].sort(newestFirst)
  if (!query) return sorted.slice(0, limit)
  const tiers: Issue[][] = [[], [], [], []]
  for (const issue of sorted) {
    if (matchesId(query, issue.id)) { tiers[0].push(issue); continue }
    const t = titleTier(query, issue.title)
    if (t >= 0) tiers[t + 1].push(issue)
  }
  return tiers.flat().slice(0, limit)
}

function highlight(query: string, text: string): React.ReactNode {
  if (!query) return text
  const q = fold(query)
  // Subșir întreg: se marchează bucata aceea, nu literele împrăștiate pe care
  // le-ar găsi subsecvența. `fold` păstrează pozițiile (vezi mai sus).
  const at = fold(text).indexOf(q.trim())
  if (q.trim() && at >= 0) {
    const end = at + q.trim().length
    return [text.slice(0, at), <mark key="m">{text.slice(at, end)}</mark>, text.slice(end)]
  }
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

export function QuickSearch({ onClose, onOpen }: Props) {
  const { openIssues, issues: projectIssues, projects } = useHorizontal()
  const [query, setQuery] = useState('')
  // Bifa „și închise" e o căutare rară: închisele se cer abia la bifare, din
  // toate proiectele (nu sunt în store), și se țin cât e deschisă căutarea.
  const [withClosed, setWithClosed] = useState(false)
  const [closed, setClosed] = useState<Issue[] | null>(null)
  const [closedState, setClosedState] = useState<'idle' | 'loading' | 'error'>('idle')
  useEffect(() => {
    if (!withClosed || closed) return
    let alive = true
    setClosedState('loading')
    repository.listClosedIssues()
      .then((list) => { if (alive) { setClosed(list); setClosedState('idle') } })
      .catch(() => { if (alive) setClosedState('error') })
    return () => { alive = false }
  }, [withClosed, closed])
  const issues = useMemo(
    () => searchPool(openIssues, projectIssues, withClosed ? closed ?? [] : null),
    [openIssues, projectIssues, withClosed, closed],
  )
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)

  const filtered = rankIssues(query, issues, 30)

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = itemsRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const open = (id: string) => {
    onClose()
    onOpen(id)
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
          <Icon name="search" size={16} className="qs-icon" />
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={withClosed ? 'Caută în toate tichetele…' : 'Caută în tichetele deschise…'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="qs-esc-badge">esc</kbd>
        </div>
        <label className="qs-scope">
          <input type="checkbox" checked={withClosed} onChange={(e) => { setWithClosed(e.target.checked); inputRef.current?.focus() }} />
          și închise
          {withClosed && closedState === 'loading' && <span className="qs-scope-note">se încarcă…</span>}
          {withClosed && closedState === 'error' && <span className="qs-scope-note warn">nu s-au putut aduce — doar deschise</span>}
        </label>

        {filtered.length > 0 && (
          <div className="qs-results" ref={itemsRef}>
            {filtered.map((issue, i) => (
              <button
                key={issue.id}
                className={`qs-item ${i === selected ? 'on' : ''}`}
                onClick={() => open(issue.id)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="qs-item-id">{displayIssueId(issue.id)}</span>
                <span className="qs-item-title">{highlight(query, issue.title)}</span>
                <span className="qs-item-proj">{projectName(issue.projectId)}</span>
                {issue.done && <span className="qs-item-done"><Icon name="check" size={14} label="Gata" /></span>}
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
