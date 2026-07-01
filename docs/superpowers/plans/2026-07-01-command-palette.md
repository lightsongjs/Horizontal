# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code-style command palette (Ctrl+P) with a modular command registry, working inside a project.

**Architecture:** A pure command registry in `src/lib/commands.ts` holds static definitions. `CommandPalette.tsx` is a generic renderer that resolves actions via hooks. View state (`hideDone`, `treeView`, `selectMode`, `activeTab`) moves from local component state to `ui.tsx` so the palette can read and write it from anywhere.

**Tech Stack:** React, TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/fuzzy.ts` | Create | Shared fuzzy match + highlight logic |
| `src/lib/fuzzy.test.ts` | Create | Unit tests for fuzzy |
| `src/lib/commands.ts` | Create | Command type + static COMMANDS registry |
| `src/ui.tsx` | Modify | Add `Tab` type + view state (hideDone, treeView, selectMode, activeTab) |
| `src/components/OrdineView.tsx` | Modify | Read hideDone, treeView, selectMode from `useUI()` instead of local state |
| `src/components/ProjectDetail.tsx` | Modify | Import `Tab` from `ui.tsx` instead of defining it locally |
| `src/App.tsx` | Modify | Import `Tab` from `ui.tsx`; move `tab` state to `useUI()`; add Ctrl+P handler; render `CommandPalette` |
| `src/components/CommandPalette.tsx` | Create | Generic palette renderer with sub-selector support |
| `src/components/QuickSearch.tsx` | Modify | Import `fuzzy` + `highlight` from `src/lib/fuzzy.ts` |

---

## Task 1: Extract fuzzy utilities to `src/lib/fuzzy.ts`

**Files:**
- Create: `src/lib/fuzzy.ts`
- Create: `src/lib/fuzzy.test.ts`

- [ ] **Step 1: Create `src/lib/fuzzy.ts`**

```ts
export function fuzzy(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function highlight(query: string, text: string): React.ReactNode {
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
```

> Note: `highlight` returns `React.ReactNode` — add `import React from 'react'` at the top of the file.

- [ ] **Step 2: Write tests in `src/lib/fuzzy.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { fuzzy } from './fuzzy'

describe('fuzzy', () => {
  it('returns true for empty query', () => {
    expect(fuzzy('', 'anything')).toBe(true)
  })
  it('matches exact substring', () => {
    expect(fuzzy('abc', 'xabcx')).toBe(true)
  })
  it('matches characters in order', () => {
    expect(fuzzy('ac', 'abbc')).toBe(true)
  })
  it('returns false when characters out of order', () => {
    expect(fuzzy('ca', 'abc')).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(fuzzy('ABC', 'xabcx')).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests**

```
npx vitest run src/lib/fuzzy.test.ts
```

Expected: 5 passing

- [ ] **Step 4: Commit**

```
git add src/lib/fuzzy.ts src/lib/fuzzy.test.ts
git commit -m "feat: extract fuzzy match to shared lib"
```

---

## Task 2: Update `QuickSearch.tsx` to import from shared lib

**Files:**
- Modify: `src/components/QuickSearch.tsx`

- [ ] **Step 1: Replace the local `fuzzy` and `highlight` functions**

In `src/components/QuickSearch.tsx`, remove the two function definitions (lines 9–36) and add this import at the top:

```ts
import { fuzzy, highlight } from '../lib/fuzzy'
```

- [ ] **Step 2: Run dev server and test**

```
npm run dev
```

Open the app, press `O` to open QuickSearch, type a query. Verify results still filter and highlight correctly.

- [ ] **Step 3: Commit**

```
git add src/components/QuickSearch.tsx
git commit -m "refactor: QuickSearch imports fuzzy from shared lib"
```

---

## Task 3: Create `src/lib/commands.ts`

**Files:**
- Create: `src/lib/commands.ts`

- [ ] **Step 1: Create the file**

```ts
export type CommandId =
  | 'search-ticket'
  | 'create-ticket'
  | 'switch-project'
  | 'toggle-done-filter'
  | 'toggle-tree-view'
  | 'toggle-select-mode'
  | 'go-to-ordine'

export interface Command {
  id: CommandId
  label: string
  keywords?: string[]
}

export const COMMANDS: Command[] = [
  { id: 'search-ticket',      label: 'Caută tichet',                      keywords: ['find', 'search', 'open'] },
  { id: 'create-ticket',      label: 'Creează tichet nou',                keywords: ['add', 'new', 'create'] },
  { id: 'switch-project',     label: 'Schimbă proiect',                   keywords: ['open', 'project', 'switch'] },
  { id: 'toggle-done-filter', label: 'Ascunde/Arată completate',          keywords: ['hide', 'done', 'completed', 'filter'] },
  { id: 'toggle-tree-view',   label: 'Activează/Dezactivează tree view',  keywords: ['tree', 'view', 'graph'] },
  { id: 'toggle-select-mode', label: 'Activează/Dezactivează select mode', keywords: ['bulk', 'select', 'multi'] },
  { id: 'go-to-ordine',       label: 'Mergi la Ordine',                   keywords: ['tab', 'ordine', 'navigate'] },
]
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/lib/commands.ts
git commit -m "feat: add command palette registry"
```

---

## Task 4: Move `Tab` type and add view state to `ui.tsx`

**Files:**
- Modify: `src/ui.tsx`
- Modify: `src/components/ProjectDetail.tsx` (remove local `Tab` export, import from `ui.tsx`)

- [ ] **Step 1: Add `Tab` type and view state to `src/ui.tsx`**

Replace the entire content of `src/ui.tsx` with:

```ts
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type Tab = 'ordine' | 'graf' | 'teme'

export type SheetState =
  | { kind: 'none' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'issue-form'; issueId?: string }
  | { kind: 'project-form' }
  | { kind: 'project-settings' }
  | { kind: 'wave-manage' }
  | { kind: 'theme-manage' }

interface UI {
  sheet: SheetState
  openIssue(id: string): void
  openNewIssue(): void
  openEditIssue(id: string): void
  openNewProject(): void
  openProjectSettings(): void
  openWaveManage(): void
  openThemeManage(): void
  closeSheet(): void
  setCloseGuard(fn: (() => boolean) | null): void

  // view state (shared so CommandPalette can read/write)
  activeTab: Tab
  setActiveTab(tab: Tab): void
  hideDone: boolean
  setHideDone(v: boolean): void
  treeView: boolean
  setTreeView(v: boolean): void
  selectMode: boolean
  setSelectMode(v: boolean): void
}

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' })
  const closeGuard = useRef<(() => boolean) | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('ordine')
  const [hideDone, setHideDone] = useState(false)
  const [treeView, setTreeView] = useState(false)
  const [selectMode, setSelectMode] = useState(false)

  const value = useMemo<UI>(
    () => ({
      sheet,
      openIssue: (issueId) => setSheet({ kind: 'issue-form', issueId }),
      openNewIssue: () => setSheet({ kind: 'issue-form' }),
      openEditIssue: (issueId) => setSheet({ kind: 'issue-form', issueId }),
      openNewProject: () => setSheet({ kind: 'project-form' }),
      openProjectSettings: () => setSheet({ kind: 'project-settings' }),
      openWaveManage: () => setSheet({ kind: 'wave-manage' }),
      openThemeManage: () => setSheet({ kind: 'theme-manage' }),
      closeSheet: () => {
        if (closeGuard.current && !closeGuard.current()) return
        setSheet({ kind: 'none' })
      },
      setCloseGuard: (fn) => { closeGuard.current = fn },
      activeTab,
      setActiveTab,
      hideDone,
      setHideDone,
      treeView,
      setTreeView,
      selectMode,
      setSelectMode,
    }),
    [sheet, activeTab, hideDone, treeView, selectMode],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
```

- [ ] **Step 2: Update `ProjectDetail.tsx` — remove local `Tab` type, import from `ui.tsx`**

In `src/components/ProjectDetail.tsx`, find the line that defines `Tab`:

```ts
export type Tab = 'ordine' | 'graf' | 'teme'
```

Remove it and add this import:

```ts
import type { Tab } from '../ui'
```

Remove the `export` from the old definition entirely — `App.tsx` will import `Tab` directly from `ui.tsx` in Task 6.

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui.tsx src/components/ProjectDetail.tsx
git commit -m "feat: add view state to UI context (tab, hideDone, treeView, selectMode)"
```

---

## Task 5: Update `OrdineView.tsx` to use state from `useUI()`

**Files:**
- Modify: `src/components/OrdineView.tsx`

- [ ] **Step 1: Replace local state declarations with `useUI()`**

In `src/components/OrdineView.tsx`:

1. Add `useUI` to the imports from `../ui`:
```ts
import { useUI } from '../ui'
```

2. Inside the component, remove these three lines:
```ts
const [selectMode, setSelectMode] = useState(false)
const [hideDone, setHideDone] = useState(false)
const [treeViewActive, setTreeViewActive] = useState(false)
```

3. Add this line instead (near the top of the component, after the other hooks):
```ts
const { hideDone, setHideDone, treeView: treeViewActive, setTreeView: setTreeViewActive, selectMode, setSelectMode } = useUI()
```

> This renames `treeView`→`treeViewActive` and keeps the rest of the component code unchanged — no other lines need editing.

- [ ] **Step 2: Run dev server and test**

```
npm run dev
```

- Open a project, go to Ordine tab
- Click the "Completed" toggle button — verify it hides/shows done tickets
- Click the "Tree View" toggle button — verify tree view activates
- Click the "☐" bulk select button — verify select mode activates

- [ ] **Step 3: Commit**

```
git add src/components/OrdineView.tsx
git commit -m "refactor: OrdineView reads view state from UI context"
```

---

## Task 6: Update `App.tsx` (Shell) to use `activeTab` from `useUI()`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

In `src/App.tsx`, change:
```ts
import { ProjectDetail, type Tab } from './components/ProjectDetail'
```
to:
```ts
import { ProjectDetail } from './components/ProjectDetail'
import type { Tab } from './ui'
```

- [ ] **Step 2: Remove local `tab` state, use `useUI()` instead**

In the `Shell` component:

Remove:
```ts
const [tab, setTab] = useState<Tab>('ordine')
```

Update the `useUI()` destructure to include:
```ts
const { openNewIssue, openNewProject, openProjectSettings, sheet, activeTab: tab, setActiveTab: setTab } = useUI()
```

The existing reset effect stays unchanged — `setTab` now refers to `setActiveTab` from `useUI()` but the effect code is identical:
```ts
useEffect(() => { setTab('ordine') }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Verify TypeScript compiles and app works**

```
npx tsc --noEmit
npm run dev
```

Switch between projects — verify the tab resets to Ordine. Switch tabs manually — verify they work.

- [ ] **Step 4: Commit**

```
git add src/App.tsx
git commit -m "refactor: Shell reads activeTab from UI context"
```

---

## Task 7: Create `CommandPalette.tsx`

**Files:**
- Create: `src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { COMMANDS, type Command } from '../lib/commands'
import { fuzzy } from '../lib/fuzzy'

interface Props {
  onClose: () => void
  onOpenSearch: () => void
}

type Mode = 'commands' | 'switch-project'

function getDynamicLabel(cmd: Command, hideDone: boolean, treeView: boolean, selectMode: boolean): string {
  if (cmd.id === 'toggle-done-filter') return hideDone ? 'Arată completate' : 'Ascunde completate'
  if (cmd.id === 'toggle-tree-view') return treeView ? 'Dezactivează tree view' : 'Activează tree view'
  if (cmd.id === 'toggle-select-mode') return selectMode ? 'Dezactivează select mode' : 'Activează select mode'
  return cmd.label
}

function matchesQuery(query: string, cmd: Command, dynamicLabel: string): boolean {
  if (!query) return true
  const targets = [dynamicLabel, ...(cmd.keywords ?? [])]
  return targets.some((t) => fuzzy(query, t))
}

export function CommandPalette({ onClose, onOpenSearch }: Props) {
  const { projects, selectProject } = useHorizontal()
  const { openNewIssue, hideDone, setHideDone, treeView, setTreeView, selectMode, setSelectMode, setActiveTab } = useUI()
  const [mode, setMode] = useState<Mode>('commands')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelected(0) }, [query, mode])
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const dynamicLabels = COMMANDS.reduce<Record<string, string>>((acc, cmd) => {
    acc[cmd.id] = getDynamicLabel(cmd, hideDone, treeView, selectMode)
    return acc
  }, {})

  const filteredCommands = COMMANDS.filter((cmd) => matchesQuery(query, cmd, dynamicLabels[cmd.id]))
  const filteredProjects = projects.filter((p) => fuzzy(query, p.name))

  const items = mode === 'commands' ? filteredCommands : filteredProjects
  const count = items.length

  const execute = (index: number) => {
    if (mode === 'switch-project') {
      const p = filteredProjects[index]
      if (p) { selectProject(p.id); onClose() }
      return
    }
    const cmd = filteredCommands[index]
    if (!cmd) return
    if (cmd.id === 'switch-project') {
      setMode('switch-project')
      setQuery('')
      return
    }
    if (cmd.id === 'search-ticket') { onClose(); onOpenSearch(); return }
    if (cmd.id === 'create-ticket') { onClose(); openNewIssue(); return }
    if (cmd.id === 'toggle-done-filter') { setHideDone(!hideDone); onClose(); return }
    if (cmd.id === 'toggle-tree-view') { setTreeView(!treeView); onClose(); return }
    if (cmd.id === 'toggle-select-mode') { setSelectMode(!selectMode); onClose(); return }
    if (cmd.id === 'go-to-ordine') { setActiveTab('ordine'); onClose(); return }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, count - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); execute(selected) }
    else if (e.key === 'Escape') {
      if (mode === 'switch-project') { setMode('commands'); setQuery('') }
      else onClose()
    }
  }

  return (
    <div className="qs-overlay" onClick={onClose}>
      <div className="qs-card" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="qs-input-wrap">
          {mode === 'switch-project' && (
            <span className="cp-mode-badge">proiect</span>
          )}
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'commands' ? 'Comandă…' : 'Caută proiect…'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="qs-esc-badge">esc</kbd>
        </div>

        {count > 0 && (
          <div className="qs-results" ref={listRef}>
            {mode === 'commands'
              ? filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    className={`qs-item ${i === selected ? 'on' : ''}`}
                    onClick={() => execute(i)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <span className="qs-item-title">{dynamicLabels[cmd.id]}</span>
                    {(cmd.id === 'toggle-done-filter' && hideDone) ||
                     (cmd.id === 'toggle-tree-view' && treeView) ||
                     (cmd.id === 'toggle-select-mode' && selectMode)
                      ? <span className="qs-item-done">✓</span>
                      : null}
                    {cmd.id === 'switch-project' && <span className="qs-item-id">›</span>}
                  </button>
                ))
              : filteredProjects.map((p, i) => (
                  <button
                    key={p.id}
                    className={`qs-item ${i === selected ? 'on' : ''}`}
                    onClick={() => execute(i)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <span className="qs-item-id">{p.prefix}</span>
                    <span className="qs-item-title">{p.name}</span>
                  </button>
                ))}
          </div>
        )}

        {query && count === 0 && (
          <div className="qs-empty">Niciun rezultat pentru „{query}"</div>
        )}

        <div className="qs-footer">
          <span><kbd>↑↓</kbd> navighează</span>
          <span><kbd>↵</kbd> execută</span>
          <span><kbd>esc</kbd> {mode === 'switch-project' ? 'înapoi' : 'închide'}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add `.cp-mode-badge` CSS to the existing styles**

In `src/styles.css` (or wherever the `.qs-*` styles live), add:

```css
.cp-mode-badge {
  background: var(--accent, #7c6af7);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
  margin-right: 6px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/components/CommandPalette.tsx src/styles.css
git commit -m "feat: add CommandPalette component"
```

---

## Task 8: Wire Ctrl+P in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import CommandPalette**

Add to the imports at the top of `src/App.tsx`:

```ts
import { CommandPalette } from './components/CommandPalette'
```

- [ ] **Step 2: Add palette state and Ctrl+P handler**

In `Shell`, add:

```ts
const [showPalette, setShowPalette] = useState(false)
```

In the `onKey` handler, add this block **before** the existing `if (e.metaKey || e.ctrlKey || e.altKey) return` line:

```ts
if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
  e.preventDefault()
  if (project) setShowPalette(true)
  return
}
```

Also add Escape handling for the palette alongside the other Escape handlers:

```ts
if (e.key === 'Escape' && showPalette) { setShowPalette(false); return }
```

Update the `useEffect` dependency array to include `showPalette`.

- [ ] **Step 3: Render CommandPalette**

In the JSX of `Shell`, add next to `{showSearch && <QuickSearch ... />}`:

```tsx
{showPalette && (
  <CommandPalette
    onClose={() => setShowPalette(false)}
    onOpenSearch={() => setShowSearch(true)}
  />
)}
```

- [ ] **Step 4: Update SHORTCUTS list (optional cosmetic)**

In `App.tsx`, add to the `SHORTCUTS` array:

```ts
{ key: 'Ctrl+P', action: 'Command palette' },
```

- [ ] **Step 5: Run dev server and test end-to-end**

```
npm run dev
```

Test each command:
- `Ctrl+P` → palette opens
- Type "cau" → "Caută tichet" appears filtered
- Select "Caută tichet" → palette closes, QuickSearch opens
- `Ctrl+P` → "Creează tichet" → issue form opens
- `Ctrl+P` → "Schimbă proiect" → sub-selector appears with project list → select a project → navigates
- `Ctrl+P` → "Ascunde completate" → done tickets hidden, ✓ badge visible on re-open
- `Ctrl+P` → "Activează tree view" → tree view activates
- `Ctrl+P` → "Activează select mode" → bulk select activates
- `Escape` in sub-selector → back to command list
- `Escape` in command list → palette closes
- `O` shortcut → QuickSearch still works
- `C` shortcut → new issue still works

- [ ] **Step 6: Commit**

```
git add src/App.tsx
git commit -m "feat: wire Ctrl+P command palette"
```

---

## Done

All tasks complete. The command palette is live at `Ctrl+P` inside any project. To add a new command in the future: add one object to `COMMANDS` in `src/lib/commands.ts` and one `if` branch in `CommandPalette.tsx`'s `execute` function.
