# Save-without-close + save shortcuts — design spec

Date: 2026-07-10
Base: `master` (feature branch: `feat/save-without-close`)

## Goal

When editing/creating a card, let the user **save and stay in the card** so they
can immediately grab the tickets they just added in the "Permite" (blocks) zone
and start working on them. Split the two save intents onto distinct triggers,
and stop Ctrl+S from opening the browser's Save-As dialog.

## Behavior

| Trigger | Action |
|---|---|
| **Save button** (header ✓) | Save, **stay open** |
| **Ctrl/Cmd + S** | Save, **stay open** (browser Save-As suppressed) |
| **Ctrl/Cmd + Enter** | Save **and close** |
| **Escape** | Close (existing behavior; unsaved-changes guard still applies) |

"Stay open" means: after saving, the card remains open, is no longer marked
dirty, and any draft dependency/block tickets the user created inline are now
**real, clickable cards** (so they can be opened and worked on).

## The two save intents

Today `save()` always ends with `setCloseGuard(null); closeSheet()`. We
parameterize it:

```
save({ close }: { close: boolean })
```

- The existing save pipeline (draft creation, dep/block wiring, wave cascade,
  optimistic snapshot) is **unchanged**. It already computes `targetId`,
  `realDeps`, `realBlocks`, `draftDepMap`, `draftBlockMap`.
- **`close: true`** → `setCloseGuard(null); closeSheet()` (exactly today's ending).
- **`close: false`** (stay open):
  1. Reconcile drafts to real ids so their cards become clickable and the form
     is no longer dirty:
     `setDeps(realDeps); setBlocks(realBlocks); setDraftDeps([]); setDraftBlocks([])`.
  2. `setCloseGuard(null)`.
  3. **If this was a NEW card** (`!isEdit`): call `openEditIssue(targetId)`. Because
     `SheetHost` keys the form `key={sheet.issueId ?? '__new__'}`, switching the id
     from `'__new__'` to `targetId` **remounts** the form in clean edit mode on
     the created card. This is what prevents a second save from creating a
     duplicate, and makes the Permite cards render as real/clickable.
  4. **If this was an EXISTING card**: do nothing further — the in-place
     reconcile in step 1 already refreshes the view, identity is already correct,
     and the sheet navigation stack (if any) is preserved (so we deliberately do
     NOT call `openEditIssue` here).

### Why new vs existing differ

`openEditIssue` replaces the whole sheet stack with a single edit sheet. For a
NEW card we need exactly that (adopt the created id, remount). For an EXISTING
card the id already matches, a remount is unnecessary, and collapsing the stack
would break "← Înapoi" if the card was opened from another sheet. So existing
cards stay put and only reconcile drafts in place.

## Triggers wiring (`src/components/IssueForm.tsx`)

- **Header save button** (`.sh-save`, currently `onClick={save}`) →
  `onClick={() => save({ close: false })}`. Update its `title` to note
  "Salvează (Ctrl+S) · Ctrl+Enter salvează și închide".
- **Keyboard effect** (currently the `Ctrl+Enter → save()` listener): handle both
  - `(meta||ctrl) && key === 'Enter'` → `save({ close: true })`
  - `(meta||ctrl) && key.toLowerCase() === 's'` → `e.preventDefault(); save({ close: false })`
  Keep the existing guard (`save()` already no-ops when `!title.trim() || saving`).
  `preventDefault()` on Ctrl/Cmd+S is what suppresses the browser Save-As dialog.

## Shortcuts help table (`src/App.tsx`)

Add entries to the shortcuts overlay so the scheme is discoverable. Since these
are card-editor shortcuts (not global), label them accordingly, e.g.:
- `Ctrl+S` — "Salvează cardul (rămâne deschis)"
- `Ctrl+Enter` — "Salvează și închide cardul"

(Match the existing `{ key, action }` shape of the SHORTCUTS array.)

## Non-goals (YAGNI)

- No change to the save pipeline's dep/block/cascade logic.
- No "save and new" / form-reset flow.
- No auto-focus jump to the first Permite ticket after save.
- No new persisted setting.

## Testing

- **No component-test harness** exists (vitest covers engine + repos only), so:
  - Typecheck (`npx tsc -b --noEmit`) must stay clean; full suite stays green.
  - Manual verification (dev server):
    1. Edit existing card → click Save → stays open, not dirty, changes persisted (reopen to confirm).
    2. Ctrl+S in the card → same as Save button; browser Save-As does NOT appear.
    3. Ctrl+Enter → saves and closes.
    4. New card + add a "Permite" draft ticket → Ctrl+S → stays open on the created card; the Permite item is now a real, clickable card; saving again does NOT create a duplicate.
    5. Escape still closes (with unsaved-changes prompt when dirty).

## Build order

1. Parameterize `save({ close })` + the stay-open reconcile/adopt logic.
2. Wire the button, Ctrl+Enter, and Ctrl+S triggers.
3. Add the shortcuts-table entries.
4. Typecheck + manual verification.
