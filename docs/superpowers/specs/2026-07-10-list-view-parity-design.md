# List View ⇄ Cards parity — design spec

**Date:** 2026-07-10
**Project:** Horizontal
**Status:** Approved for planning

## Problem

The **Cards** view (`OrdineView.tsx`) has three action buttons and rich keyboard
behavior. The **List** view (`ListView.tsx`) is missing almost all of it:

| Feature | Cards | List (today) |
|---|---|---|
| **Tree** button — highlight dependency chain | ✅ | ❌ missing |
| **Ascunde/Arată** (hide done) button | ✅ with eye SVG icons | ⚠️ present but **no icon** (text only) |
| **Select** mode + bulk bar (move-to-wave / delete) | ✅ | ❌ missing |
| **T** key toggles Tree | ✅ | ❌ missing |
| **Esc** exit ordering (confirmDel → tree → select → vim) | ✅ | ❌ missing |
| Vim nav **H/J/K/L** + Enter + scroll-into-view | ✅ | ❌ missing |
| Tree active hides Select | ✅ | n/a |

Root cause: the behavior was built into `OrdineView` only. Duplicating it into
`ListView` would create a second copy that drifts again. This spec removes the
duplication by extracting the shared behavior.

## Goal

Full parity: the List view behaves **exactly** like the Cards view for Tree,
Select, hide-done, the **T** key, **Esc** ordering, and vim navigation. Only the
per-item and per-group rendering differs (card vs. row).

## Approach — extract shared behavior (Approach A)

Behavior lives in shared hooks + shared components. Each view keeps only its own
render loop.

### New: `src/hooks.ts` additions

**`useWaveActions()`** — owns all interaction state and handlers:

- State: `selectMode`, `selectedIds: Set<string>`, `treeViewActive`,
  `treeHighlightId`, `confirmDel`.
- Handlers: `exitSelectMode`, `exitTreeView`, `handleTreeSelect`, `toggleSelect`,
  `handleBulkMove(targetWave)`, `handleBulkDelete()`.
- Derived: `highlightedIds` (`treeHighlightId` + `getRelatedIds(...)`, or `null`).
- Effects:
  - **T/Esc keyboard**: `T` toggles tree (and exits select when entering tree);
    `Esc` unwinds in order **confirmDel → tree → select**. Guards: ignore when
    focus is in `INPUT`/`TEXTAREA`/contentEditable, when a modifier is held, or
    when a sheet is open (`sheet.kind !== 'none'`).
  - Reset `treeViewActive`/`treeHighlightId` when `activeWave` changes.
- Pulls `waves`, `activeWave`, `deleteIssue`, `updateIssue`, `byId` from
  `useHorizontal()` and `sheet` from `useUI()` internally.

**`useVimNav(flatLayers: string[][])`** — owns `focusedId` and:

- H/J/K/L movement across the layer grid, `Enter` opens edit, `Esc` clears focus.
- Same input/modifier/sheet guards as above.
- `scrollIntoView` effect on `focusedId`.
- Reset `focusedId` when `activeWave` changes.

Both hooks are behavior-only (no JSX) → live in the existing `src/hooks.ts`
module, consistent with `useHideDone`/`useOrderedLayers`.

### New: `src/components/WaveActionsBar.tsx`

Renders the three buttons (Tree, Ascunde/Arată **with the eye SVG icons**,
Select), identical markup to today's Cards toolbar. Controlled via props:
`treeViewActive`, `hideDone`, `selectMode`, and their toggle callbacks. No
internal state.

### New: `src/components/BulkBar.tsx`

Renders the bulk action bar + the confirm-delete overlay, identical to today's
Cards markup. Props: `selCount`, `otherWaves`, `confirmDel`, and the
`onBulkMove` / `onRequestDelete` / `onConfirmDelete` / `onCancelDelete`
callbacks. Renders nothing when not in select mode / no selection.

### Changed: `src/components/OrdineView.tsx`

Replace inline state, handlers, the two keyboard `useEffect`s, the toolbar JSX,
and the bulk/confirm JSX with `useWaveActions()`, `useVimNav(flatLayers)`,
`<WaveActionsBar>`, and `<BulkBar>`. The card render loop and layer headers stay.
Behavior must be unchanged (this is a pure refactor for Cards).

### Changed: `src/components/ListView.tsx`

Consume the same hooks and shared components. Upgrade the list **row** to mirror
`TicketCard`'s interaction:

- Accept `treeMode`, `highlighted`, `selectMode`, `isSelected`,
  `onToggleSelect`, `focused`.
- `handleClick`: tree → `onTreeSelect`, select → `onToggleSelect`, else
  `openEditIssue`.
- Row class gains `tree-highlight` / `tree-dim` / `vim-focused` / `selected` /
  `in-select` states, mirroring `.tk`.
- The check cell toggles selection in select mode, done otherwise, and is inert
  in tree mode.
- Add `data-issue-id={id}` for vim `scrollIntoView`.
- Pass `contextWave={activeWave}` as needed.

### CSS

Add `.list-row` variants for `.tree-highlight`, `.tree-dim`, `.vim-focused`,
`.selected`, `.in-select`, matching the existing `.tk` treatment. Locate the
stylesheet during implementation (single global stylesheet expected) and add
alongside the existing `.tk` rules.

## Behavior guaranteed identical on both views

- Tree active hides Select.
- `T` toggles Tree; `Esc` unwinds confirmDel → tree → select → vim focus.
- Dependency-chain highlight via `getRelatedIds`.
- Bulk bar: move-to-wave / delete with confirm overlay.
- Vim H/J/K/L + Enter + scroll-into-view.

## Non-goals

- No change to the layer/wave engine, data model, or persistence.
- No visual redesign of cards or rows beyond the state classes listed.
- No new keyboard shortcuts beyond porting the existing ones.

## Testing / verification

- Cards view: manual regression — Tree, Select, hide-done, T, Esc, vim all still
  work (pure refactor, no behavior change).
- List view: each feature now works and matches Cards.
- `npm run build` / typecheck passes.

## Risk

- **OrdineView refactor regressions.** Mitigate by moving logic verbatim into the
  hooks first, confirming Cards still works, then wiring List.
- **Two keydown listeners** (`useWaveActions` T/Esc + `useVimNav`) mounted on both
  views. They already coexist on Cards today; the guards prevent conflicts.
