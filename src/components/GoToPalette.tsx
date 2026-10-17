import { useEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { inboxFirst } from '../lib/projectOrder'
import { waveLabel } from '../lib/waveBar'

/** O destinație a paletei: ce se scrie și unde duce. */
export type GoTarget =
  | { kind: 'top'; screen: 'today' | 'week' | 'inbox' }
  | { kind: 'filter'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'wave'; number: number }

interface Item { label: string; sub: string; target: GoTarget }

// Fără diacritice și fără majuscule, ca în căutarea de tichete („hor" → „Horizontal").
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * „Mergi la…" (z, gp, :) — proiectele, filtrele, listele și valurile
 * proiectului deschis, într-o singură listă care se filtrează pe măsură ce
 * scrii. Cochilia e a căutării de tichete (`.qs-*`), ca cele două să arate și
 * să se conducă la fel: săgeți sau Ctrl+J / Ctrl+K, Enter, Esc.
 *
 * Valurile apar doar cât ești pe ecranul unui proiect: valul activ e al
 * proiectului încărcat, iar dintr-o listă proiectul din store poate fi doar
 * al unui tichet docat.
 */
export function GoToPalette({ onClose, onGo, showWaves }: { onClose(): void; onGo(t: GoTarget): void; showWaves: boolean }) {
  const { projects, savedFilters, waves, project } = useHorizontal()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const all = useMemo<Item[]>(() => [
    { label: 'Azi', sub: 'listă', target: { kind: 'top', screen: 'today' } },
    { label: '7 zile', sub: 'listă', target: { kind: 'top', screen: 'week' } },
    { label: 'Ale mele', sub: 'listă', target: { kind: 'top', screen: 'inbox' } },
    ...savedFilters.map((f): Item => ({ label: f.name, sub: 'filtru', target: { kind: 'filter', id: f.id } })),
    ...inboxFirst(projects).map((p): Item => ({ label: p.name, sub: `proiect · ${p.prefix}`, target: { kind: 'project', id: p.id } })),
    ...(showWaves && project
      ? [...waves].sort((a, b) => a.position - b.position).map((w): Item => ({
        label: `${project.name} › ${w.number === 0 ? 'Notițe' : waveLabel(w)}`,
        sub: 'val',
        target: { kind: 'wave', number: w.number },
      }))
      : []),
  ], [projects, savedFilters, waves, project, showWaves])

  const items = useMemo(() => {
    const q = fold(query.trim())
    return q ? all.filter((x) => fold(`${x.label} ${x.sub}`).includes(q)) : all
  }, [all, query])

  useEffect(() => { setSel(0) }, [query])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    (listRef.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const go = (it: Item | undefined) => {
    if (!it) return
    onClose()
    onGo(it.target)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const down = e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'j' || e.key === 'n'))
    const up = e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'k' || e.key === 'p'))
    if (down || up) {
      e.preventDefault()
      setSel((s) => Math.max(0, Math.min(items.length - 1, s + (down ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(items[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="qs-overlay" onClick={onClose}>
      <div className="qs-card goto-card" role="dialog" aria-label="Mergi la" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="qs-input-wrap">
          <span className="goto-colon" aria-hidden="true">:</span>
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mergi la… (proiect, filtru, listă, val)"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="qs-esc-badge">esc</kbd>
        </div>
        {items.length > 0 ? (
          <div className="qs-results" ref={listRef}>
            {items.map((it, i) => (
              <button
                key={`${it.target.kind}:${'id' in it.target ? it.target.id : 'screen' in it.target ? it.target.screen : it.target.number}`}
                className={`qs-item ${i === sel ? 'on' : ''}`}
                onClick={() => go(it)}
                onMouseEnter={() => setSel(i)}
              >
                <span className="qs-item-title">{it.label}</span>
                <span className="qs-item-proj">{it.sub}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="qs-empty">Nimic pentru „{query}"</div>
        )}
        <div className="qs-footer">
          <span><kbd>↑↓</kbd> sau <kbd>Ctrl J K</kbd></span>
          <span><kbd>↵</kbd> mergi</span>
          <span><kbd>esc</kbd> închide</span>
        </div>
      </div>
    </div>
  )
}

