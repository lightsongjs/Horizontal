# Save-without-close + save shortcuts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user save a card and stay in it (Save button + Ctrl/Cmd+S), keep Ctrl/Cmd+Enter as save-and-close, and stop Ctrl+S from opening the browser Save-As dialog.

**Architecture:** Parameterize `IssueForm`'s `save()` with `{ close }`. On stay-open, reconcile any inline draft dependency/block tickets to their real ids (so their cards become clickable and the form goes non-dirty); for a brand-new card, adopt the created id via `openEditIssue(targetId)`, which remounts the form in edit mode (SheetHost keys it `key={sheet.issueId ?? '__new__'}`) — preventing a duplicate on the next save. Triggers: Save button + Ctrl/Cmd+S → `save({ close: false })`; Ctrl/Cmd+Enter → `save({ close: true })`.

**Tech Stack:** React + TypeScript. Vitest covers engine + repositories only — there is **no component-test harness**, so `IssueForm` changes are verified by typecheck (`npx tsc -b --noEmit`) + manual testing; the existing suite (56 tests) must stay green.

**Branch:** `feat/save-without-close` (spec commit `59fd973`; base `master`).

**Process rules (every task):**
- Typecheck with `npx tsc -b --noEmit` (NOT plain `tsc --noEmit` — the root tsconfig has `files: []`).
- `git add` ONLY the files the task changes — NEVER `git add -A`/`.` (there are pre-existing unrelated modified/untracked files: CLAUDE.md, public/icon.svg, src/components/Sidebar.tsx, scripts/, ticket-kit/ — leave them untouched).
- Never use `--no-verify`.

---

## File Structure

**Modify:**
- `src/components/IssueForm.tsx` — parameterize `save({ close })`, stay-open reconcile + new-card adopt, wire the Save button / Ctrl+Enter / Ctrl+S triggers, add `openEditIssue` to the `useUI()` destructure, update the button tooltip. (Task 1)
- `src/App.tsx` — add card-editor save shortcuts to the SHORTCUTS help array. (Task 2)

No new files. No test files (no component harness).

---

## Task 1: Parameterize `save({ close })` + wire triggers

**Files:**
- Modify: `src/components/IssueForm.tsx` — `useUI()` destructure (line ~139), `save` signature (line ~358) and its ending (line ~422), the Ctrl+Enter keyboard effect (lines ~236-240), and the header Save button (lines ~480-486).

- [ ] **Step 1: Add `openEditIssue` to the `useUI()` destructure**

Line ~139 is currently:
```tsx
  const { closeSheet, setCloseGuard, pushSheet } = useUI()
```
Change to:
```tsx
  const { closeSheet, setCloseGuard, pushSheet, openEditIssue } = useUI()
```
(`openEditIssue(id)` exists on the UI context — it sets the sheet stack to a single `{ kind: 'issue-form', issueId: id }`.)

- [ ] **Step 2: Give `save` a `{ close }` parameter**

Line ~358 is currently:
```tsx
  const save = async () => {
```
Change to:
```tsx
  const save = async ({ close }: { close: boolean }) => {
```

- [ ] **Step 3: Replace the close at the end of `save` with the close/stay-open branch**

The `save` body ends (line ~422) with:
```tsx
      setCloseGuard(null); closeSheet()
    } finally { setSaving(false) }
```
Replace ONLY the `setCloseGuard(null); closeSheet()` line with:
```tsx
      setCloseGuard(null)
      if (close) {
        closeSheet()
      } else {
        // Stay open: reconcile inline drafts to their real ids so their cards
        // become clickable and the form is no longer dirty.
        setDeps(realDeps)
        setBlocks(realBlocks)
        setDraftDeps([])
        setDraftBlocks([])
        // A brand-new card must adopt the id it was just created under, so a
        // second save updates it instead of creating a duplicate. Switching the
        // sheet's issueId remounts the form in edit mode (SheetHost keys it by
        // issueId). Existing cards already have the right id — leave the sheet
        // (and any navigation stack) as-is.
        if (!isEdit) openEditIssue(targetId)
      }
    } finally { setSaving(false) }
```
`realDeps`, `realBlocks`, `targetId`, `isEdit` are all already in scope at this point (computed earlier in `save`, and `isEdit` at component top). Do NOT change any of the save pipeline above this line.

- [ ] **Step 4: Update the Ctrl+Enter effect to also handle Ctrl/Cmd+S**

Lines ~236-240 currently:
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save()
    }
    window.addEventListener('keydown', onKey)
```
Replace the `onKey` body so Enter closes and S stays open (and S suppresses the browser Save-As via `preventDefault`):
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'Enter') { e.preventDefault(); void save({ close: true }) }
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); void save({ close: false }) }
      }
    }
    window.addEventListener('keydown', onKey)
```
Leave the rest of the effect (the `addEventListener` / cleanup `return`) unchanged. Note `save` already no-ops when `!title.trim() || saving`, so no extra guard is needed.

- [ ] **Step 5: Update the Save button to save without closing**

Line ~483, the header button `onClick={save}`, change to:
```tsx
          onClick={() => void save({ close: false })}
```
And update its `title` (line ~485) from:
```tsx
          title={saving ? 'Se salvează…' : 'Salvează'}
```
to:
```tsx
          title={saving ? 'Se salvează…' : 'Salvează (Ctrl+S) · Ctrl+Enter salvează și închide'}
```

- [ ] **Step 6: Verify there are no other `save(` call sites left unparameterized**

Run: `grep -n "save(" src/components/IssueForm.tsx`
Expected: the only calls are the two in the keyboard effect (`save({ close: true })`, `save({ close: false })`) and the button (`save({ close: false })`), plus the definition `const save = async ({ close }...`. If any bare `save()` remains, fix it (`save({ close: true })` matches the old close-on-save behavior).

- [ ] **Step 7: Typecheck + existing suite**

Run: `npx tsc -b --noEmit`
Expected: exit 0 (clean).
Run: `npm test`
Expected: `Tests 56 passed (56)`.

- [ ] **Step 8: Commit**

```bash
git add src/components/IssueForm.tsx
git commit -m "feat: save without closing the card (button + Ctrl+S)"
```

---

## Task 2: Add save shortcuts to the help table

**Files:**
- Modify: `src/App.tsx` — the SHORTCUTS array (around lines 92-99).

- [ ] **Step 1: Read the SHORTCUTS array**

Run: `grep -n "action:" src/App.tsx`
Confirm the array items use the shape `{ key: '<k>', action: '<text>' }`. The current tail includes `{ key: '?', action: 'Afișează shortcuts' }`.

- [ ] **Step 2: Add two card-editor entries**

Immediately after the `{ key: 'T', action: 'Tree View (în Cards)' }` line, add:
```tsx
  { key: 'Ctrl+S', action: 'Salvează cardul (rămâne deschis)' },
  { key: 'Ctrl+↵', action: 'Salvează și închide cardul' },
```
(Match the existing indentation and the `{ key, action }` shape exactly. Keep every other entry unchanged.)

- [ ] **Step 3: Typecheck + suite**

Run: `npx tsc -b --noEmit` (exit 0) and `npm test` (56 pass).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "docs: list card save shortcuts in the shortcuts overlay"
```

---

## Task 3: Final verification

- [ ] **Step 1: Full gates**

Run: `npx tsc -b --noEmit` (exit 0), `npm test` (56 passed), `npm run build` (succeeds).

- [ ] **Step 2: Manual verification** (`npm run dev`)

1. Open an existing card, change the title → click the Save (✓) button → the sheet **stays open**, the Save button loses its "dirty" state, and reopening the card later shows the change persisted.
2. In an open card, press **Ctrl+S** → same as the Save button, and the browser's Save-As dialog does **NOT** appear.
3. Press **Ctrl+Enter** → the card saves **and closes**.
4. Create a **new** card, add a ticket in the "Permite" zone (a draft), press **Ctrl+S** → the sheet stays open on the just-created card, the Permite item is now a **real, clickable** card, and pressing Save again does **not** create a duplicate (check the board/list — only one new card + one Permite ticket).
5. Press **Escape** → closes (with the unsaved-changes prompt only when there are actually unsaved edits).

- [ ] **Step 3: Branch state**

Run: `git log --oneline master..HEAD` — expect the spec commit plus the two feature commits from this plan. `git status --short` — only the pre-existing unrelated files should be dirty.

---

## Self-Review (author)

**Spec coverage:** Behavior table → Task 1 (button + Ctrl+S stay-open, Ctrl+Enter close) & Task 1 Step 4 (`preventDefault` suppresses Save-As). "Stay open" reconcile + new-card adopt → Task 1 Step 3. New-vs-existing distinction (only new calls `openEditIssue`) → Task 1 Step 3. Shortcuts table → Task 2. Non-goals respected (save pipeline untouched; no save-and-new; no focus jump; no persisted setting). Testing → Task 3.

**Placeholder scan:** none — every step has concrete code and exact commands.

**Type/name consistency:** `save({ close }: { close: boolean })` defined in Task 1 Step 2; every call site (`save({ close: true })` / `save({ close: false })`) matches. `openEditIssue` added to the destructure (Step 1) before use (Step 3). `realDeps`/`realBlocks`/`targetId`/`isEdit` are pre-existing in-scope identifiers, not newly invented.
