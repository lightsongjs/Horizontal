# List View ⇄ Cards Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the List view full behavioral parity with the Cards view (Tree highlight, Select + bulk bar, hide-done with icon, the `T` key, `Esc` ordering, and vim H/J/K/L navigation) by extracting the shared behavior into hooks and components so the two views can no longer drift.

**Architecture:** Move all interaction state/handlers out of `OrdineView` into two hooks in `src/hooks.ts` (`useWaveActions`, `useVimNav`) and two presentational components (`WaveActionsBar`, `BulkBar`). Refactor `OrdineView` onto them with zero behavior change, then wire `ListView` onto the same pieces and upgrade its rows to mirror `TicketCard`'s tree/select/focus interaction.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (pure-logic tests only — no component-test infra in this repo). Verification is via `npm run typecheck`, `npm run build`, and manual behavior checks, matching the repo's existing convention of unit-testing only `src/lib` / `src/data`.

**Verification note:** This repo has no React Testing Library / jsdom setup. Do NOT add one — follow the repo pattern. Each task verifies with `npm run typecheck` (must pass with no errors) plus the manual checks listed. Run manual checks with `npm run dev`.

---

## File Structure

- `src/hooks.ts` — **modify.** Add `useWaveActions()` and `useVimNav()` alongside the existing `useHideDone`/`useOrderedLayers`. Behavior-only hooks (no JSX), so they belong here.
- `src/components/WaveActionsBar.tsx` — **create.** The three-button toolbar (Tree / hide-done / Select). Presentational, fully controlled by props.
- `src/components/BulkBar.tsx` — **create.** The bulk action bar + confirm-delete overlay. Presentational, controlled by props.
- `src/components/OrdineView.tsx` — **modify.** Replace inline state/handlers/keyboard/toolbar/bulk JSX with the hooks + components. Card render loop unchanged.
- `src/components/ListView.tsx` — **modify.** Consume the same hooks + components; upgrade the list row to support `treeMode`/`highlighted`/`selectMode`/`isSelected`/`onToggleSelect`/`focused` and `data-issue-id`.
- `src/styles.css` — **modify.** Add `.list-row` variants for `tree-highlight` / `tree-dim` / `vim-focused` / `selected` / `in-select`, mirroring the existing `.tk` rules.

---

## Task 1: Extract `useWaveActions()` hook

**Files:**
- Modify: `src/hooks.ts`

This moves — verbatim in logic — the select/tree/confirm state, handlers, the T/Esc keyboard effect, and the wave-reset effect out of `OrdineView`.

- [ ] **Step 1: Add imports to `src/hooks.ts`**

The current import block is:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHorizontal } from './store'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'
```

Replace it with:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHorizontal } from './store'
import { useUI } from './ui'
import { getRelatedIds } from './lib/treeTraversal'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'
```

- [ ] **Step 2: Append the `useWaveActions` hook to the end of `src/hooks.ts`**

```ts
export interface WaveActions {
  selectMode: boolean
  selectedIds: Set<string>
  treeViewActive: boolean
  treeHighlightId: string | null
  confirmDel: boolean
  /** treeHighlightId + its related ids, or null when nothing is highlighted */
  highlightedIds: Set<string> | null
  enterSelectMode: () => void
  exitSelectMode: () => void
  toggleTree: () => void
  exitTreeView: () => void
  handleTreeSelect: (id: string) => void
  /** toggle one item's membership in the selection set */
  toggleItem: (id: string) => void
  openConfirm: () => void
  cancelConfirm: () => void
  handleBulkMove: (targetWave: number) => Promise<void>
  handleBulkDelete: () => Promise<void>
}

/**
 * All interaction state shared by the Cards and List views: multi-select +
 * bulk actions, tree-highlight mode, and the T/Esc keyboard shortcuts. Extracted
 * so both views stay in lockstep instead of drifting.
 */
export function useWaveActions(): WaveActions {
  const { waves, activeWave, deleteIssue, updateIssue, byId } = useHorizontal()
  const { sheet } = useUI()

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [treeViewActive, setTreeViewActive] = useState(false)
  const [treeHighlightId, setTreeHighlightId] = useState<string | null>(null)

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmDel(false)
  }, [])

  const enterSelectMode = useCallback(() => setSelectMode(true), [])

  const exitTreeView = useCallback(() => {
    setTreeViewActive(false)
    setTreeHighlightId(null)
  }, [])

  const toggleTree = useCallback(() => {
    setTreeViewActive((active) => {
      if (active) {
        setTreeHighlightId(null)
        return false
      }
      // entering tree — leave select mode
      setSelectMode(false)
      setSelectedIds(new Set())
      setConfirmDel(false)
      return true
    })
  }, [])

  const handleTreeSelect = useCallback((id: string) => {
    setTreeHighlightId((prev) => (prev === id ? null : id))
  }, [])

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const openConfirm = useCallback(() => setConfirmDel(true), [])
  const cancelConfirm = useCallback(() => setConfirmDel(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDel) { setConfirmDel(false); return }
        if (treeViewActive) { exitTreeView(); return }
        if (selectMode) exitSelectMode()
        return
      }

      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sheet.kind !== 'none') return // don't toggle behind an open sheet

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        toggleTree()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, confirmDel, treeViewActive, exitSelectMode, exitTreeView, toggleTree, sheet.kind])

  // reset tree state when the active wave changes
  useEffect(() => { exitTreeView() }, [activeWave, exitTreeView])

  const handleBulkMove = useCallback(async (targetWave: number) => {
    await Promise.all([...selectedIds].map((id) => updateIssue(id, { wave: targetWave })))
    exitSelectMode()
  }, [selectedIds, updateIssue, exitSelectMode])

  const handleBulkDelete = useCallback(async () => {
    await Promise.all([...selectedIds].map((id) => deleteIssue(id)))
    exitSelectMode()
  }, [selectedIds, deleteIssue, exitSelectMode])

  const highlightedIds: Set<string> | null = useMemo(
    () => (treeHighlightId ? new Set([treeHighlightId, ...getRelatedIds(treeHighlightId, byId)]) : null),
    [treeHighlightId, byId],
  )

  // `waves` is intentionally read here so a caller can also read it, but the
  // hook itself does not need it beyond the effect above.
  void waves

  return {
    selectMode, selectedIds, treeViewActive, treeHighlightId, confirmDel, highlightedIds,
    enterSelectMode, exitSelectMode, toggleTree, exitTreeView, handleTreeSelect,
    toggleItem, openConfirm, cancelConfirm, handleBulkMove, handleBulkDelete,
  }
}
```

> Note: `void waves` is a lint guard only if `waves` is otherwise unused — but the reset effect below already keeps `activeWave` in use and `waves` is not needed inside the hook. **Simplify by removing `waves` from the destructure and dropping the `void waves` line.** Final destructure: `const { activeWave, deleteIssue, updateIssue, byId } = useHorizontal()`.

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors). The hook is not yet consumed, so this only checks the hook itself.

- [ ] **Step 4: Commit**

```bash
git add src/hooks.ts
git commit -m "feat: extract useWaveActions hook for shared select/tree state"
```

---

## Task 2: Extract `useVimNav()` hook

**Files:**
- Modify: `src/hooks.ts`

Moves the vim H/J/K/L + Enter + Esc navigation and scroll-into-view out of `OrdineView`.

- [ ] **Step 1: Append `useVimNav` to `src/hooks.ts`**

```ts
export interface VimNav {
  focusedId: string | null
  setFocusedId: (id: string | null) => void
}

/**
 * Vim-style keyboard navigation over the layer grid. `flatLayers` is the array
 * of id-arrays (one per layer) currently rendered. Shared by Cards and List.
 */
export function useVimNav(flatLayers: string[][]): VimNav {
  const { activeWave } = useHorizontal()
  const { openEditIssue, sheet } = useUI()
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // reset focus when the wave changes
  useEffect(() => { setFocusedId(null) }, [activeWave])

  // scroll the focused item into view
  useEffect(() => {
    if (!focusedId) return
    document
      .querySelector(`[data-issue-id="${focusedId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sheet.kind !== 'none') return

      const key = e.key.toLowerCase()
      if (!['h', 'j', 'k', 'l', 'enter', 'escape'].includes(key)) return

      if (key === 'escape') {
        if (focusedId) { e.preventDefault(); setFocusedId(null) }
        return
      }

      if (key === 'enter' && focusedId) {
        e.preventDefault()
        openEditIssue(focusedId)
        return
      }

      if (!['h', 'j', 'k', 'l'].includes(key)) return
      e.preventDefault()

      // first press — enter nav mode on the first visible item
      if (!focusedId) {
        const firstId = flatLayers[0]?.[0]
        if (firstId) setFocusedId(firstId)
        return
      }

      let layerIdx = -1, posInLayer = -1
      for (let li = 0; li < flatLayers.length; li++) {
        const pi = flatLayers[li].indexOf(focusedId)
        if (pi !== -1) { layerIdx = li; posInLayer = pi; break }
      }
      if (layerIdx === -1) return

      if (key === 'j') {
        if (layerIdx + 1 < flatLayers.length) {
          const next = flatLayers[layerIdx + 1]
          setFocusedId(next[Math.min(posInLayer, next.length - 1)])
        }
      } else if (key === 'k') {
        if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[Math.min(posInLayer, prev.length - 1)])
        }
      } else if (key === 'l') {
        const layer = flatLayers[layerIdx]
        if (posInLayer + 1 < layer.length) {
          setFocusedId(layer[posInLayer + 1])
        } else if (layerIdx + 1 < flatLayers.length) {
          setFocusedId(flatLayers[layerIdx + 1][0])
        }
      } else if (key === 'h') {
        if (posInLayer > 0) {
          setFocusedId(flatLayers[layerIdx][posInLayer - 1])
        } else if (layerIdx > 0) {
          const prev = flatLayers[layerIdx - 1]
          setFocusedId(prev[prev.length - 1])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, flatLayers, sheet, openEditIssue])

  return { focusedId, setFocusedId }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks.ts
git commit -m "feat: extract useVimNav hook for shared keyboard navigation"
```

---

## Task 3: Create `WaveActionsBar` component

**Files:**
- Create: `src/components/WaveActionsBar.tsx`

Presentational — no state. Markup is lifted verbatim from `OrdineView`'s current `.wave-actions` block (including the eye SVG icons).

- [ ] **Step 1: Create `src/components/WaveActionsBar.tsx`**

```tsx
interface Props {
  treeViewActive: boolean
  onToggleTree: () => void
  hideDone: boolean
  onToggleHideDone: () => void
  selectMode: boolean
  onEnterSelect: () => void
  onExitSelect: () => void
}

export function WaveActionsBar({
  treeViewActive, onToggleTree,
  hideDone, onToggleHideDone,
  selectMode, onEnterSelect, onExitSelect,
}: Props) {
  return (
    <div className="wave-actions">
      <button
        className={`wave-action-btn ${treeViewActive ? 'active' : ''}`}
        onClick={onToggleTree}
        title={treeViewActive ? 'Ieși din Tree View' : 'Tree View — explorează dependențe'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
          <line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="13" x2="5" y2="17"/><line x1="12" y1="13" x2="19" y2="17"/>
        </svg>
        <span>Tree</span>
      </button>
      <button
        className={`wave-action-btn ${hideDone ? 'active' : ''}`}
        onClick={onToggleHideDone}
        title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
      >
        {hideDone ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        )}
        <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
      </button>
      <button
        className={`wave-action-btn ${selectMode ? 'active' : ''}`}
        onClick={selectMode ? onExitSelect : onEnterSelect}
        title={selectMode ? 'Ieși din Select Mode' : 'Select Mode'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          {selectMode && <polyline points="9 12 11 14 15 10"/>}
        </svg>
        <span>Select</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/WaveActionsBar.tsx
git commit -m "feat: add shared WaveActionsBar toolbar component"
```

---

## Task 4: Create `BulkBar` component

**Files:**
- Create: `src/components/BulkBar.tsx`

Presentational. Markup lifted verbatim from `OrdineView`'s bulk-bar + confirm-overlay blocks.

- [ ] **Step 1: Create `src/components/BulkBar.tsx`**

```tsx
import type { Wave } from '../lib/types'

interface Props {
  selCount: number
  otherWaves: Wave[]
  confirmDel: boolean
  onBulkMove: (targetWave: number) => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export function BulkBar({
  selCount, otherWaves, confirmDel,
  onBulkMove, onRequestDelete, onConfirmDelete, onCancelDelete,
}: Props) {
  return (
    <>
      {selCount > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count"><strong>{selCount}</strong> selectate</span>
          <div className="bulk-actions">
            {otherWaves.length > 0 && (
              <>
                <span className="bulk-label">Mută pe</span>
                <select
                  className="bulk-wave-select"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) onBulkMove(Number(e.target.value)) }}
                >
                  <option value="">— val —</option>
                  {otherWaves.map((w) => (
                    <option key={w.number} value={w.number}>{w.name}</option>
                  ))}
                </select>
              </>
            )}
            <div className="bulk-sep" />
            <button className="bulk-btn danger" onClick={onRequestDelete}>
              🗑 Șterge
            </button>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="bulk-confirm-overlay" onClick={onCancelDelete}>
          <div className="bulk-confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>Ștergi {selCount} {selCount === 1 ? 'tichet' : 'tichete'}?</h3>
            <p>Acțiunea este ireversibilă. Dependențele legate de aceste tichete vor fi scoase automat.</p>
            <div className="bulk-confirm-actions">
              <button className="bulk-confirm-cancel" onClick={onCancelDelete}>Anulează</button>
              <button className="bulk-confirm-del" onClick={onConfirmDelete}>Șterge</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: PASS. `Wave` is exported from `src/lib/types.ts` (confirmed — this is the same type `store.tsx` uses for `waves: Wave[]`), so the import path above is correct.

- [ ] **Step 3: Commit**

```bash
git add src/components/BulkBar.tsx
git commit -m "feat: add shared BulkBar component"
```

---

## Task 5: Refactor `OrdineView` onto the shared pieces

**Files:**
- Modify: `src/components/OrdineView.tsx`

This is a **pure refactor** — Cards behavior must be identical afterward.

- [ ] **Step 1: Replace the whole file with the refactored version**

```tsx
import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { TicketCard } from './TicketCard'
import { WaveTabs } from './WaveTabs'
import { WaveActionsBar } from './WaveActionsBar'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav } from '../hooks'
import { LAYER_COLORS } from '../lib/layerColors'

export function OrdineView() {
  const { waves, activeWave } = useHorizontal()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size

  return (
    <div className="panel">
      <div className="wave-sel">
        <WaveTabs onWaveChange={wa.exitSelectMode} />
        <WaveActionsBar
          treeViewActive={wa.treeViewActive}
          onToggleTree={wa.toggleTree}
          hideDone={hideDone}
          onToggleHideDone={toggleHideDone}
          selectMode={wa.selectMode}
          onEnterSelect={wa.enterSelectMode}
          onExitSelect={wa.exitSelectMode}
        />
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => {
          const ready = i === 0
          const color = LAYER_COLORS[i % LAYER_COLORS.length]
          return (
            <div key={g.L} className={`layer ${ready ? 'ready' : ''}`} style={{ '--layer-color': color } as React.CSSProperties}>
              <div className="layer-head">
                <div className="layer-num">{g.L + 1}</div>
                <div>
                  <h4>{ready ? 'Începe aici' : `Layer ${g.L + 1}`}</h4>
                  <div className="sub">
                    {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${g.L}`} · {g.ids.length}{' '}
                    tichete
                  </div>
                </div>
                {ready && <span className="badge-now">Acum</span>}
              </div>
              {g.ids.map((id) => (
                <TicketCard
                  key={id}
                  id={id}
                  contextWave={activeWave}
                  selectMode={!wa.treeViewActive && wa.selectMode}
                  isSelected={wa.selectedIds.has(id)}
                  onToggleSelect={wa.toggleItem}
                  treeMode={wa.treeViewActive}
                  highlighted={wa.highlightedIds ? wa.highlightedIds.has(id) : undefined}
                  onTreeSelect={wa.handleTreeSelect}
                  focused={focusedId === id}
                />
              ))}
            </div>
          )
        })
      )}

      {wa.selectMode && (
        <BulkBar
          selCount={selCount}
          otherWaves={otherWaves}
          confirmDel={wa.confirmDel}
          onBulkMove={(w) => void wa.handleBulkMove(w)}
          onRequestDelete={wa.openConfirm}
          onConfirmDelete={() => void wa.handleBulkDelete()}
          onCancelDelete={wa.cancelConfirm}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual regression on Cards view**

Run: `npm run dev`, open the app, go to the **Cards** tab. Confirm ALL of these still work exactly as before:
- Tree button toggles highlight; clicking a card highlights its dependency chain and dims the rest.
- `T` key toggles Tree; entering Tree exits Select.
- Ascunde/Arată button shows the eye / eye-off icon and hides/shows done tickets.
- Select button enters select mode; checkboxes select; bulk bar appears with move-to-wave + delete; confirm overlay works.
- `Esc` unwinds confirm → tree → select.
- Vim `H/J/K/L` moves focus, `Enter` opens the sheet, `Esc` clears focus, focused card scrolls into view.

Expected: no behavior change from before this task.

- [ ] **Step 4: Commit**

```bash
git add src/components/OrdineView.tsx
git commit -m "refactor: move OrdineView onto shared hooks and components"
```

---

## Task 6: Add `.list-row` state CSS

**Files:**
- Modify: `src/styles.css`

Mirror the existing `.tk` state rules for list rows so highlight/dim/focus/select read correctly.

- [ ] **Step 1: Append these rules near the existing `.list-row` block (after line ~558)**

```css
/* List-row parity with .tk states (tree / select / vim) */
.list-row.vim-focused {
  outline: 2px solid var(--layer-color, var(--accent));
  outline-offset: 2px;
  background: color-mix(in srgb, var(--layer-color, var(--accent)) 8%, var(--surface));
}
.list-row.selected {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.list-row.in-select .list-check {
  color: transparent;
  background: var(--bg);
  border-color: var(--line);
}
.list-row.selected .list-check {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.list-row.tree-dim {
  opacity: 0.18;
  filter: grayscale(0.4);
  transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}
.list-row.tree-highlight {
  opacity: 1;
  filter: none;
  box-shadow: 0 0 0 2px var(--accent), 0 4px 16px color-mix(in srgb, var(--accent) 30%, transparent);
  transition: opacity 200ms ease, filter 200ms ease, box-shadow 200ms ease;
  z-index: 1;
  position: relative;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat: add list-row tree/select/vim state styles"
```

---

## Task 7: Wire `ListView` onto the shared pieces + upgrade rows

**Files:**
- Modify: `src/components/ListView.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { WaveTabs } from './WaveTabs'
import { WaveActionsBar } from './WaveActionsBar'
import { BulkBar } from './BulkBar'
import { useHideDone, useOrderedLayers, useWaveActions, useVimNav } from '../hooks'
import { LAYER_COLORS } from '../lib/layerColors'

export function ListView() {
  const { waves, activeWave, byId, stateOf, themeOf, toggleDone } = useHorizontal()
  const { openEditIssue } = useUI()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])

  const wa = useWaveActions()
  const { focusedId } = useVimNav(flatLayers)

  const otherWaves = waves.filter((w) => w.number !== activeWave)
  const selCount = wa.selectedIds.size
  const inSelect = !wa.treeViewActive && wa.selectMode

  return (
    <div className="panel">
      <div className="wave-sel">
        <WaveTabs onWaveChange={wa.exitSelectMode} />
        <WaveActionsBar
          treeViewActive={wa.treeViewActive}
          onToggleTree={wa.toggleTree}
          hideDone={hideDone}
          onToggleHideDone={toggleHideDone}
          selectMode={wa.selectMode}
          onEnterSelect={wa.enterSelectMode}
          onExitSelect={wa.exitSelectMode}
        />
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => (
          <div
            key={g.L}
            className="list-group"
            style={{ '--layer-color': LAYER_COLORS[i % LAYER_COLORS.length] } as React.CSSProperties}
          >
            <div className="list-group-head">
              <span className="list-group-num">{g.L + 1}</span>
              <span className="list-group-label">{i === 0 ? 'Începe aici' : `Layer ${g.L + 1}`}</span>
              <span className="list-group-count">{g.ids.length}</span>
            </div>
            {g.ids.map((id) => {
              const it = byId[id]
              if (!it) return null
              const state = stateOf(id)
              const theme = it.theme ? themeOf(it.theme) : undefined
              const isSelected = wa.selectedIds.has(id)
              const treeClass = wa.treeViewActive
                ? wa.highlightedIds === null
                  ? ''
                  : wa.highlightedIds.has(id)
                    ? ' tree-highlight'
                    : ' tree-dim'
                : ''
              const cls =
                `list-row ${state}` +
                (isSelected ? ' selected' : '') +
                (inSelect ? ' in-select' : '') +
                treeClass +
                (focusedId === id ? ' vim-focused' : '')

              const handleClick = () => {
                if (wa.treeViewActive) wa.handleTreeSelect(id)
                else if (inSelect) wa.toggleItem(id)
                else openEditIssue(id)
              }

              return (
                <button type="button" key={id} className={cls} onClick={handleClick} data-issue-id={id}>
                  <span
                    className="list-check"
                    role="checkbox"
                    aria-checked={inSelect ? isSelected : it.done}
                    aria-label={
                      inSelect
                        ? (isSelected ? 'Deselectează' : 'Selectează')
                        : (it.done ? 'Marchează nefăcut' : 'Marchează gata')
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      if (wa.treeViewActive) return
                      if (inSelect) wa.toggleItem(id)
                      else void toggleDone(id)
                    }}
                  >
                    {(inSelect ? isSelected : it.done) ? '✓' : ''}
                  </span>
                  {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                  <span className="list-id">{id}</span>
                  <span className="list-title">{it.title}</span>
                  {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
                </button>
              )
            })}
          </div>
        ))
      )}

      {wa.selectMode && (
        <BulkBar
          selCount={selCount}
          otherWaves={otherWaves}
          confirmDel={wa.confirmDel}
          onBulkMove={(w) => void wa.handleBulkMove(w)}
          onRequestDelete={wa.openConfirm}
          onConfirmDelete={() => void wa.handleBulkDelete()}
          onCancelDelete={wa.cancelConfirm}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS (tsc + vite build succeed).

- [ ] **Step 4: Manual verification on List view**

Run: `npm run dev`, open the **List** (Cards→List) tab. Confirm parity with Cards:
- Three buttons render: Tree (node icon), Ascunde/Arată (**eye icon now present**), Select (checkbox icon).
- Tree button + `T` key toggle highlight; clicking a row highlights its dependency chain and dims the rest; entering Tree exits Select.
- Select enters select mode; row checkboxes select; bulk bar appears; move-to-wave + delete + confirm overlay work.
- `Esc` unwinds confirm → tree → select.
- Vim `H/J/K/L` moves focus across rows, `Enter` opens the sheet, `Esc` clears focus, focused row scrolls into view.
- Switching waves resets tree + focus.

- [ ] **Step 5: Cross-view regression**

Switch back to Cards — everything from Task 5 Step 3 still works. Toggle hide-done on one tab, switch tabs — the value persists (per `useHideDone` docs).

- [ ] **Step 6: Commit**

```bash
git add src/components/ListView.tsx
git commit -m "feat: full Tree/Select/vim parity on List view"
```

---

## Self-Review Notes

- **Spec coverage:** Tree button + highlight (Tasks 1,3,5,7,6), hide-done icon (Task 3), Select + bulk bar (Tasks 1,4,5,7), `T` key (Task 1), `Esc` ordering (Task 1), vim nav (Task 2,5,7), tree-hides-select (Task 1 `toggleTree`), CSS states (Task 6). All spec rows covered.
- **Type consistency:** hook exposes `toggleItem` (item) vs `enterSelectMode`/`exitSelectMode` (mode) — no name collision with the old `toggleSelect`. `highlightedIds`/`treeViewActive`/`handleTreeSelect` names match across Tasks 1, 5, 7. `WaveActionsBar` and `BulkBar` prop names are consistent between their definitions (Tasks 3,4) and call sites (Tasks 5,7).
- **Known deviation:** `Esc` is handled by two independent listeners (`useWaveActions` for confirm/tree/select, `useVimNav` for focus) — same as today's Cards behavior; both may act on a single Esc when multiple states are set. Preserved intentionally.
- **Wave type import (Task 4)** is the one spot that may need path adjustment — Step 2 there gives the fallback grep.
```
