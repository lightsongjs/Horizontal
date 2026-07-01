# Command Palette — Design Spec

**Date:** 2026-07-01  
**Status:** Approved  
**Scope:** Inside a project only (global extension planned for later)

---

## Overview

A VS Code-style command palette triggered by `Ctrl+P`. Shows a filterable list of commands by default; as the user types, commands are fuzzy-matched. Some commands have a sub-selector (e.g. Switch Project shows a project list inline). Built to be modular — adding a new command requires only a new entry in the registry.

---

## Architecture

Two new files, minimal changes to existing files:

```
src/
  lib/
    commands.ts          # Pure data: Command type + static COMMANDS list
  components/
    CommandPalette.tsx   # Generic renderer, resolves actions via hooks
```

**Existing files modified:**
- `src/ui.tsx` — add 4 new shared state fields (hideDone, treeView, bulkSelect, activeTab)
- `src/App.tsx` — add Ctrl+P handler + render CommandPalette
- `src/components/OrdineView.tsx` — read hideDone, treeView, bulkSelect from ui.tsx instead of local useState

---

## Command Registry (`src/lib/commands.ts`)

Pure TypeScript — no React imports, no store imports. Testable in isolation.

```ts
export type CommandId =
  | 'search-ticket'
  | 'create-ticket'
  | 'switch-project'
  | 'toggle-done-filter'
  | 'toggle-tree-view'
  | 'toggle-bulk-select'
  | 'go-to-ordine'

export interface Command {
  id: CommandId
  label: string
  keywords?: string[]
}

export const COMMANDS: Command[] = [
  { id: 'search-ticket',      label: 'Caută tichet',                    keywords: ['find', 'search', 'open'] },
  { id: 'create-ticket',      label: 'Creează tichet nou',              keywords: ['add', 'new', 'create'] },
  { id: 'switch-project',     label: 'Schimbă proiect',                 keywords: ['open', 'project', 'switch'] },
  { id: 'toggle-done-filter', label: 'Ascunde/Arată completate'                                               },
  { id: 'toggle-tree-view',   label: 'Activează/Dezactivează tree view', keywords: ['tree', 'view'] },
  { id: 'toggle-bulk-select', label: 'Activează/Dezactivează select mode', keywords: ['bulk', 'select', 'multi'] },
  { id: 'go-to-ordine',       label: 'Mergi la Ordine',                 keywords: ['tab', 'ordine', 'navigate'] },
]
```

Toggle labels are rendered dynamically in `CommandPalette.tsx` based on current state (e.g. "**Ascunde** completate" vs "**Arată** completate").

---

## State moved to `ui.tsx`

These 4 states move from local component state to the shared UI context:

| State | From | To |
|---|---|---|
| `hideDone` | `OrdineView.tsx` | `ui.tsx` |
| `treeView` | `OrdineView.tsx` | `ui.tsx` |
| `bulkSelect` | `OrdineView.tsx` | `ui.tsx` |
| `activeTab` | `Shell` in `App.tsx` | `ui.tsx` |

`OrdineView` and `Shell` read these via `useUI()` — existing buttons, vim bindings, and keyboard shortcuts continue to work without changes to their logic.

---

## `CommandPalette.tsx` — State Machine

Two modes:

```
mode: 'commands'    — filterable list of COMMANDS
mode: 'sub-select'  — inline project list (only sub-selector for now)
```

Transitions:
- `Enter` on "Schimbă proiect" → `mode: 'sub-select'`, query cleared
- `Escape` in `sub-select` → back to `mode: 'commands'`
- `Escape` in `commands` → `onClose()`
- Any command executed → `onClose()`

**Action map (resolved via hooks inside CommandPalette):**

| CommandId | Action |
|---|---|
| `search-ticket` | `onClose()` + `setShowSearch(true)` |
| `create-ticket` | `onClose()` + `openNewIssue()` |
| `switch-project` | enter `sub-select` mode |
| `toggle-done-filter` | `setHideDone(!hideDone)` from `useUI()` |
| `toggle-tree-view` | `setTreeView(!treeView)` from `useUI()` |
| `toggle-bulk-select` | `setBulkSelect(!bulkSelect)` from `useUI()` |
| `go-to-ordine` | `setActiveTab('ordine')` from `useUI()` |

---

## Keyboard Integration (`App.tsx`)

`Ctrl+P` is handled before the existing `ctrlKey` guard:

```ts
if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
  e.preventDefault()
  if (project) setShowPalette(true)
  return
}
if (e.metaKey || e.ctrlKey || e.altKey) return  // existing guard unchanged
```

Existing shortcuts unaffected:
- `O` → QuickSearch (unchanged)
- `C` → new issue (unchanged)
- Vim bindings in OrdineView (unchanged — operate on their own state)

---

## Fuzzy Matching

Reuse the existing `fuzzy()` function from `QuickSearch.tsx` (or extract it to `src/lib/fuzzy.ts` if both files import it). Matching runs against `label + keywords`.

---

## UI Behavior

- Opens centered, same visual language as QuickSearch (overlay + card)
- Empty state: full list of all commands
- Typing: fuzzy-filtered list, first item auto-selected
- Arrow keys: navigate list
- Enter: execute selected command
- Escape: close (or go back to command list from sub-selector)
- Click outside overlay: close
- Toggle commands show current state inline (e.g. "Arată completate ✓" when hideDone is true)

---

## Out of Scope (this iteration)

- Command palette on projects list screen (no project selected)
- Command groups / sections
- Recently used commands
- Custom keybinding per command
