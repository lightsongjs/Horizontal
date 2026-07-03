# Horizontal Tickets API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `GET /api/tickets` (lookup/list) and `POST /api/tickets` (create) as Cloudflare Pages Functions with API key auth, and add `ai-client.mjs` to ticket-kit so AI agents can find and create tickets by title.

**Architecture:** `functions/api/_middleware.ts` checks `X-API-Key` before every `/api/*` request. `functions/api/tickets.ts` handles GET and POST by calling the Supabase REST API via native `fetch()` (no Node.js, no supabase-js in edge context). `ticket-kit/ai-client.mjs` is a thin CLI wrapper that reads `HORIZONTAL_API_URL` + `HORIZONTAL_API_KEY` from the project's `.env` and calls the endpoints.

**Tech Stack:** Cloudflare Pages Functions (TypeScript, V8, fetch-based), Supabase REST API (PostgREST + service role key), @cloudflare/workers-types (dev), Node.js 18+ ESM for ticket-kit client.

**Spec:** `docs/superpowers/specs/2026-07-03-horizontal-tickets-api-design.md`

---

## File Map

**Create:**
- `functions/api/_middleware.ts` — API key auth for all /api/* routes
- `functions/api/tickets.ts` — GET (lookup + list) + POST (create)
- `functions/tsconfig.json` — TypeScript config scoped to functions/ (Service Worker lib)
- `ticket-kit/ai-client.mjs` — CLI for AI agents: --lookup, --create, --list

**Modify:**
- `package.json` — add `@cloudflare/workers-types` to devDependencies
- `ticket-kit/.env.example` — add `HORIZONTAL_API_URL` + `HORIZONTAL_API_KEY`
- `ticket-kit/README.md` — add "Utilizare cu AI" section

---

## Task 1: Dev dependency + TypeScript config for functions/

**Files:**
- Modify: `package.json`
- Create: `functions/tsconfig.json`

- [ ] **Step 1: Install @cloudflare/workers-types**

```bash
npm install --save-dev @cloudflare/workers-types
```

Expected: package added to devDependencies, no errors.

- [ ] **Step 2: Create functions/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["."]
}
```

> **De ce tsconfig separat:** app-ul folosește `"lib": ["DOM"]` și `"types": ["vitest/globals"]`. Functions rulează în V8 (nu browser) și au nevoie de tipurile Cloudflare. Cele două medii sunt incompatibile — tsconfig-uri separate le izolează.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json functions/tsconfig.json
git commit -m "chore: add @cloudflare/workers-types and functions tsconfig"
```

---

## Task 2: Auth middleware

**Files:**
- Create: `functions/api/_middleware.ts`
- Create: `functions/api/_middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/api/_middleware.test.ts
import { describe, it, expect } from 'vitest'

export function isValidKey(provided: string | null, expected: string): boolean {
  return provided !== null && provided === expected
}

describe('isValidKey', () => {
  it('accepts matching key', () => expect(isValidKey('abc123', 'abc123')).toBe(true))
  it('rejects wrong key', () => expect(isValidKey('wrong', 'abc123')).toBe(false))
  it('rejects empty string', () => expect(isValidKey('', 'abc123')).toBe(false))
  it('rejects null', () => expect(isValidKey(null, 'abc123')).toBe(false))
})
```

> Nota: exportăm `isValidKey` din fișierul de test ca să nu dublăm logica — middleware-ul o va importa.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose functions/api/_middleware.test.ts
```

Expected: FAIL — `isValidKey is not a function` (nu există încă în middleware).

> Dacă testul trece deja (vitest găsește funcția exportată din test), e ok — înseamnă că testul compilează. Treci la pasul următor.

- [ ] **Step 3: Create the middleware**

```typescript
// functions/api/_middleware.ts
export function isValidKey(provided: string | null, expected: string): boolean {
  return provided !== null && provided === expected
}

interface Env {
  TICKETS_API_KEY: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const provided = context.request.headers.get('X-API-Key')
  if (!isValidKey(provided, context.env.TICKETS_API_KEY)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return context.next()
}
```

- [ ] **Step 4: Update test to import from middleware**

```typescript
// functions/api/_middleware.test.ts
import { describe, it, expect } from 'vitest'
import { isValidKey } from './_middleware'

describe('isValidKey', () => {
  it('accepts matching key', () => expect(isValidKey('abc123', 'abc123')).toBe(true))
  it('rejects wrong key', () => expect(isValidKey('wrong', 'abc123')).toBe(false))
  it('rejects empty string', () => expect(isValidKey('', 'abc123')).toBe(false))
  it('rejects null', () => expect(isValidKey(null, 'abc123')).toBe(false))
})
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --reporter=verbose functions/api/_middleware.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/_middleware.ts functions/api/_middleware.test.ts
git commit -m "feat: add API key auth middleware for /api/* routes"
```

---

## Task 3: GET /api/tickets handler (lookup + list)

**Files:**
- Create: `functions/api/tickets.ts`

- [ ] **Step 1: Create the GET handler**

```typescript
// functions/api/tickets.ts

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

interface SupabaseIssue {
  id: string
  title: string
  wave: number
  done: boolean
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const project = url.searchParams.get('project')?.toLowerCase()
  const title = url.searchParams.get('title')
  const waveParam = url.searchParams.get('wave')

  if (!project) {
    return Response.json({ error: 'missing_params', required: ['project'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  // LIST mode: no title param — return all tickets for project, optionally filtered by wave
  if (!title) {
    let filter = `project_id=eq.${project}`
    if (waveParam) {
      const waveNum = Number(waveParam)
      if (!Number.isInteger(waveNum) || waveNum < 1) {
        return Response.json({ error: 'invalid_wave' }, { status: 400 })
      }
      filter += `&wave=eq.${waveNum}`
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?${filter}&select=id,title,wave,done&order=id.asc`,
      { headers }
    )
    const data = await res.json() as SupabaseIssue[]
    return Response.json(data)
  }

  // LOOKUP mode: title provided — return single ticket or 404
  if (!waveParam) {
    return Response.json({ error: 'missing_params', required: ['project', 'title', 'wave'] }, { status: 400 })
  }
  const waveNum = Number(waveParam)
  if (!Number.isInteger(waveNum) || waveNum < 1) {
    return Response.json({ error: 'invalid_wave' }, { status: 400 })
  }

  const encoded = encodeURIComponent(title)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${project}&title=ilike.${encoded}&wave=eq.${waveNum}&select=id,title,wave,done&limit=1`,
    { headers }
  )
  const data = await res.json() as SupabaseIssue[]

  if (!data.length) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json(data[0])
}
```

> **De ce `ilike` fără wildcards:** în PostgREST, `ilike.Setup DB` (fără `%`) este exact match case-insensitive — același comportament cu `ILIKE 'Setup DB'` în PostgreSQL.

- [ ] **Step 2: Commit**

```bash
git add functions/api/tickets.ts
git commit -m "feat: add GET /api/tickets handler (lookup + list)"
```

---

## Task 4: POST /api/tickets handler (create)

**Files:**
- Modify: `functions/api/tickets.ts`

- [ ] **Step 1: Add POST handler to tickets.ts**

Adaugă după `onRequestGet` în același fișier:

```typescript
interface CreateBody {
  projectId: string
  title: string
  wave: number
  deps?: string[]
  theme?: string | null
  desc?: string
  notes?: string
  assigneeId?: string | null
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: CreateBody
  try {
    body = await context.request.json() as CreateBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { projectId, title, wave } = body
  const deps = body.deps ?? []

  if (!projectId || !title || !wave) {
    return Response.json({ error: 'missing_fields', required: ['projectId', 'title', 'wave'] }, { status: 400 })
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const pid = projectId.toLowerCase()

  // 1. Validate deps exist
  if (deps.length > 0) {
    const depsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/issues?id=in.(${deps.join(',')})&select=id`,
      { headers }
    )
    const existing = await depsRes.json() as Array<{ id: string }>
    const existingIds = new Set(existing.map(d => d.id))
    const unknown = deps.filter(d => !existingIds.has(d))
    if (unknown.length > 0) {
      return Response.json({ error: 'invalid_deps', unknown }, { status: 422 })
    }
  }

  // 2. Get project prefix
  const projRes = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?id=eq.${pid}&select=prefix`,
    { headers }
  )
  const projects = await projRes.json() as Array<{ prefix: string }>
  if (!projects.length) {
    return Response.json({ error: 'project_not_found' }, { status: 404 })
  }
  const prefix = projects[0].prefix

  // 3. Compute next ID
  const issuesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&select=id`,
    { headers }
  )
  const existingIssues = await issuesRes.json() as Array<{ id: string }>
  const maxNum = existingIssues
    .map(r => Number(r.id.slice(prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  const newId = `${prefix}-${String(maxNum + 1).padStart(2, '0')}`

  // 4. Check for duplicate title in same wave
  const encoded = encodeURIComponent(title)
  const dupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?project_id=eq.${pid}&title=ilike.${encoded}&wave=eq.${wave}&select=id&limit=1`,
    { headers }
  )
  const dups = await dupRes.json() as Array<{ id: string }>
  if (dups.length > 0) {
    return Response.json({ error: 'duplicate_title', existing_id: dups[0].id }, { status: 409 })
  }

  // 5. Insert issue
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: newId,
      project_id: pid,
      title,
      details: body.desc ?? '',
      theme: body.theme ?? null,
      wave: Number(wave),
      done: false,
      selectors: [],
      scenarios: [],
      notes: body.notes ?? '',
      assignee_id: body.assigneeId ?? null,
    }),
  })
  if (!insertRes.ok) {
    const err = await insertRes.json()
    return Response.json({ error: 'insert_failed', detail: err }, { status: 500 })
  }

  // 6. Insert dependencies
  if (deps.length > 0) {
    const depsInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/dependencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deps.map(depId => ({ issue_id: newId, depends_on_id: depId }))),
    })
    if (!depsInsertRes.ok) {
      const err = await depsInsertRes.json()
      return Response.json({ error: 'deps_insert_failed', detail: err }, { status: 500 })
    }
  }

  return Response.json({ id: newId, title, wave: Number(wave), deps }, { status: 201 })
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/tickets.ts
git commit -m "feat: add POST /api/tickets handler (create with deps)"
```

---

## Task 5: ticket-kit/ai-client.mjs

**Files:**
- Create: `ticket-kit/ai-client.mjs`

- [ ] **Step 1: Create ai-client.mjs**

```javascript
// ticket-kit/ai-client.mjs
import { config } from 'dotenv'
config({ path: '../.env' })

const API_URL = process.env.HORIZONTAL_API_URL?.replace(/\/$/, '')
const API_KEY = process.env.HORIZONTAL_API_KEY

if (!API_URL || !API_KEY) {
  console.error('Missing HORIZONTAL_API_URL or HORIZONTAL_API_KEY in .env')
  process.exit(1)
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const data = await res.json()
  return { status: res.status, data }
}

const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1] ?? true
}

// --lookup --project KATA --title "Setup DB" --wave 1
// Prints: KATA-03   OR   not_found
async function lookup() {
  const { project, title, wave } = flags
  if (!project || !title || !wave) {
    console.error('Usage: --lookup --project <id> --title "<title>" --wave <n>')
    process.exit(1)
  }
  const params = new URLSearchParams({ project, title, wave: String(wave) })
  const { status, data } = await apiFetch(`/api/tickets?${params}`)
  if (status === 200) {
    console.log(data.id)
  } else if (status === 404) {
    console.log('not_found')
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

// --create --project kata --title "Auth flow" --wave 1 --deps KATA-03,KATA-04
// Prints: KATA-05   OR   duplicate: KATA-03
async function create() {
  const { project, title, wave, deps, theme, desc, notes } = flags
  if (!project || !title || !wave) {
    console.error('Usage: --create --project <id> --title "<title>" --wave <n> [--deps ID1,ID2] [--theme key] [--desc "..."] [--notes "..."]')
    process.exit(1)
  }
  const { status, data } = await apiFetch('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project,
      title,
      wave: Number(wave),
      deps: deps ? String(deps).split(',').map(s => s.trim()).filter(Boolean) : [],
      theme: theme ?? undefined,
      desc: desc ?? '',
      notes: notes ?? '',
    }),
  })
  if (status === 201) {
    console.log(data.id)
  } else if (status === 409) {
    console.log(`duplicate: ${data.existing_id}`)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

// --list --project KATA [--wave 1]
// Prints one line per ticket: KATA-01  [wave 1]  Setup DB
async function list() {
  const { project, wave } = flags
  if (!project) {
    console.error('Usage: --list --project <id> [--wave <n>]')
    process.exit(1)
  }
  const params = new URLSearchParams({ project })
  if (wave) params.set('wave', String(wave))
  const { status, data } = await apiFetch(`/api/tickets?${params}`)
  if (status === 200) {
    if (!data.length) {
      console.log('(no tickets found)')
    } else {
      for (const t of data) {
        console.log(`${t.id}  [wave ${t.wave}]${t.done ? ' ✓' : ''}  ${t.title}`)
      }
    }
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

if (flags.lookup !== undefined) {
  await lookup()
} else if (flags.create !== undefined) {
  await create()
} else if (flags.list !== undefined) {
  await list()
} else {
  console.error('Usage: node ai-client.mjs --lookup|--create|--list [options]')
  process.exit(1)
}
```

- [ ] **Step 2: Commit**

```bash
git add ticket-kit/ai-client.mjs
git commit -m "feat: add ai-client.mjs CLI for AI agent ticket operations"
```

---

## Task 6: Update ticket-kit docs

**Files:**
- Modify: `ticket-kit/.env.example`
- Modify: `ticket-kit/README.md`

- [ ] **Step 1: Update .env.example**

Adaugă la sfârșitul fișierului `ticket-kit/.env.example`:

```
# AI client (ai-client.mjs) — apelează HTTP API-ul Horizontal
HORIZONTAL_API_URL=https://your-horizontal-app.pages.dev
HORIZONTAL_API_KEY=
```

Fișierul complet după modificare:
```
HORIZONTAL_SUPABASE_URL=
HORIZONTAL_SUPABASE_SERVICE_ROLE_KEY=

# AI client (ai-client.mjs) — apelează HTTP API-ul Horizontal
HORIZONTAL_API_URL=https://your-horizontal-app.pages.dev
HORIZONTAL_API_KEY=
```

- [ ] **Step 2: Add AI section to README.md**

Adaugă înainte de ultima linie din `ticket-kit/README.md` (înainte de ultima linie goală):

```markdown
## Utilizare cu AI (ai-client.mjs)

`ai-client.mjs` e un CLI pentru agenți AI care vor să caute sau să creeze
tichete incremental — fără să știe de Supabase sau de credențiale DB.

Necesită în `.env`-ul de la rădăcina proiectului:
```
HORIZONTAL_API_URL=https://your-horizontal-app.pages.dev
HORIZONTAL_API_KEY=<cheia din Cloudflare env vars>
```

### Comenzi

```bash
# Caută ID-ul unui tichet după titlu
node ticket-kit/ai-client.mjs --lookup --project KATA --title "Setup DB" --wave 1
# output: KATA-03   (sau "not_found")

# Creează un tichet (deps = ID-uri reale, obținute via --lookup)
node ticket-kit/ai-client.mjs --create --project kata --title "Auth flow" --wave 1 --deps KATA-03
# output: KATA-04   (sau "duplicate: KATA-03")

# Listează toate tichetele unui proiect (opțional filtrare pe wave)
node ticket-kit/ai-client.mjs --list --project KATA --wave 1
# output: KATA-01  [wave 1]  Setup DB
#         KATA-02  [wave 1]  ...
```

### Flow tipic pentru AI

```bash
# 1. Verifică ce există
node ticket-kit/ai-client.mjs --list --project KATA --wave 1

# 2. Găsește ID-ul dependinței
node ticket-kit/ai-client.mjs --lookup --project KATA --title "Setup DB" --wave 1
# → KATA-03

# 3. Creează tichetul cu deps rezolvate
node ticket-kit/ai-client.mjs --create --project kata --title "Deploy" --wave 1 --deps KATA-03
# → KATA-05
```
```

- [ ] **Step 3: Commit**

```bash
git add ticket-kit/.env.example ticket-kit/README.md
git commit -m "docs: update ticket-kit with ai-client vars and usage"
```

---

## Task 7: Setup Cloudflare env vars (manual, la primul deploy)

- [ ] **Step 1: Generează API key**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salvează valoarea — o vei pune în Cloudflare și în `.env` local.

- [ ] **Step 2: Adaugă env vars în Cloudflare Pages**

În Cloudflare Dashboard → Pages → Horizontal → Settings → Environment Variables, adaugă:
- `TICKETS_API_KEY` = valoarea din pasul 1
- `SUPABASE_URL` = valoarea din `VITE_SUPABASE_URL` (fără prefixul VITE_)
- `SUPABASE_SERVICE_ROLE_KEY` = service role key din Supabase Dashboard

> Aceste variabile nu au prefix `VITE_` — nu ajung niciodată în JS bundle-ul din browser.

- [ ] **Step 3: Testează după deploy**

```bash
# Lookup
curl -s "https://your-app.pages.dev/api/tickets?project=tur&title=Cont+Supabase&wave=1" \
  -H "X-API-Key: <cheia>" | node -e "process.stdin.pipe(process.stdout)"

# Expected: {"id":"TUR-02","title":"Cont Supabase (DB + Auth)","wave":1,"done":false}
```

---

## Self-review

**Spec coverage:**
- ✅ GET /api/tickets?project&title&wave → lookup (Task 3)
- ✅ GET /api/tickets?project&wave → list (Task 3)
- ✅ POST /api/tickets cu projectId, title, wave, deps[] (Task 4)
- ✅ Auth middleware X-API-Key (Task 2)
- ✅ 404 not found (Task 3)
- ✅ 409 duplicate title (Task 4)
- ✅ 422 invalid deps (Task 4)
- ✅ project param case-insensitive (Tasks 3, 4 — `.toLowerCase()`)
- ✅ title case-insensitive (`ilike` fără wildcards, Tasks 3, 4)
- ✅ ai-client.mjs --lookup, --create, --list (Task 5)
- ✅ ticket-kit docs (Task 6)
- ✅ Cloudflare setup instructions (Task 7)

**Placeholder scan:** niciun TBD sau TODO în cod sau pași.

**Type consistency:** `sbHeaders()` definit o singură dată în Task 3, folosit de `onRequestPost` în Task 4 — același fișier, nicio problemă. `Env` interface definit o singură dată și reutilizat de ambii handleri în același fișier.
