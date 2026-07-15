# Multi-user Project Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single global admin create users (email + password) from the UI and grant them per-project `read` or `write` access, with each user seeing only their projects, enforced in Postgres RLS.

**Architecture:** A `project_members` join table (user_id, project_id, role) plus an `is_admin()` SQL helper drive rewritten RLS policies so the database — not the UI — enforces isolation. User creation runs through a Supabase Edge Function holding the `service_role` key. The React client gains an extended `useAuth` (`isAdmin`, `access` map) and an admin-only "Utilizatori" screen. Read-only gating in the UI is UX only; RLS is the real boundary.

**Tech Stack:** Supabase (Postgres + RLS + Auth + Edge Functions/Deno), React 18 + TypeScript, Vite, Vitest, `@supabase/supabase-js`.

---

## File Structure

- `supabase/migration-access.sql` — **create**: `project_members`, `is_admin()`, rewritten RLS policies. Run once in SQL editor (single-line statements, no quote chars — same convention as `schema.sql`).
- `scripts/set-admin.mjs` — **create**: one-off Node script to set `app_metadata.role='admin'` on your account via service_role.
- `scripts/test-rls.mjs` — **create**: manual integration check against the live DB with 3 accounts (admin/writer/reader).
- `supabase/functions/admin-users/index.ts` — **create**: Deno Edge Function; admin guard + create/list/set_access/reset_password/delete actions.
- `src/lib/adminUsers.ts` — **create**: typed client wrapper around `supabase.functions.invoke('admin-users', …)`.
- `src/lib/adminUsers.test.ts` — **create**: unit tests for payload shaping / result typing (Vitest).
- `src/lib/access.ts` — **create**: pure helpers `isAdminSession(session)` and `buildAccessMap(rows)`.
- `src/lib/access.test.ts` — **create**: unit tests for the pure helpers.
- `src/auth.tsx` — **modify**: extend `AuthState` with `isAdmin` + `access`, load membership after login.
- `src/components/UsersView.tsx` — **create**: admin-only users management screen.
- `src/App.tsx` — **modify**: add entry point (menu/route) to `UsersView`, admin-gated.
- `.env.example` — **modify**: document that `VITE_SUPABASE_ANON_KEY` stays client-safe; note Edge Function envs live server-side.

> **Note on TDD scope:** Pure TypeScript logic (`access.ts`, `adminUsers.ts` payload shaping) is unit-tested with Vitest first (red → green). RLS policies and the Edge Function run in Postgres/Deno and cannot be unit-tested in Vitest — they get **explicit manual verification steps** against a live Supabase project instead. This is called out per task; do not skip the verification.

---

## Task 1: Migration — `project_members` table + `is_admin()` helper

**Files:**
- Create: `supabase/migration-access.sql`

- [ ] **Step 1: Write the migration SQL**

Follow `schema.sql` conventions: one statement per line, no quote characters, `if not exists` guards.

```sql
-- Horizontal multi-user access migration. Run once in the Supabase SQL editor.
-- Single-line statements, no quote characters (smart-quote / auto-bracket safe).

create table if not exists project_members (user_id uuid not null references auth.users(id) on delete cascade, project_id text not null references projects(id) on delete cascade, role text not null check (role in (read, write)), primary key (user_id, project_id));
create index if not exists project_members_user_idx on project_members(user_id);
alter table project_members enable row level security;
create or replace function is_admin() returns boolean language sql stable as $$ select coalesce((auth.jwt() -> app_metadata ->> role) = admin, false) $$;
```

> The literals `read`, `write`, `admin`, `app_metadata`, `role` inside the SQL must be single-quoted in a real editor. They are shown unquoted here only to honor the repo's no-quote-char convention for mobile editors. **When you paste into the Supabase SQL editor, wrap each string literal in single quotes**, e.g. `check (role in ('read','write'))` and `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`.

- [ ] **Step 2: Verify SQL parses**

Run the statements in the Supabase SQL editor (or `psql`). Expected: table + index + function created, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-access.sql
git commit -m "feat: add project_members table and is_admin helper"
```

---

## Task 2: Migration — rewrite RLS policies

**Files:**
- Modify: `supabase/migration-access.sql` (append)

- [ ] **Step 1: Append policy drops + rewrites**

Append to `supabase/migration-access.sql`. Drop the permissive policies from `schema.sql`, then create membership-aware ones. (String literals shown unquoted per repo convention — single-quote them when pasting.)

```sql
drop policy if exists p_projects on projects;
drop policy if exists p_waves on waves;
drop policy if exists p_themes on themes;
drop policy if exists p_issues on issues;
drop policy if exists p_dependencies on dependencies;

-- projects: read if admin or member; write (insert/update/delete) admin only
create policy projects_select on projects for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = projects.id and m.user_id = auth.uid()));
create policy projects_write on projects for all to authenticated using (is_admin()) with check (is_admin());

-- waves: read if admin or member; write if admin or member with write
create policy waves_select on waves for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid()));
create policy waves_write on waves for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid() and m.role = write)) with check (is_admin() or exists (select 1 from project_members m where m.project_id = waves.project_id and m.user_id = auth.uid() and m.role = write));

-- themes: same shape as waves
create policy themes_select on themes for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid()));
create policy themes_write on themes for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid() and m.role = write)) with check (is_admin() or exists (select 1 from project_members m where m.project_id = themes.project_id and m.user_id = auth.uid() and m.role = write));

-- issues: same shape as waves
create policy issues_select on issues for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid()));
create policy issues_write on issues for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid() and m.role = write)) with check (is_admin() or exists (select 1 from project_members m where m.project_id = issues.project_id and m.user_id = auth.uid() and m.role = write));

-- dependencies: no project_id column; resolve it via the owning issue
create policy dependencies_select on dependencies for select to authenticated using (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid()));
create policy dependencies_write on dependencies for all to authenticated using (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid() and m.role = write)) with check (is_admin() or exists (select 1 from issues i join project_members m on m.project_id = i.project_id where i.id = dependencies.issue_id and m.user_id = auth.uid() and m.role = write));

-- project_members: admin manages all; a user may read only their own rows
create policy members_select on project_members for select to authenticated using (is_admin() or user_id = auth.uid());
create policy members_write on project_members for all to authenticated using (is_admin()) with check (is_admin());
```

- [ ] **Step 2: Run migration in Supabase SQL editor**

Expected: all `drop`/`create policy` statements succeed, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-access.sql
git commit -m "feat: membership-aware RLS policies for all tables"
```

---

## Task 3: Admin bootstrap script

**Files:**
- Create: `scripts/set-admin.mjs`

- [ ] **Step 1: Write the script**

Uses the service_role key (per CLAUDE.md, secret keys work from `node_modules` supabase-js). Reads target email from argv.

```js
// scripts/set-admin.mjs — mark a user as global admin.
// Usage: node scripts/set-admin.mjs you@example.com
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()

const email = process.argv[2]
if (!email) { console.error('Usage: node scripts/set-admin.mjs <email>'); process.exit(1) }

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data, error } = await supabase.auth.admin.listUsers()
if (error) { console.error(error.message); process.exit(1) }
const user = data.users.find((u) => u.email === email)
if (!user) { console.error(`No user with email ${email}`); process.exit(1) }

const { error: upErr } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: 'admin' },
})
if (upErr) { console.error(upErr.message); process.exit(1) }
console.log(`OK: ${email} is now admin`)
```

- [ ] **Step 2: Add `VITE_SUPABASE_SERVICE_ROLE_KEY` to `.env`**

Add the service_role key (from Supabase → Project Settings → API) to your local `.env`. It must NOT be prefixed in a way Vite bundles it — it's only read by Node scripts here. Do not import it anywhere under `src/`.

- [ ] **Step 3: Run it against your account**

Run: `node scripts/set-admin.mjs <your-login-email>`
Expected: `OK: <email> is now admin`

- [ ] **Step 4: Commit**

```bash
git add scripts/set-admin.mjs
git commit -m "feat: script to promote a user to global admin"
```

---

## Task 4: RLS integration verification script

**Files:**
- Create: `scripts/test-rls.mjs`

This is a **manual live-DB check**, not a Vitest test (RLS only exists in Postgres). It signs in as three accounts using the anon key and asserts what each can see/do.

- [ ] **Step 1: Pre-create test accounts**

In the Supabase dashboard (or via `set-admin.mjs`-style script), ensure three accounts exist: your admin account, `writer@test.local`, `reader@test.local` (any passwords). Create one project `P-TEST` (as admin, from the app), then insert membership manually:
- `writer@test.local` → `P-TEST` role `write`
- `reader@test.local` → `P-TEST` role `read`
Also create a second project `P-SECRET` with NO members besides admin.

- [ ] **Step 2: Write the check script**

```js
// scripts/test-rls.mjs — verify RLS isolation with 3 live accounts.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY

async function as(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return c
}

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } else console.log('ok:', msg) }

const reader = await as('reader@test.local', process.env.TEST_READER_PW)
const writer = await as('writer@test.local', process.env.TEST_WRITER_PW)

// reader sees P-TEST, not P-SECRET
const rProjects = (await reader.from('projects').select('id')).data ?? []
assert(rProjects.some((p) => p.id === 'p-test'), 'reader sees P-TEST')
assert(!rProjects.some((p) => p.id === 'p-secret'), 'reader cannot see P-SECRET')

// reader cannot write an issue to P-TEST
const rIns = await reader.from('issues').insert({ id: 'x-reader-1', project_id: 'p-test', title: 'nope', wave: 1 })
assert(rIns.error !== null, 'reader blocked from inserting issue')

// writer CAN write an issue to P-TEST
const wIns = await writer.from('issues').insert({ id: 'x-writer-1', project_id: 'p-test', title: 'ok', wave: 1 })
assert(wIns.error === null, 'writer can insert issue into P-TEST')

// writer cannot touch P-SECRET
const wSecret = await writer.from('issues').insert({ id: 'x-writer-2', project_id: 'p-secret', title: 'nope', wave: 1 })
assert(wSecret.error !== null, 'writer blocked from P-SECRET')

console.log('done')
```

- [ ] **Step 3: Run it**

Run: `node scripts/test-rls.mjs` (with `TEST_READER_PW` / `TEST_WRITER_PW` in `.env`).
Expected: all lines prefixed `ok:`, final `done`, exit code 0. If any `FAIL:` appears, fix the policy in `migration-access.sql` and re-run the migration before continuing.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-rls.mjs
git commit -m "test: live RLS isolation check for read/write/admin"
```

---

## Task 5: Pure client helpers — `access.ts` (TDD)

**Files:**
- Create: `src/lib/access.ts`
- Test: `src/lib/access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { isAdminSession, buildAccessMap } from './access'

describe('isAdminSession', () => {
  it('true when app_metadata.role is admin', () => {
    const session = { user: { app_metadata: { role: 'admin' } } } as never
    expect(isAdminSession(session)).toBe(true)
  })
  it('false when role missing or not admin', () => {
    expect(isAdminSession({ user: { app_metadata: {} } } as never)).toBe(false)
    expect(isAdminSession(null)).toBe(false)
  })
})

describe('buildAccessMap', () => {
  it('maps project_id to role', () => {
    const rows = [
      { project_id: 'a', role: 'read' as const },
      { project_id: 'b', role: 'write' as const },
    ]
    expect(buildAccessMap(rows)).toEqual({ a: 'read', b: 'write' })
  })
  it('returns empty object for empty input', () => {
    expect(buildAccessMap([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/access.test.ts`
Expected: FAIL — `access.ts` does not exist / exports undefined.

- [ ] **Step 3: Implement**

```ts
import type { Session } from '@supabase/supabase-js'

export type ProjectRole = 'read' | 'write'
export type AccessMap = Record<string, ProjectRole>

export function isAdminSession(session: Session | null): boolean {
  return session?.user?.app_metadata?.role === 'admin'
}

export function buildAccessMap(
  rows: { project_id: string; role: ProjectRole }[],
): AccessMap {
  const map: AccessMap = {}
  for (const r of rows) map[r.project_id] = r.role
  return map
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/access.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/access.ts src/lib/access.test.ts
git commit -m "feat: pure access helpers (isAdminSession, buildAccessMap)"
```

---

## Task 6: Extend `useAuth` with `isAdmin` + `access`

**Files:**
- Modify: `src/auth.tsx`

- [ ] **Step 1: Extend the `AuthState` interface**

In `src/auth.tsx`, add to the `AuthState` interface (after `loading`):

```ts
  /** True when the signed-in user is the global admin. */
  isAdmin: boolean
  /** projectId -> role for the signed-in user (empty for admin). */
  access: import('./lib/access').AccessMap
```

- [ ] **Step 2: Load membership on session change**

In `AuthProvider`, add imports at the top:

```ts
import { supabase } from './lib/supabase'
import { isAdminSession, buildAccessMap, type AccessMap } from './lib/access'
```

Add state and an effect that loads membership whenever the session changes:

```ts
  const [access, setAccess] = useState<AccessMap>({})
  const isAdmin = isAdminSession(session)

  useEffect(() => {
    if (!supabase || !session || isAdmin) {
      setAccess({})
      return
    }
    supabase
      .from('project_members')
      .select('project_id, role')
      .then(({ data }) => setAccess(buildAccessMap(data ?? [])))
  }, [session, isAdmin])
```

- [ ] **Step 3: Expose in the context value**

Add `isAdmin` and `access` to the `useMemo` value object, and add them to the dependency array:

```ts
  const value = useMemo<AuthState>(
    () => ({
      enabled,
      session,
      loading,
      isAdmin,
      access,
      async signIn(email, password) { /* unchanged */ },
      async signOut() { /* unchanged */ },
    }),
    [enabled, session, loading, isAdmin, access],
  )
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/auth.tsx
git commit -m "feat: expose isAdmin and per-project access from useAuth"
```

---

## Task 7: Edge Function — `admin-users`

**Files:**
- Create: `supabase/functions/admin-users/index.ts`

This runs in Deno on Supabase; it is verified manually (deploy + invoke), not via Vitest.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/admin-users/index.ts
// Admin-only user management. Guards on app_metadata.role === 'admin'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Guard: verify caller is an admin.
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return json({ error: 'missing token' }, 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || userData.user?.app_metadata?.role !== 'admin')
    return json({ error: 'forbidden' }, 403)

  const { action, payload } = await req.json()

  try {
    if (action === 'list_users') {
      const { data } = await admin.auth.admin.listUsers()
      const { data: members } = await admin.from('project_members').select('user_id, project_id, role')
      const users = (data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        access: (members ?? []).filter((m) => m.user_id === u.id).map((m) => ({ project_id: m.project_id, role: m.role })),
      }))
      return json({ users })
    }

    if (action === 'create_user') {
      const { email, password, access } = payload as { email: string; password: string; access: { project_id: string; role: string }[] }
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) return json({ error: error.message }, 400)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id: data.user.id, project_id: a.project_id, role: a.role }))
        const { error: mErr } = await admin.from('project_members').insert(rows)
        if (mErr) return json({ error: mErr.message }, 400)
      }
      return json({ id: data.user.id })
    }

    if (action === 'set_access') {
      const { user_id, access } = payload as { user_id: string; access: { project_id: string; role: string }[] }
      await admin.from('project_members').delete().eq('user_id', user_id)
      if (access?.length) {
        const rows = access.map((a) => ({ user_id, project_id: a.project_id, role: a.role }))
        const { error } = await admin.from('project_members').insert(rows)
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    if (action === 'reset_password') {
      const { user_id, password } = payload as { user_id: string; password: string }
      const { error } = await admin.auth.admin.updateUserById(user_id, { password })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    if (action === 'delete_user') {
      const { user_id } = payload as { user_id: string }
      const { error } = await admin.auth.admin.deleteUser(user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy admin-users`
Expected: deploy succeeds. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase for deployed functions.)

- [ ] **Step 3: Manually verify the guard**

From the running app (logged in as a NON-admin), call the function (temporarily via console) and confirm HTTP 403. Logged in as admin, call `list_users` and confirm you get a `users` array. Document the result in the commit message.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin-users/index.ts
git commit -m "feat: admin-users edge function with admin guard"
```

---

## Task 8: Client wrapper — `adminUsers.ts` (TDD)

**Files:**
- Create: `src/lib/adminUsers.ts`
- Test: `src/lib/adminUsers.test.ts`

- [ ] **Step 1: Write the failing test**

Mock `supabase.functions.invoke` and assert the wrapper sends the right `{ action, payload }` and unwraps the result / throws on error.

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

import { listUsers, createUser } from './adminUsers'

beforeEach(() => invoke.mockReset())

describe('listUsers', () => {
  it('invokes admin-users with list_users and returns users', async () => {
    invoke.mockResolvedValue({ data: { users: [{ id: '1', email: 'a@b.c', access: [] }] }, error: null })
    const users = await listUsers()
    expect(invoke).toHaveBeenCalledWith('admin-users', { body: { action: 'list_users' } })
    expect(users).toEqual([{ id: '1', email: 'a@b.c', access: [] }])
  })
  it('throws on error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(listUsers()).rejects.toThrow('boom')
  })
})

describe('createUser', () => {
  it('sends create_user with email, password, access', async () => {
    invoke.mockResolvedValue({ data: { id: 'new' }, error: null })
    const id = await createUser('a@b.c', 'pw', [{ project_id: 'p', role: 'write' }])
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'create_user', payload: { email: 'a@b.c', password: 'pw', access: [{ project_id: 'p', role: 'write' }] } },
    })
    expect(id).toBe('new')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/adminUsers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { supabase } from './supabase'
import type { ProjectRole } from './access'

export interface AccessEntry { project_id: string; role: ProjectRole }
export interface AdminUser { id: string; email: string; access: AccessEntry[] }

async function call<T>(action: string, payload?: unknown): Promise<T> {
  if (!supabase) throw new Error('Supabase indisponibil.')
  const body = payload === undefined ? { action } : { action, payload }
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in data && data.error)
    throw new Error(String((data as { error: unknown }).error))
  return data as T
}

export async function listUsers(): Promise<AdminUser[]> {
  const { users } = await call<{ users: AdminUser[] }>('list_users')
  return users
}
export async function createUser(email: string, password: string, access: AccessEntry[]): Promise<string> {
  const { id } = await call<{ id: string }>('create_user', { email, password, access })
  return id
}
export async function setAccess(user_id: string, access: AccessEntry[]): Promise<void> {
  await call('set_access', { user_id, access })
}
export async function resetPassword(user_id: string, password: string): Promise<void> {
  await call('reset_password', { user_id, password })
}
export async function deleteUser(user_id: string): Promise<void> {
  await call('delete_user', { user_id })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/adminUsers.test.ts`
Expected: PASS. Then `npm test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adminUsers.ts src/lib/adminUsers.test.ts
git commit -m "feat: typed client wrapper for admin-users function"
```

---

## Task 9: Users management screen — `UsersView.tsx`

**Files:**
- Create: `src/components/UsersView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Build `UsersView`**

A self-contained admin screen. Loads users + the admin's project list (via `useHorizontal().projects`, which for admin is all projects). Follows existing component style (see `ProjectsView.tsx`).

```tsx
import { useEffect, useState } from 'react'
import { useHorizontal } from '../store'
import {
  listUsers, createUser, setAccess, resetPassword, deleteUser,
  type AdminUser, type AccessEntry,
} from '../lib/adminUsers'
import type { ProjectRole } from '../lib/access'

export function UsersView() {
  const { projects } = useHorizontal()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<Record<string, ProjectRole | undefined>>({})

  async function reload() {
    try { setUsers(await listUsers()) } catch (e) { setError(String(e)) }
  }
  useEffect(() => { void reload() }, [])

  function draftToAccess(d: Record<string, ProjectRole | undefined>): AccessEntry[] {
    return Object.entries(d)
      .filter(([, role]) => role)
      .map(([project_id, role]) => ({ project_id, role: role as ProjectRole }))
  }

  async function onAdd() {
    setBusy(true); setError(null)
    try {
      await createUser(email, password, draftToAccess(draft))
      setEmail(''); setPassword(''); setDraft({})
      await reload()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="users-view">
      <h2>Utilizatori</h2>
      {error && <p className="error">{error}</p>}

      <section className="user-add">
        <h3>Adaugă utilizator</h3>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="parolă" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ul className="access-list">
          {projects.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <select
                value={draft[p.id] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: (e.target.value || undefined) as ProjectRole | undefined }))}
              >
                <option value="">— fără acces —</option>
                <option value="read">read</option>
                <option value="write">write</option>
              </select>
            </li>
          ))}
        </ul>
        <button disabled={busy || !email || !password} onClick={onAdd}>Creează</button>
      </section>

      <section className="user-list">
        <h3>Utilizatori existenți</h3>
        {users.map((u) => (
          <UserRow key={u.id} user={u} projects={projects} onChanged={reload} onError={setError} />
        ))}
      </section>
    </div>
  )
}

function UserRow({
  user, projects, onChanged, onError,
}: {
  user: AdminUser
  projects: { id: string; name: string }[]
  onChanged: () => Promise<void>
  onError: (m: string) => void
}) {
  const current: Record<string, ProjectRole> = {}
  for (const a of user.access) current[a.project_id] = a.role
  const [draft, setDraft] = useState<Record<string, ProjectRole | undefined>>(current)

  async function save() {
    try {
      const access: AccessEntry[] = Object.entries(draft)
        .filter(([, r]) => r)
        .map(([project_id, r]) => ({ project_id, role: r as ProjectRole }))
      await setAccess(user.id, access)
      await onChanged()
    } catch (e) { onError(String(e)) }
  }
  async function resetPw() {
    const pw = prompt(`Parolă nouă pentru ${user.email}`)
    if (!pw) return
    try { await resetPassword(user.id, pw); alert('Parolă schimbată') } catch (e) { onError(String(e)) }
  }
  async function remove() {
    if (!confirm(`Ștergi ${user.email}?`)) return
    try { await deleteUser(user.id); await onChanged() } catch (e) { onError(String(e)) }
  }

  return (
    <div className="user-row">
      <strong>{user.email}</strong>
      <ul className="access-list">
        {projects.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <select
              value={draft[p.id] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: (e.target.value || undefined) as ProjectRole | undefined }))}
            >
              <option value="">— fără —</option>
              <option value="read">read</option>
              <option value="write">write</option>
            </select>
          </li>
        ))}
      </ul>
      <div className="user-actions">
        <button onClick={save}>Salvează acces</button>
        <button onClick={resetPw}>Reset parolă</button>
        <button onClick={remove}>Șterge</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire an admin-only entry point in `App.tsx`**

In `src/App.tsx`, import `useAuth` (already imported) and `UsersView`. Add a state-driven view toggle in `Shell` — e.g. a button in the sidebar/header shown only when `isAdmin`, and render `UsersView` when active. Minimal wiring:

```tsx
import { UsersView } from './components/UsersView'
// inside Shell():
const { isAdmin } = useAuth()
const [showUsers, setShowUsers] = useState(false)
// in the header/sidebar controls, admin only:
{isAdmin && (
  <button className="users-btn" onClick={() => setShowUsers((v) => !v)} aria-label="Utilizatori">
    Utilizatori
  </button>
)}
// in the main content area, before the normal project views:
{showUsers && isAdmin ? <UsersView /> : (/* existing project/detail rendering */)}
```

- [ ] **Step 3: Typecheck + run**

Run: `npm run typecheck` (expect no errors), then `npm run dev` and confirm as admin you see the "Utilizatori" button and screen; as a non-admin the button is absent.

- [ ] **Step 4: Commit**

```bash
git add src/components/UsersView.tsx src/App.tsx
git commit -m "feat: admin-only Utilizatori management screen"
```

---

## Task 10: Read-only gating in the UI

**Files:**
- Modify: `src/App.tsx` (or the components rendering edit controls — `ProjectDetail`, issue/wave/theme editors)

- [ ] **Step 1: Derive a `canWrite` helper for the selected project**

Where a project is selected, compute write permission from `useAuth`:

```tsx
const { isAdmin, access } = useAuth()
const { project } = useHorizontal()
const canWrite = isAdmin || (project ? access[project.id] === 'write' : false)
```

- [ ] **Step 2: Gate edit affordances**

Pass `canWrite` down and hide/disable create/edit/delete/toggle-done controls when `!canWrite`. For example, guard the "new issue" button and `toggleDone` call sites:

```tsx
{canWrite && <button onClick={openNewIssue}>Tichet nou</button>}
// and in handlers:
if (!canWrite) return
```

Also gate the keyboard shortcuts that mutate (`C` new ticket, `Ctrl+S` save, toggle done) behind `canWrite`.

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Sign in as `reader@test.local`: confirm the project opens but all edit buttons are gone/disabled and mutating shortcuts do nothing. Sign in as `writer@test.local`: confirm editing works. (RLS already blocks writes server-side; this is UX.)

- [ ] **Step 4: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: hide edit controls for read-only project members"
```

---

## Task 11: Docs + env

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (Supabase section) — note the new migration + edge function

- [ ] **Step 1: Update `.env.example`**

Add commented guidance (do NOT put real secrets):

```
# Service role key — used ONLY by Node scripts in scripts/ (set-admin, test-rls).
# NEVER import this under src/ and never expose it to the client bundle.
# VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Test account passwords for scripts/test-rls.mjs
# TEST_READER_PW=
# TEST_WRITER_PW=
```

- [ ] **Step 2: Add a short note to `CLAUDE.md`**

Under the Supabase section, note: run `supabase/migration-access.sql` once; deploy `admin-users` edge function; promote your account with `node scripts/set-admin.mjs <email>`.

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document multi-user access setup and env vars"
```

---

## Self-Review Notes

- **Spec coverage:** project_members (T1) ✓, is_admin + RLS incl. dependencies join (T1–T2) ✓, single global admin (T3) ✓, edge function all 5 actions (T7) ✓, useAuth isAdmin+access (T5–T6) ✓, project filtering via RLS — no client code needed, relies on existing store `listProjects()` (T2) ✓, read-only gating (T10) ✓, Users screen add/edit/reset/delete (T9) ✓, RLS + 403 tests (T4, T7-step3) ✓.
- **Type consistency:** `ProjectRole` / `AccessEntry` / `AccessMap` / `AdminUser` defined once in `access.ts`/`adminUsers.ts` and reused everywhere. `buildAccessMap` signature matches `project_members` select shape.
- **YAGNI honored:** no self sign-up, no invitations, no per-project admins, no audit log.
- **Known limitation (called out, not a gap):** RLS and the Edge Function are verified via live scripts/manual steps, not Vitest, because they don't execute in the JS test runtime.
