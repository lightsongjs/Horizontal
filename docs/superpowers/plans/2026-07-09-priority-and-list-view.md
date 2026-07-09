# Priority flag + List view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `urgent` flag to issues (sorted left within each board layer) and a new top-level `List` tab that shows the same wave-filtered, layer-grouped issues as compact rows.

**Architecture:** `urgent: boolean` is added to the `Issue` model and round-tripped through both repositories (+ a Supabase column). The pure layer engine stays untouched; urgency ordering is a pure, tested UI helper (`src/lib/ordering.ts`) consumed via a `useOrderedLayers` hook that both the board and the list use. Shared UI (`WaveTabs`, `useHideDone`) is extracted so the two views don't duplicate logic.

**Tech Stack:** React + TypeScript, Vitest (pure/repo tests only — no component-test harness), Supabase / localStorage repositories.

**Branch:** `feat/priority-and-list-view` (baseline commit `c93cdd4`).

**Test note:** The repo has **no** component testing library (no testing-library/jsdom). TDD applies to `src/lib/ordering.ts` and the repositories. UI (IssueForm toggle, TicketCard badge, ListView, WaveTabs) is verified manually via `npm run dev`, consistent with the existing test suite which covers only the engine and repositories.

---

## File Structure

**Create:**
- `src/lib/ordering.ts` — pure urgency-ordering helpers (`orderIdsByUrgency`, `buildOrderedLayers`).
- `src/lib/ordering.test.ts` — unit tests for the above.
- `src/hooks.ts` — `useHideDone` (localStorage-backed) + `useOrderedLayers` (store → ordered layer groups).
- `src/components/WaveTabs.tsx` — the wave selector buttons + ⚙ gear, shared by board and list.
- `src/components/ListView.tsx` — the new List tab.

**Modify:**
- `src/lib/types.ts` — add `urgent: boolean` to `Issue`.
- `src/lib/seed.ts` — add `urgent: false` to the 5 seed issues.
- `src/data/repository.ts` — add `urgent?: boolean` to `NewIssue`.
- `src/data/localRepository.ts` — default `urgent` on create + defensive load migration.
- `src/data/supabaseRepository.ts` — `IssueRow` column, `rowToIssue`, create insert, update patch.
- `src/data/localRepository.test.ts` — `urgent` round-trip test.
- `src/components/IssueForm.tsx` — urgent toggle, dirty-check, save payload, 2 Issue literals.
- `src/components/TicketCard.tsx` — ⚡ badge.
- `src/components/OrdineView.tsx` — consume `useOrderedLayers` + `useHideDone` + `WaveTabs`.
- `src/components/ProjectDetail.tsx` — add `list` tab.
- `src/App.tsx` — tab keyboard shortcuts + help table (1=Ordine, 2=List, 3=Graf, 4=Teme).
- `src/styles.css` — compact list-row styles + ⚡ badge styles.
- DB (Supabase) — `alter table issues add column urgent ...`.

---

## Task 1: Add `urgent` to the Issue model + fix all Issue literals

Adding a **non-optional** field forces every `Issue` literal to be updated — the TypeScript build is the test here.

**Files:**
- Modify: `src/lib/types.ts:52-68`
- Modify: `src/lib/seed.ts:30-36`
- Modify: `src/data/supabaseRepository.ts:225-238` (create literal), and `src/components/IssueForm.tsx:340` + `:402` (two literals)

- [ ] **Step 1: Add the field to the interface**

In `src/lib/types.ts`, inside `interface Issue`, after `assigneeId: string | null` (line 67):

```ts
  assigneeId: string | null
  /** Urgent issues sort left within their layer. Default false. */
  urgent: boolean
```

- [ ] **Step 2: Update seed issues**

In `src/lib/seed.ts`, add `urgent: false` to each of the 5 issues (before the closing `}` of each). Two of them illustrate the feature — make `EX-04` urgent:

```ts
export const SEED_ISSUES: Issue[] = [
  { id: 'EX-01', projectId: 'demo', title: 'Adresă email proiect', desc: '', theme: 'email', wave: 1, deps: [], done: true, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-02', projectId: 'demo', title: 'Cont bază de date', desc: '', theme: 'db', wave: 1, deps: ['EX-01'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-03', projectId: 'demo', title: 'Cont server mail', desc: '', theme: 'email', wave: 1, deps: ['EX-01'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-04', projectId: 'demo', title: 'Pagina de înregistrare', desc: '', theme: 'auth', wave: 1, deps: ['EX-02', 'EX-03'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: true },
  { id: 'EX-05', projectId: 'demo', title: 'Administrare utilizatori', desc: '', theme: 'auth', wave: 2, deps: ['EX-04'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
]
```

- [ ] **Step 3: Fix the two IssueForm Issue literals**

`src/components/IssueForm.tsx` line ~340 (inside `cycleAfterSave`):

```ts
      target = { id: targetId, projectId: project.id, title, desc: '', theme, wave, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false }
```

`src/components/IssueForm.tsx` line ~402 (inside `save`, the `snap` fallback push):

```ts
        snap = [...snap, { id: targetId, projectId: project.id, title: title.trim(), desc: desc.trim(), theme, wave, deps: realDeps, done: false, selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId, urgent }]
```

(`urgent` here is the state variable added in Task 6 — for now use `false`; Task 6 will replace it with the state. To keep this task compiling standalone, use `urgent: false` now and Task 6 changes it to `urgent`.)

- [ ] **Step 4: Fix the supabase create literal (Task 4 finishes the rest)**

`src/data/supabaseRepository.ts` line ~237, add to the `issue` object literal:

```ts
        assigneeId: input.assigneeId ?? null,
        urgent: input.urgent ?? false,
```

- [ ] **Step 5: Verify the build fails only where expected, then compiles**

Run: `npx tsc --noEmit`
Expected: after Steps 1-4 (and localRepository create in Task 3 not yet done), the ONLY remaining error is `src/data/localRepository.ts` createIssue missing `urgent`. That's fixed in Task 3. If other files error, add `urgent: false` to those Issue literals too.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/seed.ts src/components/IssueForm.tsx src/data/supabaseRepository.ts
git commit -m "feat: add urgent field to Issue model + seed"
```

---

## Task 2: Pure urgency-ordering helpers (TDD)

**Files:**
- Create: `src/lib/ordering.ts`
- Test: `src/lib/ordering.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/ordering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { orderIdsByUrgency, buildOrderedLayers } from './ordering'
import type { Issue, Layers } from './types'

function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...patch }
}

describe('orderIdsByUrgency', () => {
  it('puts urgent ids first, preserving original order within each group (stable)', () => {
    const byId = {
      a: issue('a'), b: issue('b', { urgent: true }), c: issue('c'), d: issue('d', { urgent: true }),
    }
    expect(orderIdsByUrgency(['a', 'b', 'c', 'd'], byId)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('is a no-op when nothing is urgent', () => {
    const byId = { a: issue('a'), b: issue('b') }
    expect(orderIdsByUrgency(['a', 'b'], byId)).toEqual(['a', 'b'])
  })

  it('tolerates ids missing from byId (treats as non-urgent)', () => {
    const byId = { a: issue('a', { urgent: true }) }
    expect(orderIdsByUrgency(['a', 'ghost'], byId)).toEqual(['a', 'ghost'])
  })
})

describe('buildOrderedLayers', () => {
  const byId = {
    a: issue('a'), b: issue('b', { urgent: true }), c: issue('c', { done: true }),
  }
  const layers: Layers = { 0: ['a', 'b'], 1: ['c'] }

  it('returns groups sorted by layer key, urgent-first within each layer', () => {
    expect(buildOrderedLayers(layers, byId, false)).toEqual([
      { L: 0, ids: ['b', 'a'] },
      { L: 1, ids: ['c'] },
    ])
  })

  it('drops done ids and then empty layers when hideDone is true', () => {
    expect(buildOrderedLayers(layers, byId, true)).toEqual([
      { L: 0, ids: ['b', 'a'] },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ordering.test.ts`
Expected: FAIL — `Failed to resolve import "./ordering"`.

- [ ] **Step 3: Write the implementation**

`src/lib/ordering.ts`:

```ts
// Pure UI-layer ordering. The engine (computeLayers) keeps input order within a
// layer; urgency is applied here so the engine and its fixtures stay untouched.

import type { Issue, Layers } from './types'
import { layerKeys } from './engine'

/** Stable partition: urgent ids first, original order preserved otherwise. */
export function orderIdsByUrgency(ids: string[], byId: Record<string, Issue>): string[] {
  const urgent: string[] = []
  const rest: string[] = []
  for (const id of ids) {
    if (byId[id]?.urgent) urgent.push(id)
    else rest.push(id)
  }
  return [...urgent, ...rest]
}

export interface OrderedLayer {
  L: number
  ids: string[]
}

/**
 * Layer groups sorted by depth, each layer's ids sorted urgent-first. When
 * hideDone is true, done ids are dropped and emptied layers removed.
 */
export function buildOrderedLayers(
  layers: Layers,
  byId: Record<string, Issue>,
  hideDone: boolean,
): OrderedLayer[] {
  return layerKeys(layers)
    .map((L) => {
      let ids = layers[L]
      if (hideDone) ids = ids.filter((id) => !byId[id]?.done)
      return { L, ids: orderIdsByUrgency(ids, byId) }
    })
    .filter((group) => group.ids.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ordering.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ordering.ts src/lib/ordering.test.ts
git commit -m "feat: add pure urgency-ordering helpers"
```

---

## Task 3: localRepository — persist `urgent` (TDD)

**Files:**
- Modify: `src/data/localRepository.ts:22-41` (load migration), `:168-189` (createIssue)
- Test: `src/data/localRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('localRepository', …)` block in `src/data/localRepository.test.ts`:

```ts
  it('createIssue defaults urgent to false; updateIssue toggles it', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    const created = await repo.createIssue({ projectId: 'tst', title: 'Task' })
    expect(created.urgent).toBe(false)

    const updated = await repo.updateIssue(created.id, { urgent: true })
    expect(updated.urgent).toBe(true)

    const reloaded = (await repo.listIssues('tst')).find((i) => i.id === created.id)!
    expect(reloaded.urgent).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/localRepository.test.ts`
Expected: FAIL — `created.urgent` is `undefined` (createIssue literal has no `urgent`), and `npx tsc --noEmit` still flags the missing field.

- [ ] **Step 3: Add `urgent` to createIssue**

`src/data/localRepository.ts`, in `createIssue` (the `issue` literal ~line 172), after `assigneeId`:

```ts
        assigneeId: input.assigneeId ?? null,
        urgent: input.urgent ?? false,
```

- [ ] **Step 4: Add a defensive load migration**

Issues persisted before this change won't have `urgent`. In `src/data/localRepository.ts` `load()`, change the issues line (~line 27) to backfill:

```ts
      return {
        projects: db.projects ?? [],
        waves: db.waves ?? [],
        themes: db.themes ?? [],
        issues: (db.issues ?? []).map((i) => ({ ...i, urgent: i.urgent ?? false })),
        assignees: db.assignees ?? [],
      }
```

- [ ] **Step 5: Add `urgent?` to the NewIssue type**

`src/data/repository.ts`, in `interface NewIssue` after `assigneeId?` (line 24):

```ts
  assigneeId?: string | null
  urgent?: boolean
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/data/localRepository.test.ts && npx tsc --noEmit`
Expected: PASS, and `tsc` clean (no more missing-`urgent` errors anywhere).

- [ ] **Step 7: Commit**

```bash
git add src/data/localRepository.ts src/data/repository.ts src/data/localRepository.test.ts
git commit -m "feat: persist urgent in localRepository + NewIssue"
```

---

## Task 4: supabaseRepository — persist `urgent`

The create literal was done in Task 1 Step 4. This task finishes the row mapping, insert, and update. (No new test — `supabaseRepository.test.ts` mocks the client; extend only if the existing tests assert on the insert/update payload — check first and mirror the `assignee_id` assertions if present.)

**Files:**
- Modify: `src/data/supabaseRepository.ts:8-21` (IssueRow), `:23-38` (rowToIssue), `:239-251` (insert), `:262-272` (update)

- [ ] **Step 1: Add the column to IssueRow**

`src/data/supabaseRepository.ts`, in `interface IssueRow` after `assignee_id` (line 20):

```ts
  assignee_id: string | null
  urgent: boolean
```

- [ ] **Step 2: Map it in rowToIssue**

In `rowToIssue`, after `assigneeId: row.assignee_id ?? null,` (line 36):

```ts
    assigneeId: row.assignee_id ?? null,
    urgent: row.urgent ?? false,
```

- [ ] **Step 3: Include it in the insert**

In `createIssue`, the `db.from('issues').insert({...})` object (~line 250), after `assignee_id`:

```ts
        assignee_id: input.assigneeId ?? null,
        urgent: issue.urgent,
```

- [ ] **Step 4: Handle it in updateIssue**

In `updateIssue`, after the `assigneeId` line (line 272):

```ts
      if ('assigneeId' in patch) row.assignee_id = patch.assigneeId ?? null
      if ('urgent' in patch) row.urgent = patch.urgent ?? false
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — all existing tests (engine, treeTraversal, both repos) green, plus the new ordering + local tests.

- [ ] **Step 6: Commit**

```bash
git add src/data/supabaseRepository.ts
git commit -m "feat: persist urgent in supabaseRepository"
```

---

## Task 5: Supabase DB migration

Adds the physical column so the live backend accepts `urgent`. Local dev works without this (localStorage). Run when deploying against Supabase.

**Files:**
- Create (temporary): `migrate-urgent.mjs` (deleted after running)

- [ ] **Step 1: Write the temporary migration script**

Per CLAUDE.md (pg client, separate params to avoid `@` in password). Create `migrate-urgent.mjs`:

```js
import pg from 'pg'
import { config } from 'dotenv'
config()
const client = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
await client.query('alter table issues add column if not exists urgent boolean not null default false')
const { rows } = await client.query("select column_name from information_schema.columns where table_name = 'issues' and column_name = 'urgent'")
console.log('urgent column present:', rows.length === 1)
await client.end()
```

- [ ] **Step 2: Run it**

Run: `node migrate-urgent.mjs`
Expected: `urgent column present: true`

- [ ] **Step 3: Delete the script**

```bash
rm migrate-urgent.mjs
```

- [ ] **Step 4: Commit (record that the migration ran)**

No code artifact remains, so record it in the plan/commit log:

```bash
git commit --allow-empty -m "chore: add issues.urgent column in Supabase"
```

---

## Task 6: IssueForm — the ⚡ Urgent toggle

**Files:**
- Modify: `src/components/IssueForm.tsx` — state (~line 159), dirty-check (~line 209-223), save payload (`qaPayload` ~line 377), snap literal (~line 402), and the JSX (meta section ~line 496).

- [ ] **Step 1: Add urgent state**

After `const [notes, setNotes] = useState(existing?.notes ?? '')` (line 159):

```ts
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [urgent, setUrgent] = useState(existing?.urgent ?? false)
```

- [ ] **Step 2: Include urgent in the dirty-check**

In the `isDirty` expression, add a term to the `isEdit` branch (after the `notes` comparison, line 221):

```ts
      notes !== (existing?.notes ?? '') ||
      urgent !== (existing?.urgent ?? false)
```

And to the new-issue branch (line 222-223) OR the `||` chain, add `|| urgent`:

```ts
    : title.trim() !== '' || desc.trim() !== '' || deps.length > 0 || blocks.length > 0 ||
      selectors.length > 0 || scenarios.length > 0 || notes.trim() !== '' || urgent
```

- [ ] **Step 3: Include urgent in the save payload**

Change `qaPayload` (line 377) to carry `urgent`:

```ts
      const qaPayload = { selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId, urgent }
```

`qaPayload` is spread into both the `updateIssue` and `createIssue` calls (line 378-380), so this covers create and edit.

- [ ] **Step 4: Use the state in the snap literal**

Change the Task 1 Step 3 fallback from `urgent: false` to the state variable (line ~402):

```ts
        snap = [...snap, { id: targetId, projectId: project.id, title: title.trim(), desc: desc.trim(), theme, wave, deps: realDeps, done: false, selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId, urgent }]
```

- [ ] **Step 5: Add the toggle UI**

In the META section, add a fourth `meta-col` after the assignee column (after line 560, before the closing `</div>` of `.sh-meta-inline-row`):

```tsx
            <div className="meta-vsep" />

            <div className="meta-col meta-col-urgent">
              <span className="meta-row-label">Prioritate</span>
              <div className="pills-row">
                <button
                  tabIndex={-1}
                  type="button"
                  className={`if-meta-pill urgent-pill ${urgent ? 'active' : ''}`}
                  onClick={() => setUrgent((v) => !v)}
                  title={urgent ? 'Scoate urgența' : 'Marchează urgent'}
                >
                  ⚡ Urgent
                </button>
              </div>
            </div>
```

- [ ] **Step 6: Add urgent-pill styling**

In the stylesheet, near the existing `.if-meta-pill` rules, add an active-state accent (use the coral urgency color `#ff6b6b`):

```css
.if-meta-pill.urgent-pill.active {
  background: rgba(255, 107, 107, 0.16);
  border-color: #ff6b6b;
  color: #ff6b6b;
}
```

- [ ] **Step 7: Manual verify**

Run: `npm run dev`
- Open a ticket → toggle ⚡ Urgent → Save enables → save → reopen: still urgent.
- New ticket with only ⚡ toggled → Save enables.
- Typecheck: `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/IssueForm.tsx src/styles.css
git commit -m "feat: urgent toggle in issue form"
```

(`.if-meta-pill` lives in `src/styles.css` — confirmed.)

---

## Task 7: TicketCard — the ⚡ badge

**Files:**
- Modify: `src/components/TicketCard.tsx:67-71` (meta row)

- [ ] **Step 1: Render the badge**

In `TicketCard`, inside `.tk-meta` (after the `tk-theme` span, line 70), add:

```tsx
      <div className="tk-meta">
        {theme && <span className="theme-dot" style={{ background: theme.color }} />}
        <span className="tk-id">{id}</span>
        {theme && <span className="tk-theme">{theme.name}</span>}
        {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
      </div>
```

- [ ] **Step 2: Style the badge**

In the stylesheet near `.tk-meta` rules:

```css
.tk-urgent {
  margin-left: auto;
  font-size: 12px;
  line-height: 1;
  filter: saturate(1.2);
}
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev` — EX-04 (seeded urgent) shows ⚡ on its card.

- [ ] **Step 4: Commit**

```bash
git add src/components/TicketCard.tsx src/styles.css
git commit -m "feat: urgent badge on ticket card"
```

---

## Task 8: Shared hooks — useHideDone + useOrderedLayers

**Files:**
- Create: `src/hooks.ts`

- [ ] **Step 1: Write the hooks**

`src/hooks.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHorizontal } from './store'
import { buildOrderedLayers, type OrderedLayer } from './lib/ordering'

const HIDE_DONE_KEY = 'horizontal:hide-done'

/** localStorage-backed "hide completed" toggle, shared across views. */
export function useHideDone(): [boolean, () => void] {
  const [hideDone, setHideDone] = useState(
    () => localStorage.getItem(HIDE_DONE_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0')
  }, [hideDone])
  const toggle = useCallback(() => setHideDone((h) => !h), [])
  return [hideDone, toggle]
}

/** Layer groups for the active wave, urgent-first, optionally hiding done. */
export function useOrderedLayers(hideDone: boolean): OrderedLayer[] {
  const { layers, byId } = useHorizontal()
  return useMemo(() => buildOrderedLayers(layers, byId, hideDone), [layers, byId, hideDone])
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks.ts
git commit -m "feat: shared useHideDone + useOrderedLayers hooks"
```

---

## Task 9: Extract WaveTabs component

**Files:**
- Create: `src/components/WaveTabs.tsx`
- Modify: `src/components/OrdineView.tsx:193-215` (replace inline wave-tabs)

- [ ] **Step 1: Create WaveTabs**

`src/components/WaveTabs.tsx` — lifts the `.wave-tabs` block verbatim from OrdineView (lines 194-215), reading from the store/UI:

```tsx
import { useHorizontal } from '../store'
import { useUI } from '../ui'

/** The wave selector row (wave buttons + manage gear). Shared by board + list. */
export function WaveTabs({ onWaveChange }: { onWaveChange?: () => void }) {
  const { waves, issues, activeWave, setActiveWave } = useHorizontal()
  const { openWaveManage } = useUI()
  return (
    <div className="wave-tabs">
      {waves.map((w) => {
        const cnt = issues.filter((i) => i.wave === w.number).length
        return (
          <button
            key={w.number}
            className={`wbtn ${w.number === activeWave ? 'on' : ''}`}
            onClick={() => { setActiveWave(w.number); onWaveChange?.() }}
          >
            <span className="wname">{w.name}</span>
            <span className="wsub">
              {w.label ? `${w.label} · ` : ''}
              {cnt}
            </span>
          </button>
        )
      })}
      <button className="wbtn wmanage" aria-label="Gestionează valuri" onClick={openWaveManage}>
        <span className="wname">⚙</span>
        <span className="wsub">valuri</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Use it in OrdineView**

In `src/components/OrdineView.tsx`, replace the inline `<div className="wave-tabs">…</div>` block (lines 194-215) with:

```tsx
        <WaveTabs onWaveChange={exitSelectMode} />
```

Add the import at the top:

```tsx
import { WaveTabs } from './WaveTabs'
```

- [ ] **Step 3: Manual verify + typecheck**

Run: `npx tsc --noEmit` (clean) and `npm run dev` — wave switching + ⚙ still work exactly as before on the board.

- [ ] **Step 4: Commit**

```bash
git add src/components/WaveTabs.tsx src/components/OrdineView.tsx
git commit -m "refactor: extract WaveTabs from OrdineView"
```

---

## Task 10: OrdineView — urgency ordering via shared hooks

Replace the two inline layer computations (`flatLayers` and the render-time `visibleIds`) with `useOrderedLayers`, and swap the local `hideDone` state for `useHideDone`. This makes the board sort urgent-first and removes duplicated logic.

**Files:**
- Modify: `src/components/OrdineView.tsx` — imports, state (27-36), `flatLayers` (87-95), render loop (262-303).

- [ ] **Step 1: Swap hideDone state + drop the persistence effect**

Add imports:

```tsx
import { useHideDone, useOrderedLayers } from '../hooks'
```

Replace the `hideDone` `useState` (lines 27-29) and its `useEffect` (lines 34-36) with:

```tsx
  const [hideDone, toggleHideDone] = useHideDone()
```

- [ ] **Step 2: Replace flatLayers with the hook**

Delete the `flatLayers` `useMemo` (lines 87-95) and replace with:

```tsx
  const orderedLayers = useOrderedLayers(hideDone)
  const flatLayers = useMemo(() => orderedLayers.map((g) => g.ids), [orderedLayers])
```

(`flatLayers` — an array of id arrays — is still consumed by the vim keyboard nav at lines 130-166, so keep that shape.)

- [ ] **Step 3: Update the hide-done toggle button**

At line ~230, change `onClick={() => setHideDone((h) => !h)}` to:

```tsx
            onClick={toggleHideDone}
```

- [ ] **Step 4: Rewrite the render loop to use ordered groups**

Replace the `keys.map((L, i) => { … })` block (lines 262-303, the `keys.length === 0 ? … : (…)` body) with a map over `orderedLayers`. Note: `ready`/color index must come from the group's position `i`, and the layer number label from `g.L`:

```tsx
          {orderedLayers.length === 0 ? (
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
                      selectMode={!treeViewActive && selectMode}
                      isSelected={selectedIds.has(id)}
                      onToggleSelect={toggleSelect}
                      treeMode={treeViewActive}
                      highlighted={highlightedIds ? highlightedIds.has(id) : undefined}
                      onTreeSelect={handleTreeSelect}
                      focused={focusedId === id}
                    />
                  ))}
                </div>
              )
            })
          )}
```

Note: the outer guard was `keys.length === 0`. With `hideDone` filtering now inside the hook, use `orderedLayers.length === 0` for the "empty" message. The `keys` variable (line 22) and its `layerKeys` import may become unused — remove them if `npx tsc --noEmit` / eslint flags them (the count badge previously used `ids.length`; it now uses `g.ids.length`).

- [ ] **Step 5: Typecheck + lint + manual verify**

Run: `npx tsc --noEmit && npm run lint` (if a lint script exists — check `package.json`; skip if absent).
Then `npm run dev`:
- EX-04 (urgent) appears **first (leftmost)** in its layer.
- Hide-completed toggle still works and persists across refresh.
- Vim nav (h/j/k/l) still moves across the reordered cards.

- [ ] **Step 6: Commit**

```bash
git add src/components/OrdineView.tsx
git commit -m "feat: sort board by urgency + reuse shared hooks"
```

---

## Task 11: ListView component

**Files:**
- Create: `src/components/ListView.tsx`

- [ ] **Step 1: Write ListView**

`src/components/ListView.tsx` — reuses `WaveTabs`, `useHideDone`, `useOrderedLayers`, and `stateOf`/`themeOf`/`toggleDone` from the store. Compact rows, grouped by layer, urgent-first:

```tsx
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { WaveTabs } from './WaveTabs'
import { useHideDone, useOrderedLayers } from '../hooks'

export function ListView() {
  const { waves, byId, stateOf, themeOf, toggleDone } = useHorizontal()
  const { openEditIssue } = useUI()
  const [hideDone, toggleHideDone] = useHideDone()
  const orderedLayers = useOrderedLayers(hideDone)

  return (
    <div className="panel">
      <div className="wave-sel">
        <WaveTabs />
        <div className="wave-actions">
          <button
            className={`wave-action-btn ${hideDone ? 'active' : ''}`}
            onClick={toggleHideDone}
            title={hideDone ? 'Arată tichetele completate' : 'Ascunde tichetele completate'}
          >
            <span>{hideDone ? 'Arată' : 'Ascunde'}</span>
          </button>
        </div>
      </div>

      {waves.length === 0 ? (
        <p className="empty">Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).</p>
      ) : orderedLayers.length === 0 ? (
        <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
      ) : (
        orderedLayers.map((g, i) => (
          <div key={g.L} className="list-group">
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
              return (
                <div key={id} className={`list-row ${state}`} onClick={() => openEditIssue(id)}>
                  <span
                    className="list-check"
                    role="checkbox"
                    aria-checked={it.done}
                    aria-label={it.done ? 'Marchează nefăcut' : 'Marchează gata'}
                    onClick={(e) => { e.stopPropagation(); void toggleDone(id) }}
                  >
                    {it.done ? '✓' : ''}
                  </span>
                  {theme && <span className="theme-dot" style={{ background: theme.color }} />}
                  <span className="list-id">{id}</span>
                  <span className="list-title">{it.title}</span>
                  {it.urgent && <span className="tk-urgent" title="Urgent">⚡</span>}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add list styles**

In the stylesheet, add compact-row styling that reuses the dark theme tokens (mirror `.tk` state colors; keep rows tappable ≥ 40px). Place near the `.layer` / `.tk` rules:

```css
.list-group { margin-bottom: 14px; }
.list-group-head {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px; font-size: 12px; color: var(--muted, #8a93a6);
}
.list-group-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 6px;
  background: var(--line-soft, #2a2f3a); font-size: 11px;
}
.list-group-count { margin-left: auto; opacity: 0.7; }
.list-row {
  display: flex; align-items: center; gap: 10px;
  min-height: 40px; padding: 8px 10px;
  border: 1px solid var(--line-soft, #2a2f3a); border-radius: 8px;
  margin-bottom: 6px; cursor: pointer; background: var(--panel, #12151c);
}
.list-row:hover { border-color: var(--line, #3a4150); }
.list-row.done { opacity: 0.55; }
.list-row.blocked { opacity: 0.8; }
.list-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 5px;
  border: 1px solid var(--line, #3a4150); font-size: 11px; flex: 0 0 auto;
}
.list-id { font-size: 11px; color: var(--muted, #8a93a6); flex: 0 0 auto; }
.list-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row .tk-urgent { margin-left: auto; }
```

(Adjust var names/fallbacks to match the project's tokens — check the `:root` block in the stylesheet and reuse existing variables rather than the fallbacks above.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ListView.tsx src/styles.css
git commit -m "feat: add ListView compact list of tickets"
```

---

## Task 12: Wire the List tab

**Files:**
- Modify: `src/components/ProjectDetail.tsx:1-27`
- Modify: `src/App.tsx:93-95` (help table), `:206-208` (keyboard shortcuts)

- [ ] **Step 1: Add the tab in ProjectDetail**

`src/components/ProjectDetail.tsx` — full file:

```tsx
import { OrdineView } from './OrdineView'
import { ListView } from './ListView'
import { GraphView } from './GraphView'
import { ThemesView } from './ThemesView'

export type Tab = 'ordine' | 'list' | 'graf' | 'teme'

const TABS: { key: Tab; label: string }[] = [
  { key: 'ordine', label: 'Ordine' },
  { key: 'list', label: 'List' },
  { key: 'graf', label: 'Graf' },
  { key: 'teme', label: 'Teme' },
]

export function ProjectDetail({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="view">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ordine' && <OrdineView />}
      {tab === 'list' && <ListView />}
      {tab === 'graf' && <GraphView />}
      {tab === 'teme' && <ThemesView />}
    </div>
  )
}
```

- [ ] **Step 2: Update keyboard shortcuts in App.tsx**

Help table (lines 93-95) — replace with 4 entries:

```tsx
  { key: '1', action: 'Tab → Ordine' },
  { key: '2', action: 'Tab → List' },
  { key: '3', action: 'Tab → Graf' },
  { key: '4', action: 'Tab → Teme' },
```

Handler (lines 206-208) — replace with:

```tsx
      else if (e.key === '1' && project) { e.preventDefault(); setTab('ordine') }
      else if (e.key === '2' && project) { e.preventDefault(); setTab('list') }
      else if (e.key === '3' && project) { e.preventDefault(); setTab('graf') }
      else if (e.key === '4' && project) { e.preventDefault(); setTab('teme') }
```

- [ ] **Step 3: Typecheck + manual verify**

Run: `npx tsc --noEmit && npm run dev`
- `List` tab appears between Ordine and Graf.
- It shows the same tickets as the board for the active wave, as compact rows, urgent-first, EX-04 with ⚡.
- Clicking a row opens the issue sheet; the checkbox toggles done.
- Keys 1/2/3/4 switch tabs.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectDetail.tsx src/App.tsx
git commit -m "feat: add List tab + keyboard shortcut"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — engine (unchanged fixtures), treeTraversal, both repos, ordering.

- [ ] **Step 2: Full typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean, build succeeds.

- [ ] **Step 3: End-to-end manual pass** (`npm run dev`)

- Toggle urgent on a ticket → it jumps leftmost in its board layer and top of its layer group in the list.
- Refresh → urgency persists (DB/localStorage) and hide-done persists.
- Board and List show the same set of tickets for the active wave.
- Cross-wave dependency behavior on the board is unchanged.

- [ ] **Step 4: Confirm branch state**

Run: `git log --oneline c93cdd4..HEAD`
Expected: the sequence of feat/refactor/chore commits from this plan, nothing else.

---

## Self-Review (author)

**Spec coverage:**
- §1 data model → Task 1. §2 persistence (Supabase/local/NewIssue) → Tasks 3, 4, 5. §3 ordering → Task 2 (+ consumed in 10, 11). §4 shared hooks → Task 8. §5 WaveTabs → Task 9. §6 IssueForm toggle → Task 6. §7 TicketCard badge → Task 7. §8 ListView + tab → Tasks 11, 12. Engine untouched → confirmed (no task edits `engine.ts`; ordering lives in `ordering.ts`). All covered.
- Extra beyond spec: App.tsx keyboard-shortcut remap (1-4) — required because adding a tab breaks the existing 1/2/3 mapping; in scope.

**Type consistency:** `Issue.urgent` (non-optional boolean) consistent across types, seed, both repos, NewIssue (optional input), IssueForm state, hooks. `OrderedLayer { L, ids }` used identically in `ordering.ts`, `useOrderedLayers`, OrdineView, ListView. `orderIdsByUrgency` / `buildOrderedLayers` names match between definition (Task 2) and use (Tasks 8, 10, 11).

**Placeholder scan:** none — every code step has concrete content. Stylesheet path is flagged as "find with grep" rather than guessed, since the exact CSS file wasn't confirmed.
