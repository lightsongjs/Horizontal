# ticket-kit --update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--update` to `ai-client.mjs` and `PATCH /api/tickets/:id` to the Cloudflare Pages function, supporting partial updates of any ticket field with replace-total semantics for deps/selectors/scenarios.

**Architecture:** Extract a pure `buildIssueUpdate()` helper from the PATCH handler so business logic is unit-testable without mocking fetch. The handler lives in the existing `functions/api/tickets/[id].ts` alongside `onRequestGet`. The client mirrors the create pattern — collect only present flags, build body, call API, print one-line result.

**Tech Stack:** TypeScript (Cloudflare Pages Functions), Node.js ESM (`ai-client.mjs`), Vitest for tests, Supabase PostgREST via raw fetch.

---

## File Map

| File | Change |
|------|--------|
| `functions/api/tickets/[id].ts` | Export `buildIssueUpdate` helper; add `onRequestPatch` |
| `functions/api/tickets/[id].test.ts` | New — unit tests for `buildIssueUpdate` |
| `ticket-kit/ai-client.mjs` | Add `update()` function + `--update` dispatch branch |
| `ticket-kit/README.md` | Document `--update` command with examples |

---

## Task 1: Test + implement `buildIssueUpdate` helper

**Files:**
- Modify: `functions/api/tickets/[id].ts`
- Create: `functions/api/tickets/[id].test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/api/tickets/[id].test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildIssueUpdate } from './[id]'

describe('buildIssueUpdate', () => {
  it('maps desc to details', () => {
    expect(buildIssueUpdate({ desc: 'hello' })).toEqual({ details: 'hello' })
  })
  it('maps title as-is', () => {
    expect(buildIssueUpdate({ title: 'New title' })).toEqual({ title: 'New title' })
  })
  it('ignores unknown keys', () => {
    expect(buildIssueUpdate({ unknown: 'x', title: 'T' })).toEqual({ title: 'T' })
  })
  it('returns empty object for empty body', () => {
    expect(buildIssueUpdate({})).toEqual({})
  })
  it('maps multiple fields at once', () => {
    expect(buildIssueUpdate({ title: 'T', wave: 2, done: true })).toEqual({ title: 'T', wave: 2, done: true })
  })
  it('maps selectors and scenarios', () => {
    expect(buildIssueUpdate({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] }))
      .toEqual({ selectors: ['mobile'], scenarios: [{ given: 'x', when: 'y', then: 'z' }] })
  })
  it('does not include deps (relation handled separately)', () => {
    expect(buildIssueUpdate({ title: 'T', deps: ['KATA-01'] })).toEqual({ title: 'T' })
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test -- functions/api/tickets
```

Expected: FAIL — `buildIssueUpdate` not exported.

- [ ] **Step 3: Implement `buildIssueUpdate` in `[id].ts`**

Add this export above `onRequestGet` in `functions/api/tickets/[id].ts`:

```typescript
export function buildIssueUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const fieldMap: Record<string, string> = {
    title: 'title',
    desc: 'details',
    theme: 'theme',
    wave: 'wave',
    done: 'done',
    notes: 'notes',
    selectors: 'selectors',
    scenarios: 'scenarios',
  }
  const update: Record<string, unknown> = {}
  for (const [clientKey, dbKey] of Object.entries(fieldMap)) {
    if (clientKey in body) update[dbKey] = body[clientKey]
  }
  return update
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test -- functions/api/tickets
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/tickets/[id].ts functions/api/tickets/[id].test.ts
git commit -m "feat: extract buildIssueUpdate helper with tests"
```

---

## Task 2: Implement `onRequestPatch` handler

**Files:**
- Modify: `functions/api/tickets/[id].ts`

- [ ] **Step 1: Add `onRequestPatch` to `[id].ts`**

Append this export at the bottom of `functions/api/tickets/[id].ts` (after `onRequestGet`):

```typescript
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  let body: Record<string, unknown>
  try {
    body = await context.request.json() as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const issueUpdate = buildIssueUpdate(body)
  const hasDeps = 'deps' in body
  const deps = hasDeps ? (body.deps as string[]) : null

  if (Object.keys(issueUpdate).length === 0 && !hasDeps) {
    return Response.json({ error: 'no_updatable_fields' }, { status: 400 })
  }

  // Dup-check when title is being renamed
  if ('title' in issueUpdate) {
    let wave = issueUpdate.wave as number | undefined
    if (wave === undefined) {
      const currentRes = await fetch(
        `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=wave&limit=1`,
        { headers }
      )
      if (!currentRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const current = await currentRes.json() as Array<{ wave: number }>
      if (!current.length) return Response.json({ error: 'not_found' }, { status: 404 })
      wave = current[0].wave
    }
    const encoded = encodeURIComponent(issueUpdate.title as string)
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!dupRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const dups = await dupRes.json() as Array<{ id: string }>
    if (dups.length > 0) {
      return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
    }
  }

  // Validate deps IDs exist
  if (deps && deps.length > 0) {
    const depsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=in.(${deps.map(encodeURIComponent).join(',')})&select=id`,
      { headers }
    )
    if (!depsRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const existing = await depsRes.json() as Array<{ id: string }>
    const existingIds = new Set(existing.map(d => d.id))
    const unknown = deps.filter(d => !existingIds.has(d))
    if (unknown.length > 0) {
      return Response.json({ error: 'invalid_deps', unknown }, { status: 422 })
    }
  }

  // PATCH issue fields (if any)
  if (Object.keys(issueUpdate).length > 0) {
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(issueUpdate) }
    )
    if (!patchRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const patched = await patchRes.json() as Array<unknown>
    if (!patched.length) return Response.json({ error: 'not_found' }, { status: 404 })
  } else {
    // Only deps update — verify ticket exists
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!checkRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const check = await checkRes.json() as Array<{ id: string }>
    if (!check.length) return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Replace deps (delete all, re-insert)
  if (hasDeps) {
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dependencies?issue_id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers }
    )
    if (!delRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    if (deps && deps.length > 0) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/dependencies`, {
        method: 'POST',
        headers,
        body: JSON.stringify(deps.map(depId => ({ issue_id: id, depends_on_id: depId }))),
      })
      if (!insRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    }
  }

  const updatedFields = [...Object.keys(issueUpdate), ...(hasDeps ? ['deps'] : [])]
  return Response.json({ id, updated: updatedFields })
}
```

- [ ] **Step 2: Run existing tests — confirm nothing broke**

```bash
npm test
```

Expected: all tests PASS (Vitest doesn't execute the Cloudflare handler at test time, only `buildIssueUpdate` is unit-tested).

- [ ] **Step 3: Commit**

```bash
git add functions/api/tickets/[id].ts
git commit -m "feat: add PATCH /api/tickets/:id endpoint"
```

---

## Task 3: Add `update()` to `ai-client.mjs`

**Files:**
- Modify: `ticket-kit/ai-client.mjs`

- [ ] **Step 1: Add `update()` function**

Insert this function in `ticket-kit/ai-client.mjs` after the `get()` function (before the dispatch block at the bottom):

```javascript
// --update --id KATA-03 [--title "..."] [--wave N] [--done true] [--deps ID1,ID2]
// [--desc "..."] [--notes "..."] [--theme key] [--selectors '[...]'] [--scenarios '[...]']
// Prints: updated: KATA-03  |  duplicate: KATA-07  |  not_found
async function update() {
  const { id } = flags
  if (!id) {
    console.error('Usage: --update --id <ticket-id> [--title "..."] [--wave N] [--done true|false] [--deps ID1,ID2] [--desc "..."] [--notes "..."] [--theme key] [--selectors \'[...]\'] [--scenarios \'[...]\']')
    process.exit(1)
  }

  const body = {}
  if ('title' in flags) body.title = flags.title
  if ('desc' in flags) body.desc = flags.desc
  if ('theme' in flags) body.theme = flags.theme
  if ('wave' in flags) body.wave = Number(flags.wave)
  if ('done' in flags) body.done = flags.done === 'true'
  if ('notes' in flags) body.notes = flags.notes
  if ('deps' in flags) body.deps = flags.deps ? String(flags.deps).split(',').map(s => s.trim()).filter(Boolean) : []

  if ('selectors' in flags) {
    try { body.selectors = JSON.parse(flags.selectors) }
    catch { console.error('--selectors must be valid JSON array'); process.exit(1) }
  }
  if ('scenarios' in flags) {
    try { body.scenarios = JSON.parse(flags.scenarios) }
    catch { console.error('--scenarios must be valid JSON array'); process.exit(1) }
  }

  const knownFields = ['title', 'desc', 'theme', 'wave', 'done', 'notes', 'deps', 'selectors', 'scenarios']
  if (!knownFields.some(f => f in body)) {
    console.error('Provide at least one field: --title, --wave, --done, --deps, --desc, --notes, --theme, --selectors, --scenarios')
    process.exit(1)
  }

  const { status, data } = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

  if (status === 200) {
    console.log(`updated: ${id}`)
  } else if (status === 404) {
    console.log('not_found')
  } else if (status === 409) {
    console.log(`duplicate: ${data.existing_id}`)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}
```

- [ ] **Step 2: Add `--update` branch to the dispatch block**

In the dispatch block at the bottom of `ai-client.mjs`, the current final `else` is:

```javascript
} else {
  console.error('Usage: node ai-client.mjs --lookup|--create|--list|--get [options]')
  process.exit(1)
}
```

Replace it with:

```javascript
} else if (flags.update !== undefined) {
  await update()
} else {
  console.error('Usage: node ai-client.mjs --lookup|--create|--list|--get|--update [options]')
  process.exit(1)
}
```

- [ ] **Step 3: Smoke-test locally**

Run against a known ticket (replace with a real ID from your project):

```bash
# Should print: updated: KATA-01
node ticket-kit/ai-client.mjs --update --id KATA-01 --notes "tested via --update"

# Should print: not_found
node ticket-kit/ai-client.mjs --update --id KATA-FAKE --title "X"

# Should print parse error and exit 1
node ticket-kit/ai-client.mjs --update --id KATA-01 --selectors "not-json"
```

- [ ] **Step 4: Commit**

```bash
git add ticket-kit/ai-client.mjs
git commit -m "feat: add --update command to ai-client.mjs"
```

---

## Task 4: Update README

**Files:**
- Modify: `ticket-kit/README.md`

- [ ] **Step 1: Add `--update` to the Commands section**

In `ticket-kit/README.md`, after the `--get` example block, add:

```markdown
# Actualizează câmpuri ale unui tichet existent (PATCH)
node ticket-kit/ai-client.mjs --update --id KATA-03 --title "Nou titlu"
node ticket-kit/ai-client.mjs --update --id KATA-03 --wave 2 --done true
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps KATA-01,KATA-02
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps ""   # șterge toate deps
node ticket-kit/ai-client.mjs --update --id KATA-03 --selectors '["mobile","desktop"]'
node ticket-kit/ai-client.mjs --update --id KATA-03 --scenarios '[{"given":"...","when":"...","then":"..."}]'
# output: updated: KATA-03   (sau duplicate: KATA-07 / not_found)
```

Also add `--update` to the "Flow tipic pentru AI" section:

```markdown
# 5. Actualizează un tichet după review
node ticket-kit/ai-client.mjs --update --id KATA-05 --done true
# → updated: KATA-05
```

- [ ] **Step 2: Commit**

```bash
git add ticket-kit/README.md
git commit -m "docs: document --update command in ticket-kit README"
```
