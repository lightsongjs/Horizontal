# Priority flag + List view — design spec

Date: 2026-07-09
Branch: `feat/priority-and-list-view`
Baseline commit: `c93cdd4` (hide-done persistence fix)

## Goal

Two additions to the Ordine experience:

1. **Priority** — a simple urgent/normal flag on each issue. Urgent issues sort
   to the **left** within their layer on the board (and to the top within their
   layer group in the list).
2. **List view** — a new top-level tab `List` next to Ordine/Graf/Teme that
   shows the same wave-filtered, layer-grouped issues as compact rows instead of
   cards.

Non-goals (YAGNI): no multi-level priority scale, no drag-to-reorder, no manual
per-ticket ordering. Urgency is the only sort key beyond layer depth. Tree View
and Select Mode stay board-only.

## The invariant not to break

The layer/wave engine (`src/lib/engine.ts` `computeLayers`) stays **unchanged**.
It keeps input order within a layer, validated against `_EXPECTED_LAYERS` in
`data-model.json` (see `engine.test.ts`). Urgency ordering is applied as a
**UI-layer stable sort**, never inside the engine.

## 1. Data model — `src/lib/types.ts`

Add one field to `Issue`:

```ts
/** Urgent issues sort left within their layer. Default false. */
urgent: boolean
```

## 2. Persistence

### DB migration (Supabase)

```sql
alter table issues add column urgent boolean not null default false;
```

Run via a temporary admin script per CLAUDE.md convention (supabase-js from
`node_modules`, `VITE_SUPABASE_SERVICE_ROLE_KEY`), then delete the script.

### `src/data/supabaseRepository.ts`

- `IssueRow` gains `urgent: boolean`.
- `rowToIssue`: `urgent: row.urgent ?? false` (defensive default for rows written
  before the migration).
- create path: set `urgent: input.urgent ?? false` in the inserted row.
- update path: `if ('urgent' in patch) row.urgent = patch.urgent ?? false`,
  mirroring how `assigneeId` / `assignee_id` is handled.

### `src/data/localRepository.ts`

Same field on its in-memory issue shape, defaulting to `false` on create and
seed. Keep parity with the Supabase repo so tests and local dev agree.

### `src/data/repository.ts` (`NewIssue`)

Add optional `urgent?: boolean` to the create input type.

## 3. Ordering by urgency — shared UI logic

New hook `useOrderedLayers(hideDone: boolean)` (location:
`src/lib/useOrderedLayers.ts` or inline in a shared module). Returns an ordered
array of `{ L: number; ids: string[] }`:

- Start from the store's `layers` + `byId` + `layerKeys`.
- Within each layer, apply a **stable** sort: `urgent === true` first, original
  order otherwise. (`Array.prototype.sort` is stable in modern JS; implement as
  a partition to be explicit and avoid relying on comparator subtlety.)
- If `hideDone`, drop ids whose issue is `done`.
- Drop empty layers.

Both `OrdineView` and `ListView` consume this hook, so ordering + hide-done
filtering lives in exactly one place. `OrdineView` currently computes
`flatLayers` inline (lines ~87–95) and a second `visibleIds` in render (lines
~266–270) — both get replaced by this hook's output, removing the current
duplication.

## 4. Shared hide-done state — `useHideDone()`

Wrap the localStorage-backed `hideDone` state (key `horizontal:hide-done`, from
the baseline fix) in a small hook so Ordine and List read/write the same value
and stay in sync. Signature: `const [hideDone, setHideDone] = useHideDone()`.

## 5. Shared wave selector — `WaveTabs` component

Extract the wave selector buttons + ⚙ manage gear (currently inline in
`OrdineView` lines ~194–215) into `src/components/WaveTabs.tsx`. Props: none
required beyond store access; it reads `waves`, `issues`, `activeWave`,
`setActiveWave`, `openWaveManage` from the store/UI directly. On wave change it
calls an optional `onWaveChange?` callback (OrdineView passes `exitSelectMode`).

Board-specific action buttons (Tree / Ascunde / Select) stay in `OrdineView`.
`ListView` renders `WaveTabs` + only an "Ascunde completate" toggle.

## 6. Setting priority — `src/components/IssueForm.tsx`

Add a "⚡ Urgent" toggle (checkbox or pill button) to the form. Wire into the
existing create/update flow: include `urgent` in the payload passed to
`createIssue` / `updateIssue`. Default false for new issues. The dirty-check
logic in IssueForm (line ~215) must include `urgent` so the Save button enables
when only urgency changes.

## 7. Showing priority — `src/components/TicketCard.tsx`

Render a ⚡ badge when `issue.urgent`. Reused by both the board card and the list
row (or the list row renders its own compact ⚡ — see §8).

## 8. List view — `src/components/ListView.tsx` + `src/components/ProjectDetail.tsx`

### Tab wiring

`ProjectDetail.tsx`:
- `export type Tab = 'ordine' | 'list' | 'graf' | 'teme'`
- Add `{ key: 'list', label: 'List' }` to `TABS` (positioned right after
  `ordine`).
- `{tab === 'list' && <ListView />}`

Any other place that persists/reads the active tab (check `App.tsx` for a
`localStorage` tab key) must accept the new value without crashing.

### ListView component

- Renders `WaveTabs` + an "Ascunde completate" toggle (`useHideDone`).
- Uses `useOrderedLayers(hideDone)` for grouped, urgency-sorted ids.
- For each layer group: a light layer header (reusing existing `.layer-head` /
  `.layer-num` styling or a compact variant), then compact **rows**.
- Each row shows: title, theme color dot, assignee (if any), derived state
  (done/active/blocked via `stateOf`), and a ⚡ marker when urgent.
- Clicking a row calls `openEditIssue(id)` — reuses the existing issue sheet.
- Empty states mirror OrdineView ("Niciun val…", "Niciun tichet în acest val…").

### Styling

Compact list rows are new CSS. Follow the existing dark-theme tokens and the
`.layer` / `.ticket` visual language. Keep rows mobile-first (full-width,
tappable height ≥ 40px). Add styles alongside existing component styles (same
stylesheet the board uses).

## Testing

- **Engine**: unchanged — existing `engine.test.ts` must still pass untouched.
- **Repositories**: extend `supabaseRepository.test.ts` / `localRepository.test.ts`
  to cover `urgent` round-tripping (create default false, update to true, read
  back).
- **Ordering hook**: unit test `useOrderedLayers`' sort — urgent-first, stable,
  hide-done filtering, empty-layer removal. (Test the pure sort helper directly
  rather than the hook if that's simpler.)
- **Manual**: toggle urgent on a ticket → it jumps left on the board and top of
  its layer in the list; refresh → urgency + hide-done persist; List tab renders
  the same tickets as the board for the active wave.

## Build order

1. Data model + repositories + DB migration (round-trips `urgent`).
2. Shared hooks (`useHideDone`, `useOrderedLayers` / sort helper) + `WaveTabs`
   extraction; refactor `OrdineView` to use them (no visible change yet).
3. IssueForm urgent toggle + TicketCard ⚡ badge + board urgency ordering.
4. ListView + `list` tab.
5. Tests + manual verification.
