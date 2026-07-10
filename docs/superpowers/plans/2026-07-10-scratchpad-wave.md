# Scratchpad Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic, undeletable "Scratchpad" wave (number 0) at the front of every project, for setup/reference notes.

**Architecture:** Scratchpad is a *normal* wave with `number: 0`, created automatically at project creation and positioned first. No new entity, no special behavior. Two guardrails: the repository refuses to delete wave 0, and the wave-tab row shows an emoji per wave. Existing projects get a Scratchpad via a one-off backfill script.

**Tech Stack:** TypeScript, React, Vitest, Supabase (`@supabase/supabase-js`), local-storage repository for offline/dev.

**Spec:** `docs/superpowers/specs/2026-07-10-scratchpad-wave-design.md`

---

## File Structure

- `src/data/localRepository.ts` — `createProject` creates Scratchpad + Val 1; `deleteWave` guards number 0.
- `src/data/localRepository.test.ts` — update 2 existing tests, add 2 new.
- `src/data/supabaseRepository.ts` — `createProject` inserts Scratchpad + Val 1; `deleteWave` guards number 0.
- `src/data/supabaseRepository.test.ts` — update 1 existing test, add 2 new.
- `src/components/WaveTabs.tsx` — emoji per wave (📝 for 0, 🌊 otherwise).
- `src/components/WaveManager.tsx` — hide delete button for wave 0.
- `scripts/backfill-scratchpad.mjs` — one-off backfill for existing projects.

**Note on wave numbering after this change:** a fresh project has waves `[{number:0,position:0}, {number:1,position:1}]`. `createWave` computes `number = max(number)+1` and `position = max(position)+1`, so the next wave becomes `{number:2, position:2}`. Existing tests that assumed `{number:2, position:1}` must be updated.

---

## Task 1: localRepository — create Scratchpad + guard delete

**Files:**
- Modify: `src/data/localRepository.ts:69-85` (createProject), `:133-137` (deleteWave)
- Test: `src/data/localRepository.test.ts`

- [ ] **Step 1: Update the two existing tests that assume a single default wave**

In `src/data/localRepository.test.ts`, replace the test at lines 32-39:

```ts
  it('createProject adds the project with a Scratchpad + Val 1 wave', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'Test', description: '', prefix: 'TST' })
    expect(p.id).toBe('tst')
    expect(p.currentWave).toBe(1)
    expect(await repo.listWaves('tst')).toEqual([
      { projectId: 'tst', number: 0, name: 'Scratchpad', label: '', position: 0 },
      { projectId: 'tst', number: 1, name: 'Val 1', label: 'MVP', position: 1 },
    ])
  })
```

In the same file, in the "wave CRUD" test, change the `w2` expectation so position accounts for the two default waves:

```ts
    const w2 = await repo.createWave('tst', 'Val 2', 'Next')
    expect(w2).toMatchObject({ number: 2, position: 2, name: 'Val 2', label: 'Next' })
```

- [ ] **Step 2: Add a new test asserting Scratchpad cannot be deleted**

Add this test inside the `describe('localRepository', ...)` block:

```ts
  it('deleteWave refuses to delete the Scratchpad (wave 0)', async () => {
    const repo = createLocalRepository()
    await repo.createProject({ name: 'T', description: '', prefix: 'TST' })
    await expect(repo.deleteWave('tst', 0)).rejects.toThrow(/scratchpad/i)
    expect((await repo.listWaves('tst')).some((w) => w.number === 0)).toBe(true)
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- src/data/localRepository.test.ts`
Expected: FAIL — createProject returns one wave (not two); deleteWave(0) resolves instead of rejecting.

- [ ] **Step 4: Implement createProject (two waves)**

In `src/data/localRepository.ts`, replace the single `db.waves.push(...)` line (line 82) with:

```ts
      db.waves.push({ projectId: id, number: 0, name: 'Scratchpad', label: '', position: 0 })
      db.waves.push({ projectId: id, number: 1, name: 'Val 1', label: 'MVP', position: 1 })
```

- [ ] **Step 5: Implement deleteWave guard**

In `src/data/localRepository.ts`, replace the `deleteWave` body (lines 133-137) with:

```ts
    async deleteWave(projectId, number) {
      if (number === 0) throw new Error('The Scratchpad wave cannot be deleted')
      const db = load()
      db.waves = db.waves.filter((w) => !(w.projectId === projectId && w.number === number))
      save(db)
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- src/data/localRepository.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 7: Commit**

```bash
git add src/data/localRepository.ts src/data/localRepository.test.ts
git commit -m "feat: seed Scratchpad wave + block its deletion (local repo)"
```

---

## Task 2: supabaseRepository — create Scratchpad + guard delete

**Files:**
- Modify: `src/data/supabaseRepository.ts:78-103` (createProject), `:160-163` (deleteWave)
- Test: `src/data/supabaseRepository.test.ts`

- [ ] **Step 1: Update the existing createProject test (lines 113-121)**

Replace it with:

```ts
  it('createProject inserts the project with a Scratchpad + Val 1 wave', async () => {
    const repo = createSupabaseRepository(fakeDb as unknown as SupabaseClient)
    const p = await repo.createProject({ name: 'Turism', description: 'd', prefix: 'TUR' })
    expect(p.id).toBe('tur')
    expect(fakeDb.tables.projects[0]).toMatchObject({ id: 'tur', prefix: 'TUR', current_wave: 1 })
    expect(fakeDb.tables.waves).toEqual([
      { project_id: 'tur', number: 0, name: 'Scratchpad', label: '', position: 0 },
      { project_id: 'tur', number: 1, name: 'Val 1', label: 'MVP', position: 1 },
    ])
  })
```

> If the top of the existing test constructs the repo differently (e.g. a helper), keep that construction and only change the assertions on `fakeDb.tables.waves` and add the `current_wave` check. Match the file's existing import names for `createSupabaseRepository` / `SupabaseClient`.

- [ ] **Step 2: Add a test that deleteWave rejects wave 0**

Add inside the same `describe` block:

```ts
  it('deleteWave refuses to delete the Scratchpad (wave 0)', async () => {
    const repo = createSupabaseRepository(fakeDb as unknown as SupabaseClient)
    fakeDb.tables.projects.push({ id: 'p', prefix: 'P', current_wave: 1, name: 'x', description: '', accent: '#fff' })
    fakeDb.tables.waves.push({ project_id: 'p', number: 0, name: 'Scratchpad', label: '', position: 0 })
    await expect(repo.deleteWave('p', 0)).rejects.toThrow(/scratchpad/i)
    expect(fakeDb.tables.waves.some((w) => w.number === 0)).toBe(true)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- src/data/supabaseRepository.test.ts`
Expected: FAIL — only one wave inserted; deleteWave(0) resolves.

- [ ] **Step 4: Implement createProject (insert both waves)**

In `src/data/supabaseRepository.ts`, replace the single-wave insert block (lines 98-101) with:

```ts
      const { error: wErr } = await db
        .from('waves')
        .insert([
          { project_id: project.id, number: 0, name: 'Scratchpad', label: '', position: 0 },
          { project_id: project.id, number: 1, name: 'Val 1', label: 'MVP', position: 1 },
        ])
      if (wErr) throw wErr
```

- [ ] **Step 5: Implement deleteWave guard**

Replace the `deleteWave` body (lines 160-163) with:

```ts
    async deleteWave(projectId, number) {
      if (number === 0) throw new Error('The Scratchpad wave cannot be deleted')
      const { error } = await db.from('waves').delete().eq('project_id', projectId).eq('number', number)
      if (error) throw error
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- src/data/supabaseRepository.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/supabaseRepository.ts src/data/supabaseRepository.test.ts
git commit -m "feat: seed Scratchpad wave + block its deletion (supabase repo)"
```

---

## Task 3: WaveTabs — emoji per wave

**Files:**
- Modify: `src/components/WaveTabs.tsx:10-25`

No component test infra exists in this repo (tests cover lib/data only), so this task is verified manually.

- [ ] **Step 1: Add the emoji to each wave button**

In `src/components/WaveTabs.tsx`, replace the `<span className="wname">{w.name}</span>` line (line 18) with:

```tsx
            <span className="wname">
              {w.number === 0 ? '📝' : '🌊'} {w.name}
            </span>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open a project. Expected: the first tab reads "📝 Scratchpad", every other wave reads "🌊 Val N". The ⚙ manage button is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/WaveTabs.tsx
git commit -m "feat: show emoji per wave tab (📝 Scratchpad, 🌊 waves)"
```

---

## Task 4: WaveManager — hide delete for Scratchpad

**Files:**
- Modify: `src/components/WaveManager.tsx:67-74`

Verified manually (no component test infra). The repository guard from Task 1/2 is the real safety net; this just removes the misleading button.

- [ ] **Step 1: Conditionally render the delete button**

In `src/components/WaveManager.tsx`, replace the delete `<button>` block (lines 67-74) with:

```tsx
            {w.number !== 0 && (
              <button
                className="wave-del"
                aria-label="Șterge val"
                title={count(w.number) > 0 ? `${count(w.number)} tichete în acest val` : 'Șterge'}
                onClick={() => onDelete(w.number)}
              >
                {confirmDel === w.number ? 'Sigur?' : '🗑'}
              </button>
            )}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open the ⚙ wave manager. Expected: the Scratchpad row shows name + label inputs but NO 🗑 button; every other wave still has its 🗑.

- [ ] **Step 4: Commit**

```bash
git add src/components/WaveManager.tsx
git commit -m "feat: hide delete button for the Scratchpad wave"
```

---

## Task 5: Backfill script for existing projects

**Files:**
- Create: `scripts/backfill-scratchpad.mjs`

Adds a Scratchpad (`number: 0, position: -1`) to every existing project that lacks one. Uses `position: -1` so it sorts first without renumbering existing waves. Idempotent: skips projects that already have a wave 0. Uses the admin pattern from `CLAUDE.md` (supabase-js from `node_modules` is accepted as a server environment; the secret key would be rejected from curl/PowerShell).

- [ ] **Step 1: Write the script**

```js
// scripts/backfill-scratchpad.mjs
// One-off: add a Scratchpad wave (number 0) to every project that lacks one.
// Run once: `node scripts/backfill-scratchpad.mjs`. Safe to re-run (idempotent).
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: projects, error: pErr } = await supabase.from('projects').select('id')
if (pErr) throw pErr

const { data: existingScratch, error: wErr } = await supabase
  .from('waves')
  .select('project_id')
  .eq('number', 0)
if (wErr) throw wErr

const haveScratch = new Set((existingScratch ?? []).map((w) => w.project_id))
const toInsert = (projects ?? [])
  .filter((p) => !haveScratch.has(p.id))
  .map((p) => ({ project_id: p.id, number: 0, name: 'Scratchpad', label: '', position: -1 }))

if (toInsert.length === 0) {
  console.log('All projects already have a Scratchpad. Nothing to do.')
} else {
  const { error: insErr } = await supabase.from('waves').insert(toInsert)
  if (insErr) throw insErr
  console.log(`Inserted Scratchpad into ${toInsert.length} project(s):`, toInsert.map((w) => w.project_id).join(', '))
}
```

- [ ] **Step 2: Run the backfill**

Run: `node scripts/backfill-scratchpad.mjs`
Expected: prints either "All projects already have a Scratchpad." or "Inserted Scratchpad into N project(s): ...".

- [ ] **Step 3: Verify in the app**

Run: `npm run dev`, open an existing (pre-change) project. Expected: "📝 Scratchpad" now appears as the first tab.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-scratchpad.mjs
git commit -m "chore: add one-off Scratchpad backfill script for existing projects"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

---

## Self-review notes (author)

- **Spec coverage:** auto-create Scratchpad (Tasks 1,2) · opens on Val 1 / `currentWave:1` (unchanged + asserted in Task 1 Step 1) · undeletable (repo guard Tasks 1,2 + UI hide Task 4) · emoji tabs (Task 3) · idempotent backfill with `position:-1` (Task 5). All covered.
- **Type consistency:** wave shape `{ projectId, number, name, label, position }` used consistently; snake_case (`project_id`) only in the Supabase/DB layer and the backfill script.
- **No new entity / no layers-special-casing** — matches YAGNI in the spec.
