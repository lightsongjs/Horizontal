# DepFlow — context for the coding agent

You are building **DepFlow**, a mobile-first project-planning tool for developers.

## Start here
1. Read `REQUIREMENTS.md` — full functional spec, build order, design tokens.
2. Read `data-model.json` — entity shapes, seed data, the layer/wave algorithm, and expected test outputs.
3. Open `prototype.html` in a browser — this is the **visual reference** for look, feel, and interactions. It is an in-memory mock; do not treat its code as the architecture.

## The one thing not to get wrong
Two independent axes on every issue:
- **Layer** = computed from dependencies, read-only ("what can I start now").
- **Wave** = manual delivery sprint ("what am I shipping now").

The "Ordine" view filters by the active wave and computes layers from that wave's issues only. But an issue's detail sheet shows ALL its dependencies across all waves, with each tagged by its wave and marked done if applicable. Cross-wave dependencies never block the wave-filtered view.

## Suggested first slice
Build through step 5 of the build order in REQUIREMENTS.md (data layer → layer/wave engine → project list → project detail tabs → Ordine tab). That alone is usable. Validate the engine against `_EXPECTED_LAYERS` in data-model.json before building UI on top of it.

## Stack notes
Mobile-first, dark theme, bottom sheets. Persistence target: Supabase fits the example. Adjust to your team's stack.

## Supabase — connection details

Pentru scripturi directe cu `pg` (nu supabase-js), folosește parametri separați ca să eviți problema cu `@` din parolă:

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
  ssl: { rejectUnauthorized: false }
})
```

> **De ce parametri separați:** parola conține `@` care sparge URL-ul de conexiune dacă e pusă în `connectionString`. Valorile sunt în `.env` sub cheile `PG_*`.

## Supabase admin operations (queries, user management)

Supabase blochează cheile `sb_secret_*` din PowerShell/curl (le detectează ca "browser"). Soluția pentru orice operație admin:

1. Scrie un script temporar în directorul proiectului:
```js
// admin-task.mjs
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
// ... operația ta aici (ex: supabase.auth.admin.createUser, supabase.from(...).select())
```
2. Rulează: `node admin-task.mjs`
3. Șterge scriptul după.

**De ce funcționează:** supabase-js din `node_modules` e recunoscut ca mediu server → cheile secret sunt acceptate.

## Multi-user access — pași de setup

1. Rulează migrarea `supabase/migration-access.sql` o singură dată în SQL editor-ul Supabase (creează `project_members`, `is_admin()` și politicile RLS conștiente de membership).
2. Deployează edge function-ul: `supabase functions deploy admin-users`.
3. Promovează-ți propriul cont la admin: `node scripts/set-admin.mjs <email>`.
4. (Opțional) Verifică izolarea RLS: `node scripts/test-rls.mjs` după ce ai creat conturile de test.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
