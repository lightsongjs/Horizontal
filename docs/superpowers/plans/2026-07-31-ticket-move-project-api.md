# Ticket Move Between Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `projectId` to `PATCH /api/tickets/:id` so a ticket written in the wrong project can be moved to the right one, getting a new ID with the target project's prefix.

**Architecture:** Shared Supabase helpers move to `functions/api/_tickets-lib.ts`, imported by both `tickets.ts` and `tickets/[id].ts`. The move is a branch inside the existing `onRequestPatch` that resolves the target project, refuses if any dependency row references the ticket, picks the final wave/theme, computes a new ID, then folds `id` + `project_id` into the single existing `PATCH issues` call. Because the move is refused when dependencies exist, no `dependencies` row references the old ID at rename time — so the missing `on update cascade` never bites and no multi-table transaction is needed.

**Tech Stack:** TypeScript, Cloudflare Pages Functions (`PagesFunction`), Supabase REST (PostgREST) over `fetch`, vitest. Node ESM for the `ticket-kit` CLI.

**Spec:** `docs/superpowers/specs/2026-07-31-ticket-move-project-api-design.md`

## Global Constraints

- No new dependencies. Only `vitest` (already in `package.json`) for tests.
- Tests run with `npm test` (`vitest run`). Typecheck with `npm run typecheck` (`tsc -b --noEmit`).
- All Supabase access goes through `fetch` against `${SUPABASE_URL}/rest/v1/...` with the headers from `sbHeaders(SUPABASE_SERVICE_ROLE_KEY)`. Never import `@supabase/supabase-js` into `functions/`.
- Every value interpolated into a PostgREST URL goes through `encodeURIComponent`.
- Error responses are `Response.json({ error: '<snake_case>' , ...detail }, { status })`. Existing error codes must not change.
- Ticket IDs are `<PREFIX>-<NN>` with `NN` zero-padded to width 2.
- `ticket-kit/` is a separate git repo (remote `github.com/lightsongjs/horizontal-ticket-kit`). Changes there are committed and pushed from inside `ticket-kit/`, never copied.
- Commit messages follow conventional commits and end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Extract shared Supabase helpers into `_tickets-lib.ts`

`sbHeaders` is duplicated verbatim in `tickets.ts` and `tickets/[id].ts`. `resolveProject` lives only in `tickets.ts` but the move needs it, and it needs a `current_wave` field it does not currently select. The next-ID computation is inline in `onRequestPost` and the move needs the same logic.

**Files:**
- Create: `functions/api/_tickets-lib.ts`
- Create: `functions/api/_tickets-lib.test.ts`
- Modify: `functions/api/tickets.ts` (delete `sbHeaders` lines 16-23, delete `resolveProject` lines 25-38, delete inline next-ID lines 159-172, add import)
- Modify: `functions/api/tickets/[id].ts` (delete `sbHeaders` lines 20-27, add import)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sbHeaders(key: string): Record<string, string>`
  - `interface Project { id: string; prefix: string; current_wave: number }`
  - `resolveProject(param: string, supabaseUrl: string, headers: Record<string, string>): Promise<Project | null>`
  - `nextIdFrom(existingIds: string[], prefix: string): string` — pure
  - `nextIssueId(projectId: string, prefix: string, supabaseUrl: string, headers: Record<string, string>): Promise<string | null>` — `null` signals a db error

- [ ] **Step 1: Write the failing test for `nextIdFrom`**

Create `functions/api/_tickets-lib.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nextIdFrom } from './_tickets-lib'

describe('nextIdFrom', () => {
  it('returns 01 for an empty project', () => {
    expect(nextIdFrom([], 'TK')).toBe('TK-01')
  })
  it('returns max + 1', () => {
    expect(nextIdFrom(['TK-01', 'TK-02', 'TK-03'], 'TK')).toBe('TK-04')
  })
  it('is not fooled by unordered input', () => {
    expect(nextIdFrom(['TK-07', 'TK-02'], 'TK')).toBe('TK-08')
  })
  it('pads to width 2', () => {
    expect(nextIdFrom(['TK-08'], 'TK')).toBe('TK-09')
  })
  it('does not pad past width 2', () => {
    expect(nextIdFrom(['TK-99'], 'TK')).toBe('TK-100')
  })
  it('ignores ids whose suffix is not a number', () => {
    expect(nextIdFrom(['TK-01', 'TK-draft'], 'TK')).toBe('TK-02')
  })
  it('handles a multi-character prefix', () => {
    expect(nextIdFrom(['KATA-11'], 'KATA')).toBe('KATA-12')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- functions/api/_tickets-lib.test.ts`
Expected: FAIL — cannot resolve `./_tickets-lib`.

- [ ] **Step 3: Create `_tickets-lib.ts`**

Create `functions/api/_tickets-lib.ts`:

```ts
// functions/api/_tickets-lib.ts
// Shared Supabase REST helpers for the tickets endpoints.

export interface Project {
  id: string
  prefix: string
  current_wave: number
}

export function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

export async function resolveProject(
  param: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<Project | null> {
  const encoded = encodeURIComponent(param)
  const res = await fetch(
    `${supabaseUrl}/rest/v1/projects?or=(id.eq.${encoded},name.ilike.${encoded})&select=id,prefix,current_wave&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Project[]
  return rows[0] ?? null
}

// Pure: given every existing id in a project, produce the next free one.
export function nextIdFrom(existingIds: string[], prefix: string): string {
  const maxNum = existingIds
    .map(id => Number(id.slice(prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}-${String(maxNum + 1).padStart(2, '0')}`
}

export async function nextIssueId(
  projectId: string,
  prefix: string,
  supabaseUrl: string,
  headers: Record<string, string>
): Promise<string | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/issues?project_id=eq.${encodeURIComponent(projectId)}&select=id`,
    { headers }
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string }>
  return nextIdFrom(rows.map(r => r.id), prefix)
}
```

Note: `Number('draft')` is `NaN` and `Number.isFinite(NaN)` is `false`, which is what makes the non-numeric-suffix test pass. `Number('')` is `0`, so a bare prefix contributes 0 and is harmless.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- functions/api/_tickets-lib.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Rewire `tickets.ts` to the shared lib**

In `functions/api/tickets.ts`, delete the local `sbHeaders` function (lines 16-23) and the local `resolveProject` function (lines 25-38), and add at the top under the `Env` interface:

```ts
import { sbHeaders, resolveProject, nextIssueId } from './_tickets-lib'
```

Then replace the next-ID block in `onRequestPost`. Delete this:

```ts
  const prefix = projResolved.prefix

  // 2. Compute next ID
  const issuesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&select=id`,
    { headers }
  )
  if (!issuesRes.ok) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
  const existingIssues = await issuesRes.json() as Array<{ id: string }>
  const maxNum = existingIssues
    .map(r => Number(r.id.slice(prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  const newId = `${prefix}-${String(maxNum + 1).padStart(2, '0')}`
```

and put this in its place:

```ts
  // 2. Compute next ID
  const newId = await nextIssueId(pid, projResolved.prefix, SUPABASE_URL, headers)
  if (newId === null) {
    return Response.json({ error: 'db_error' }, { status: 502 })
  }
```

- [ ] **Step 6: Rewire `tickets/[id].ts` to the shared lib**

In `functions/api/tickets/[id].ts`, delete the local `sbHeaders` function (lines 20-27) and add under the `Env` interface:

```ts
import { sbHeaders } from '../_tickets-lib'
```

Leave `FIELD_MAP` and `buildIssueUpdate` where they are.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm test`
Expected: PASS — the 7 new `nextIdFrom` tests plus the 7 pre-existing `buildIssueUpdate` tests.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add functions/api/_tickets-lib.ts functions/api/_tickets-lib.test.ts functions/api/tickets.ts "functions/api/tickets/[id].ts"
git commit -m "refactor: extract shared Supabase ticket helpers into _tickets-lib

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Build the handler test harness and fix the cross-project dup-check

The dup-check in `onRequestPatch` filters by `wave` but not by `project_id`, so renaming a ticket is refused when the title collides with a ticket in a *different* project. `onRequestPost` filters correctly. The move needs a correct dup-check against the target project, so fix it here — and build the fetch-mock harness the rest of the plan depends on while doing it.

**Files:**
- Modify: `functions/api/tickets/[id].test.ts` (add harness + tests)
- Modify: `functions/api/tickets/[id].ts` (dup-check block, currently lines 102-125)

**Interfaces:**
- Consumes: `buildIssueUpdate` and `onRequestPatch` from `./[id]`.
- Produces (test-file-local, used by Tasks 3-6):
  - `mockFetch(routes: Route[]): Call[]` — installs `globalThis.fetch`, returns the array it appends to
  - `route(needle: string, body: unknown, opts?: { ok?: boolean; status?: number; method?: string }): Route`
  - `patchCtx(id: string, body: unknown): any` — a fake `PagesFunction` context for a PATCH

- [ ] **Step 1: Write a smoke test for the harness**

Append to `functions/api/tickets/[id].test.ts`. First add `onRequestPatch` to the existing import and pull in `beforeEach`/`afterEach`, so line 1-2 become:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildIssueUpdate, onRequestPatch } from './[id]'
```

Then append the harness and the smoke test:

```ts
// ---- handler test harness ----

interface Call { url: string; method: string; body?: any }
interface Route {
  match: (url: string, method: string) => boolean
  respond: () => { ok?: boolean; status?: number; body: unknown }
}

const SB = 'https://db.test'
const realFetch = globalThis.fetch

// Routes are tried in order; the first match wins, so put specific ones first.
function route(
  needle: string,
  body: unknown,
  opts: { ok?: boolean; status?: number; method?: string } = {}
): Route {
  return {
    match: (url, method) =>
      url.includes(needle) && (!opts.method || method === opts.method),
    respond: () => ({ body, ok: opts.ok, status: opts.status }),
  }
}

function mockFetch(routes: Route[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const method = String(init.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
    const hit = routes.find(r => r.match(url, method))
    if (!hit) throw new Error(`unmocked fetch: ${method} ${url}`)
    const { ok = true, status = 200, body } = hit.respond()
    return { ok, status, json: async () => body } as any
  }) as any
  return calls
}

function patchCtx(id: string, body: unknown): any {
  return {
    params: { id },
    env: {
      SUPABASE_URL: SB,
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TICKETS_API_KEY: 'api-key',
    },
    request: new Request(`https://app.test/api/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

afterEach(() => { globalThis.fetch = realFetch })

describe('onRequestPatch harness', () => {
  it('rejects a body with no updatable fields', async () => {
    mockFetch([])
    const res = await onRequestPatch(patchCtx('HZ-07', { nonsense: 1 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_updatable_fields' })
  })
})
```

- [ ] **Step 2: Run it to confirm the harness works at all**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: PASS.

If this fails with `Response.json is not a function`, the Node version lacks the static helper. Fix by adding this immediately above `afterEach` in the test file, then re-run:

```ts
if (typeof (Response as any).json !== 'function') {
  ;(Response as any).json = (data: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
}
```

- [ ] **Step 3: Write the failing dup-check tests**

Append to `functions/api/tickets/[id].test.ts`:

```ts
describe('onRequestPatch title dup-check', () => {
  it('scopes the dup-check to the ticket own project', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'New title' }))
    expect(res.status).toBe(200)
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain('project_id=eq.horizontal')
    expect(dup.url).toContain('wave=eq.3')
    expect(dup.url).toContain('id=neq.HZ-07')
  })

  it('reports a duplicate inside the same project', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Old', wave: 3 }]),
      route('&title=ilike.', [{ id: 'HZ-11' }]),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { title: 'Taken' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_title', existing_id: 'HZ-11' })
  })
})
```

- [ ] **Step 4: Run to verify the first test fails**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: the `scopes the dup-check` test FAILS — the dup URL has no `project_id=eq.` — and it may also fail on an `unmocked fetch` for the old `select=wave` lookup.

- [ ] **Step 5: Load the current issue once, and scope the dup-check**

In `functions/api/tickets/[id].ts`, this replaces the whole dup-check block (currently lines 102-125). The ticket row is now loaded unconditionally, because Tasks 3-6 need `project_id` and `title` too, and because it removes the separate existence check later in the function.

Insert immediately after the `no_updatable_fields` guard:

```ts
  // Load the ticket once: the dup-check and the move both need its current state.
  const currentRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id,project_id,title,wave&limit=1`,
    { headers }
  )
  if (!currentRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const currentRows = await currentRes.json() as Array<{
    id: string; project_id: string; title: string; wave: number
  }>
  if (!currentRows.length) return Response.json({ error: 'not_found' }, { status: 404 })
  const current = currentRows[0]
```

and replace the old dup-check with:

```ts
  // Dup-check when the title is being renamed, scoped to the owning project.
  if ('title' in issueUpdate) {
    const wave = (issueUpdate.wave as number | undefined) ?? current.wave
    const encoded = encodeURIComponent(issueUpdate.title as string)
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${encodeURIComponent(current.project_id)}&title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!dupRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const dups = await dupRes.json() as Array<{ id: string }>
    if (dups.length > 0) {
      return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
    }
  }
```

Then delete the now-redundant `else` branch that re-checks existence for deps-only updates (currently lines 151-160), so the write block reads:

```ts
  // PATCH issue fields (if any)
  if (Object.keys(issueUpdate).length > 0) {
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(issueUpdate) }
    )
    if (!patchRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const patched = await patchRes.json() as Array<unknown>
    if (!patched.length) return Response.json({ error: 'not_found' }, { status: 404 })
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add "functions/api/tickets/[id].ts" "functions/api/tickets/[id].test.ts"
git commit -m "fix: scope the PATCH title dup-check to the ticket own project

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Move a dependency-free ticket to another project

The core of the feature: `projectId` in the body resolves the target, computes a new ID with the target's prefix, lands the ticket in the target's `current_wave`, clears the theme, and reports `movedFrom`. Dependency guarding comes in Task 4; this task assumes no dependency rows and mocks the guard query as empty.

**Files:**
- Modify: `functions/api/tickets/[id].ts`
- Modify: `functions/api/tickets/[id].test.ts`

**Interfaces:**
- Consumes: `resolveProject`, `nextIssueId`, `Project` from `../_tickets-lib` (Task 1); `mockFetch`, `route`, `patchCtx` from the test file (Task 2).
- Produces: `PATCH` accepts `projectId: string`; a successful move responds `200 { id: <newId>, movedFrom: <oldId>, updated: string[] }` where `updated` contains `'projectId'`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/api/tickets/[id].test.ts`:

```ts
// Standard mocks for a HZ-07 -> ticket-kit move. Override by prepending routes.
function moveRoutes(over: Route[] = []): Route[] {
  return [
    ...over,
    route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
      [{ id: 'HZ-07', project_id: 'horizontal', title: 'Wrong project', wave: 3 }]),
    route('/rest/v1/projects?or=', [{ id: 'ticket-kit', prefix: 'TK', current_wave: 2 }]),
    route('/rest/v1/dependencies?or=', []),
    route('/rest/v1/waves?project_id=eq.ticket-kit', [{ number: 2 }]),
    route('/rest/v1/issues?project_id=eq.ticket-kit&select=id', [{ id: 'TK-01' }, { id: 'TK-02' }]),
    route('&title=ilike.', []),
    route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'TK-03' }], { method: 'PATCH' }),
  ]
}

describe('onRequestPatch move to another project', () => {
  it('renames the ticket with the target prefix and reports movedFrom', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.id).toBe('TK-03')
    expect(out.movedFrom).toBe('HZ-07')
    expect(out.updated).toContain('projectId')

    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.id).toBe('TK-03')
    expect(write.body.project_id).toBe('ticket-kit')
    expect(write.body.wave).toBe(2)      // target current_wave
    expect(write.body.theme).toBe(null)  // theme keys are per-project
  })

  it('accepts field edits in the same request as the move', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Fixed title', desc: 'body' })
    )
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.title).toBe('Fixed title')
    expect(write.body.details).toBe('body')
    expect(write.body.id).toBe('TK-03')
  })

  it('treats a move to the current project as a no-op', async () => {
    const calls = mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'Stay', wave: 3 }]),
      route('/rest/v1/projects?or=', [{ id: 'horizontal', prefix: 'HZ', current_wave: 5 }]),
      route('&title=ilike.', []),
      route('/rest/v1/issues?id=eq.HZ-07', [{ id: 'HZ-07' }], { method: 'PATCH' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'horizontal', title: 'Stay put' }))
    expect(res.status).toBe(200)
    const out = await res.json() as any
    expect(out.id).toBe('HZ-07')
    expect(out.movedFrom).toBeUndefined()
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.id).toBeUndefined()
    expect(write.body.wave).toBeUndefined()
  })

  it('404s on an unknown target project', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'X', wave: 3 }]),
      route('/rest/v1/projects?or=', []),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'nope' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'project_not_found' })
  })

  it('accepts projectId as the only field', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: FAIL — `projectId` is not in `FIELD_MAP`, so the body looks empty and the handler answers `400 no_updatable_fields`.

- [ ] **Step 3: Implement the move branch**

In `functions/api/tickets/[id].ts`, extend the import from Task 1:

```ts
import { sbHeaders, resolveProject, nextIssueId } from '../_tickets-lib'
```

Widen the "nothing to do" guard. Replace:

```ts
  if (Object.keys(issueUpdate).length === 0 && !hasDeps) {
    return Response.json({ error: 'no_updatable_fields' }, { status: 400 })
  }
```

with:

```ts
  const wantsMove = typeof body.projectId === 'string' && body.projectId.length > 0

  if (Object.keys(issueUpdate).length === 0 && !hasDeps && !wantsMove) {
    return Response.json({ error: 'no_updatable_fields' }, { status: 400 })
  }
```

Then insert the move branch **after** the `current` load from Task 2 and **before** the title dup-check, so the dup-check sees the final wave and the correct project:

```ts
  // Move to another project: new id with the target prefix, target wave, no theme.
  let movedFrom: string | null = null
  let dupProjectId = current.project_id

  if (wantsMove) {
    const target = await resolveProject(body.projectId as string, SUPABASE_URL, headers)
    if (!target) {
      return Response.json({ error: 'project_not_found' }, { status: 404 })
    }

    if (target.id !== current.project_id) {
      const newId = await nextIssueId(target.id, target.prefix, SUPABASE_URL, headers)
      if (newId === null) return Response.json({ error: 'db_error' }, { status: 502 })

      issueUpdate.wave = target.current_wave
      issueUpdate.theme = null
      issueUpdate.id = newId
      issueUpdate.project_id = target.id
      movedFrom = id
      dupProjectId = target.id
    }
  }
```

Change the dup-check from Task 2 to use `dupProjectId` instead of `current.project_id`:

```ts
      `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${encodeURIComponent(dupProjectId)}&title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
```

Finally, replace the response block at the end of the function. `id` and `project_id` are internal columns, so they are reported as the single client-facing key `projectId`:

```ts
  const dbToClient: Record<string, string> = Object.fromEntries(
    Object.entries(FIELD_MAP).map(([client, db]) => [db, client])
  )
  const updatedFields = [
    ...Object.keys(issueUpdate)
      .filter(k => k !== 'id' && k !== 'project_id')
      .map(k => dbToClient[k] ?? k),
    ...(movedFrom ? ['projectId'] : []),
    ...(hasDeps ? ['deps'] : []),
  ]
  const finalId = (issueUpdate.id as string | undefined) ?? id
  return Response.json({
    id: finalId,
    ...(movedFrom ? { movedFrom } : {}),
    updated: updatedFields,
  })
```

Note: the `dependencies` replace block still keys on the old `id`. That is safe because Task 4 forbids combining a move with `deps`; until then the combination is untested and unsupported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/tickets/[id].ts" "functions/api/tickets/[id].test.ts"
git commit -m "feat: move a ticket to another project via PATCH projectId

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Refuse the move when dependencies reference the ticket

Renaming the ID is only safe because nothing in `dependencies` points at it — the FKs have `on delete cascade` but no `on update cascade`. This task installs the guard that makes that true, in both directions, plus the rule that a move cannot carry a `deps` update (which would re-create a cross-project link behind the guard's back).

**Files:**
- Modify: `functions/api/tickets/[id].ts`
- Modify: `functions/api/tickets/[id].test.ts`

**Interfaces:**
- Consumes: the move branch from Task 3.
- Produces: `409 { error: 'has_dependencies', dependsOn: string[], dependedOnBy: string[] }` and `400 { error: 'cannot_move_and_set_deps' }`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/api/tickets/[id].test.ts`:

```ts
describe('onRequestPatch move dependency guard', () => {
  it('refuses when the ticket depends on another', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-07', depends_on_id: 'HZ-03' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'has_dependencies',
      dependsOn: ['HZ-03'],
      dependedOnBy: [],
    })
  })

  it('refuses when another ticket depends on it', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-09', depends_on_id: 'HZ-07' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'has_dependencies',
      dependsOn: [],
      dependedOnBy: ['HZ-09'],
    })
  })

  it('reports both directions at once', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [
        { issue_id: 'HZ-07', depends_on_id: 'HZ-03' },
        { issue_id: 'HZ-09', depends_on_id: 'HZ-07' },
      ]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    const out = await res.json() as any
    expect(out.dependsOn).toEqual(['HZ-03'])
    expect(out.dependedOnBy).toEqual(['HZ-09'])
  })

  it('queries the dependency table before writing anything', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/dependencies?or=', [{ issue_id: 'HZ-07', depends_on_id: 'HZ-03' }]),
    ]))
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('refuses to combine a move with a deps update', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(
      patchCtx('HZ-07', { projectId: 'ticket-kit', deps: ['HZ-03'] })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_move_and_set_deps' })
  })

  it('still allows a deps update with no move', async () => {
    mockFetch([
      route('/rest/v1/issues?id=eq.HZ-07&select=id,project_id,title,wave',
        [{ id: 'HZ-07', project_id: 'horizontal', title: 'X', wave: 3 }]),
      route('/rest/v1/issues?id=in.', [{ id: 'HZ-03' }]),
      route('/rest/v1/dependencies?issue_id=eq.HZ-07', [], { method: 'DELETE' }),
      route('/rest/v1/dependencies', [{}], { method: 'POST' }),
    ])
    const res = await onRequestPatch(patchCtx('HZ-07', { deps: ['HZ-03'] }))
    expect(res.status).toBe(200)
    expect((await res.json() as any).updated).toEqual(['deps'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: the four guard tests FAIL with `200`, and `refuses to combine` FAILS with `200`.

- [ ] **Step 3: Implement the guard**

In `functions/api/tickets/[id].ts`, inside the move branch from Task 3, insert this as the **first** thing in the `if (target.id !== current.project_id) {` block, before `nextIssueId`:

```ts
      if (hasDeps) {
        return Response.json({ error: 'cannot_move_and_set_deps' }, { status: 400 })
      }

      const enc = encodeURIComponent(id)
      const depRes = await fetch(
        `${SUPABASE_URL}/rest/v1/dependencies?or=(issue_id.eq.${enc},depends_on_id.eq.${enc})&select=issue_id,depends_on_id`,
        { headers }
      )
      if (!depRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const depRows = await depRes.json() as Array<{ issue_id: string; depends_on_id: string }>
      if (depRows.length > 0) {
        return Response.json({
          error: 'has_dependencies',
          dependsOn: depRows.filter(r => r.issue_id === id).map(r => r.depends_on_id),
          dependedOnBy: depRows.filter(r => r.depends_on_id === id).map(r => r.issue_id),
        }, { status: 409 })
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/tickets/[id].ts" "functions/api/tickets/[id].test.ts"
git commit -m "feat: refuse a project move when dependencies reference the ticket

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Validate the `wave` and `theme` overrides against the target project

`waves` has PK `(project_id, number)` and `themes` has PK `(project_id, key)`, so a caller-supplied wave or theme must exist in the *target* project. Task 3 hardcoded the target's `current_wave` and `null`; this task lets the caller override both, with validation.

**Files:**
- Modify: `functions/api/tickets/[id].ts`
- Modify: `functions/api/tickets/[id].test.ts`

**Interfaces:**
- Consumes: the move branch from Tasks 3-4.
- Produces: `422 { error: 'wave_not_in_target' }`, `422 { error: 'theme_not_in_target' }`, `400 { error: 'invalid_wave' }`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/api/tickets/[id].test.ts`:

```ts
describe('onRequestPatch move wave and theme overrides', () => {
  it('honours an explicit wave that exists in the target', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/waves?project_id=eq.ticket-kit&number=eq.4', [{ number: 4 }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 4 }))
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.wave).toBe(4)
  })

  it('422s on a wave the target project does not have', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/waves?project_id=eq.ticket-kit&number=eq.9', []),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 9 }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'wave_not_in_target' })
  })

  it('400s on a non-integer wave', async () => {
    mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', wave: 'two' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_wave' })
  })

  it('validates the default wave too', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.url.includes('/rest/v1/waves?project_id=eq.ticket-kit'))).toBe(true)
  })

  it('honours a theme key that exists in the target', async () => {
    const calls = mockFetch(moveRoutes([
      route('/rest/v1/themes?project_id=eq.ticket-kit', [{ key: 'api' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 'api' }))
    expect(res.status).toBe(200)
    const write = calls.find(c => c.method === 'PATCH')!
    expect(write.body.theme).toBe('api')
  })

  it('422s on a theme key the target project does not have', async () => {
    mockFetch(moveRoutes([
      route('/rest/v1/themes?project_id=eq.ticket-kit', []),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', theme: 'ghost' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'theme_not_in_target' })
  })

  it('does not query themes when no theme is given', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(calls.some(c => c.url.includes('/rest/v1/themes'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: the override tests FAIL — `wave` is currently forced to `current_wave` and `theme` to `null`, and no `waves`/`themes` query is made.

- [ ] **Step 3: Implement the validation**

In `functions/api/tickets/[id].ts`, inside the `if (target.id !== current.project_id) {` block, replace:

```ts
      issueUpdate.wave = target.current_wave
      issueUpdate.theme = null
```

with:

```ts
      // Wave: caller override, else the target project active wave. Must exist there.
      let wave = target.current_wave
      if ('wave' in body) {
        wave = Number(body.wave)
        if (!Number.isInteger(wave) || wave < 1) {
          return Response.json({ error: 'invalid_wave' }, { status: 400 })
        }
      }
      const waveRes = await fetch(
        `${SUPABASE_URL}/rest/v1/waves?project_id=eq.${encodeURIComponent(target.id)}&number=eq.${wave}&select=number&limit=1`,
        { headers }
      )
      if (!waveRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
      const waveRows = await waveRes.json() as Array<{ number: number }>
      if (!waveRows.length) {
        return Response.json({ error: 'wave_not_in_target' }, { status: 422 })
      }
      issueUpdate.wave = wave

      // Theme: cleared by default, because theme keys are per-project.
      const theme = (body.theme as string | null | undefined) ?? null
      if (theme !== null) {
        const themeRes = await fetch(
          `${SUPABASE_URL}/rest/v1/themes?project_id=eq.${encodeURIComponent(target.id)}&key=eq.${encodeURIComponent(theme)}&select=key&limit=1`,
          { headers }
        )
        if (!themeRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
        const themeRows = await themeRes.json() as Array<{ key: string }>
        if (!themeRows.length) {
          return Response.json({ error: 'theme_not_in_target' }, { status: 422 })
        }
      }
      issueUpdate.theme = theme
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/tickets/[id].ts" "functions/api/tickets/[id].test.ts"
git commit -m "feat: validate move wave and theme against the target project

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dup-check the title against the target project on a move

Task 3 already points the dup-check at `dupProjectId`. This task proves it, including the case where the ticket keeps its title and the collision only shows up because it landed in a new project.

**Files:**
- Modify: `functions/api/tickets/[id].test.ts`
- Modify: `functions/api/tickets/[id].ts` (only if the tests reveal a gap)

**Interfaces:**
- Consumes: `dupProjectId` and the dup-check from Tasks 2-3.
- Produces: no new interface — closes the contract.

- [ ] **Step 1: Write the tests**

Append to `functions/api/tickets/[id].test.ts`:

```ts
describe('onRequestPatch move dup-check', () => {
  it('checks the title against the target project and the final wave', async () => {
    const calls = mockFetch(moveRoutes())
    await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Fresh' }))
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain('project_id=eq.ticket-kit')
    expect(dup.url).toContain('wave=eq.2')
  })

  it('409s when the target project already has that title in that wave', async () => {
    mockFetch(moveRoutes([
      route('&title=ilike.', [{ id: 'TK-05' }]),
    ]))
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit', title: 'Taken' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_title', existing_id: 'TK-05' })
  })

  it('carries the current title into the dup-check when the move renames nothing', async () => {
    const calls = mockFetch(moveRoutes())
    const res = await onRequestPatch(patchCtx('HZ-07', { projectId: 'ticket-kit' }))
    expect(res.status).toBe(200)
    const dup = calls.find(c => c.url.includes('&title=ilike.'))!
    expect(dup.url).toContain(encodeURIComponent('Wrong project'))
    expect(dup.url).toContain('project_id=eq.ticket-kit')
  })
})
```

- [ ] **Step 2: Run to see which fail**

Run: `npm test -- "functions/api/tickets/[id].test.ts"`
Expected: the first two PASS. The third FAILS — the dup-check only runs when `'title' in issueUpdate`, and a bare move sends no title, so no dup query happens and `calls.find` returns `undefined`.

- [ ] **Step 3: Run the dup-check on a move even without a rename**

In `functions/api/tickets/[id].ts`, change the dup-check condition so a move always checks, using the current title as the effective one:

```ts
  // Dup-check the effective title. A move must check against the target project
  // even when the title is unchanged, since the collision is new there.
  if ('title' in issueUpdate || movedFrom) {
    const wave = (issueUpdate.wave as number | undefined) ?? current.wave
    const effectiveTitle = (issueUpdate.title as string | undefined) ?? current.title
    const encoded = encodeURIComponent(effectiveTitle)
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${encodeURIComponent(dupProjectId)}&title=ilike.${encoded}&wave=eq.${wave}&id=neq.${encodeURIComponent(id)}&select=id&limit=1`,
      { headers }
    )
    if (!dupRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
    const dups = await dupRes.json() as Array<{ id: string }>
    if (dups.length > 0) {
      return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
    }
  }
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests. In particular the Task 3 no-op test must still pass: it moves to the current project, so `movedFrom` stays `null` and the dup-check still keys off `'title' in issueUpdate`.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "functions/api/tickets/[id].ts" "functions/api/tickets/[id].test.ts"
git commit -m "fix: dup-check the title against the target project on a move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Add `--project` to the `ticket-kit` CLI

`ai-client.mjs` is how the API actually gets used. Without a flag, the endpoint exists but there is no tool. The client is flag-based (`--update --id X`), so the move rides on `--update`, matching the single-PATCH decision.

**Files:**
- Modify: `ticket-kit/ai-client.mjs` (`update()`, lines 145-199)
- Modify: `ticket-kit/README.md`
- Modify: `ticket-kit/CLAUDE.md`

**Interfaces:**
- Consumes: `PATCH /api/tickets/:id` with `projectId`, from Tasks 3-6.
- Produces: `node ai-client.mjs --update --id <ID> --project <target> [--wave N] [--theme key]`

- [ ] **Step 1: Accept `--project` and report a move**

In `ticket-kit/ai-client.mjs`, update the comment block above `update()`:

```js
// --update --id KATA-03 [--title "..."] [--wave N] [--done true] [--deps ID1,ID2]
// [--desc "..."] [--notes "..."] [--theme key] [--selectors '[...]'] [--scenarios '[...]']
// [--project <target>]  moves the ticket to another project; it gets a new ID with
//                       that project's prefix. Refused if any dependency touches it.
// Prints: updated: KATA-03  |  moved: KATA-03 -> TK-12  |  duplicate: KATA-07  |  not_found
```

Add the flag right after the `notes` line (currently line 164):

```js
  if ('project' in flags) {
    if (flags.project === true) { console.error('--project requires a value'); process.exit(1) }
    body.projectId = String(flags.project)
  }
```

Extend `knownFields` (currently line 179) and its error message:

```js
  const knownFields = ['title', 'desc', 'theme', 'wave', 'done', 'notes', 'deps', 'selectors', 'scenarios', 'projectId']
  if (!knownFields.some(f => f in body)) {
    console.error('Provide at least one field: --title, --wave, --done, --deps, --desc, --notes, --theme, --project, --selectors, --scenarios')
    process.exit(1)
  }
```

Update the usage string (currently line 151) to include `[--project <target>]`:

```js
    console.error('Usage: --update --id <ticket-id> [--title "..."] [--wave N] [--done true|false] [--deps ID1,ID2] [--desc "..."] [--notes "..."] [--theme key] [--project <target>] [--selectors \'[...]\'] [--scenarios \'[...]\']')
```

Replace the response handling (currently lines 190-199):

```js
  if (status === 200) {
    if (data.movedFrom) {
      console.log(`moved: ${data.movedFrom} -> ${data.id}`)
    } else {
      console.log(`updated: ${id}`)
    }
  } else if (status === 404) {
    console.log(data.error === 'project_not_found' ? 'project_not_found' : 'not_found')
  } else if (status === 409 && data.error === 'has_dependencies') {
    console.log('has_dependencies')
    if (data.dependsOn?.length) console.log(`  depends on: ${data.dependsOn.join(', ')}`)
    if (data.dependedOnBy?.length) console.log(`  depended on by: ${data.dependedOnBy.join(', ')}`)
    console.log('  clear them with --update --id <id> --deps "" then move')
    process.exit(1)
  } else if (status === 409) {
    console.log(`duplicate: ${data.existing_id}`)
  } else if (status === 422) {
    console.log(data.error)
    process.exit(1)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
```

- [ ] **Step 2: Verify the CLI parses the flags without hitting the network**

Run from the repo root:

```bash
node ticket-kit/ai-client.mjs --update
```

Expected: the usage string, now containing `[--project <target>]`, exit code 1.

```bash
node ticket-kit/ai-client.mjs --update --id HZ-07 --project
```

Expected: `--project requires a value`, exit code 1.

- [ ] **Step 3: Document the flag in `README.md`**

In `ticket-kit/README.md`, find the `--update` section and add, after the existing flag list:

```markdown
### Mutarea unui tichet în alt proiect

```bash
node ai-client.mjs --update --id HZ-07 --project ticket-kit
node ai-client.mjs --update --id HZ-07 --project ticket-kit --wave 2 --theme api
```

Tichetul primește un **ID nou** cu prefixul proiectului țintă (`HZ-07` → `TK-12`);
linkul vechi nu mai funcționează. Fără `--wave` aterizează în wave-ul activ al
țintei. Tema se golește, fiindcă cheile de theme sunt per-proiect.

Mutarea e **refuzată** (`has_dependencies`) dacă orice dependență atinge tichetul,
în oricare sens — nimic nu se rupe fără decizia ta. Golește-le întâi cu
`--update --id <id> --deps ""`, apoi mută. Din același motiv, `--project` nu se
combină cu `--deps` în aceeași comandă.
```

- [ ] **Step 4: Add the one-liner to `ticket-kit/CLAUDE.md`**

In the command block in `ticket-kit/CLAUDE.md`, after the `--update` line, add:

```bash
node ai-client.mjs --update --id <ID> --project <Nume>   # mută tichetul în alt proiect (ID nou)
```

- [ ] **Step 5: Commit and push the separate `ticket-kit` repo**

`ticket-kit/` has its own `.git` with remote `horizontal-ticket-kit`. Do not copy files.

```bash
cd ticket-kit
git add ai-client.mjs README.md CLAUDE.md
git commit -m "feat: --project flag on --update to move a ticket between projects

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
cd ..
```

Then tell the user to run `git pull` in the master copy at
`C:\Users\User\OneDrive\03-RESURSE-MAIN\horizontal-ticket-kit\`.

- [ ] **Step 6: Commit the submodule pointer in the outer repo if git tracks one**

```bash
git status --short ticket-kit
```

If that prints a change for `ticket-kit`, commit it:

```bash
git add ticket-kit
git commit -m "chore: bump ticket-kit to the project-move client

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

If it prints nothing, skip — `ticket-kit/` is ignored by the outer repo.

---

### Task 8: File the two UI follow-up tickets in the Horizontal project

Both were explicitly deferred: no interface work in this slice. File them so they are not lost.

**Files:** none — this task writes to the Horizontal database through the CLI.

**Interfaces:**
- Consumes: `--create` from `ai-client.mjs` (unchanged behaviour).
- Produces: two ticket IDs, reported to the user.

- [ ] **Step 1: Find the project name and the active wave**

```bash
node ticket-kit/ai-client.mjs --projects
```

Expected: a list including the Horizontal project. If that flag is not recognised,
check the dispatch at the bottom of `ticket-kit/ai-client.mjs` for the exact name of
the flag that calls the `projects()` function and use that. Note its exact name and note the wave you will file into (ask the user if it is not obvious; do not guess a wave the project lacks).

- [ ] **Step 2: File the ticket for moving a ticket from the UI**

Substitute `<Nume>` and `<wave>` with the values from Step 1:

```bash
node ticket-kit/ai-client.mjs --create --project "<Nume>" --wave <wave> \
  --title "Mută un tichet în alt proiect din interfață" \
  --desc "Sub secțiunea de note din sheet-ul de detaliu al tichetului, un label care arată proiectul curent. Click pe zona respectivă deschide un dropdown cu toate proiectele; selectarea unuia mută tichetul acolo prin PATCH /api/tickets/:id cu projectId. Tichetul primește un ID nou cu prefixul proiectului țintă, deci sheet-ul trebuie să se re-ancoreze pe ID-ul nou din răspuns (câmpul movedFrom) în loc să rămână pe cel vechi. Tratează 409 has_dependencies cu un mesaj care listează dependențele blocante, și 422 wave_not_in_target. Contract complet: docs/superpowers/specs/2026-07-31-ticket-move-project-api-design.md"
```

Expected: `created: <ID>`. If it prints `duplicate: <ID>`, the ticket already exists — report that ID instead.

- [ ] **Step 3: File the ticket for searching by ticket number**

```bash
node ticket-kit/ai-client.mjs --create --project "<Nume>" --wave <wave> \
  --title "Căutarea să găsească și după numărul tichetului" \
  --desc "În prezent căutarea (find, deschisă cu O) potrivește doar titlul. Să potrivească și ID-ul tichetului, ca să pot tasta 07 sau HZ-07 și să ajung direct la el. Potrivire pe substring, case-insensitive, atât pe ID-ul complet cât și pe partea numerică. Rezultatele care potrivesc pe ID ar trebui să apară înaintea celor care potrivesc doar pe titlu."
```

Expected: `created: <ID>`.

- [ ] **Step 4: Report both IDs to the user**

State the two ticket IDs and the project/wave they landed in. No commit — this task only wrote to the database.

---

## Verification

After Task 8, confirm the whole slice:

```bash
npm test
npm run typecheck
```

Expected: all tests pass, typecheck exits 0.

Then exercise the real endpoint against a deployed environment with a throwaway ticket: create one in project A, move it to project B, confirm the new ID and that the old ID 404s on `GET /api/tickets/<oldId>`. Do not test the move on a ticket that matters — the rename is not reversible without a second move, and the old ID is gone.
