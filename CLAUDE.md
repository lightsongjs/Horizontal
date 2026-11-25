# DepFlow — context for the coding agent

You are building **DepFlow**, a mobile-first project-planning tool for developers.

## Push pe master = publicare în producție

**Nu există „doar commit".** Cloudflare Pages e legat de repo: orice `git push`
pe `master` publică imediat pe <https://horizontal-dyx.pages.dev>, adică pe
pagina pe care o folosește omul de pe telefon. Nu e un pas separat de deploy și
nu există mediu de test.

Consecințe practice:

- Înainte de push: `npm test`, `npm run typecheck` și — dacă s-a atins
  `src/sw.ts`, `src/pwa.ts` sau blocul VitePWA — `npm run test:upgrade`.
- Un push e singurul mod în care un service worker nou ajunge pe dispozitive.
  Funcțiile edge se deployează separat (`supabase functions deploy`), deci o
  schimbare care le atinge pe amândouă cere ambele, iar ordinea contează: mai
  întâi funcția, apoi pushul.
- Nu face push „ca să vezi dacă merge".
- Migrațiile cerute de o funcționalitate se rulează **înainte** de push (fiecare
  fișier din `docs/agent/` își spune ordinea de deploy). Testele SQL
  (`test:*-sql`) rulează pe un container Docker de unică folosință — **niciodată**
  pe producție.

## The one thing not to get wrong
Two independent axes on every issue:
- **Layer** = computed from dependencies, read-only ("what can I start now").
- **Wave** = manual delivery sprint ("what am I shipping now").

The "Ordine" view filters by the active wave and computes layers from that wave's issues only. But an issue's detail sheet shows ALL its dependencies across all waves, with each tagged by its wave and marked done if applicable. Cross-wave dependencies never block the wave-filtered view.

Specul inițial: `REQUIREMENTS.md`, `data-model.json` (`_EXPECTED_LAYERS`),
`prototype.html` / `prototype-todo.html` (mock-uri vechi, nu arhitectura).

## Reguli care țin peste tot

- **Logica pură stă în `src/lib/`, cu teste/fixtures** (dată, recurență,
  scadențe, bare, jetoane…). Nu pune logică de dată în componente.
- **O regulă scrisă în două limbi** (TS ↔ SQL ↔ Kotlin) are fixtures comune
  (`*.fixtures.json/ts`); un caz nou se adaugă acolo, nu într-un `it` separat.
  Contractele scrise de două ori (puntea Linux, pluginul Android) se schimbă
  împreună.
- **Stil**: orice `font-size` e `calc(Npx * var(--text-scale))`; „îngust” e
  `html[data-narrow]` / `useNarrow()`, nu `@media` 899/900; razele sunt doar
  `--r-s`/`--r-m`/`--r` (și 50%); iconițe din `Icon.tsx`, nu emoji. Detalii în
  `docs/agent/design.md` — **citește-l înainte de orice schimbare de stil**.
- **Istoricul trece prin `appHistory`** (`lib/historyPort.ts`), niciodată
  `window.history` direct (un test pică).
- `TaskRow` și `TicketCard` sunt `memo` și nu citesc `useUI()`.
- Android: o metodă nouă de plugin crește `API`, iar pagina verifică
  `getInfo().api >= N` înainte de apel; o schimbare în `mobile/` cere APK nou
  și `versionCode` crescut.

## Documentația pe zone — citește fișierul înainte să atingi zona

Deciziile omului, de-ce-urile și capcanele fiecărei funcționalități stau în
`docs/agent/`. Specurile complete: `docs/superpowers/specs/`.

| Zona | Fișier |
|---|---|
| Stiluri, „Senin”, bancul `design/preview.html`, rotița (fundal, text), vârsta buildului, căutarea | `docs/agent/design.md` |
| Panoul lateral (split view), panoul dublu (iframe-uri) | `docs/agent/panouri.md` |
| Sprinturile (valurile în interfață), banda de valuri, Mod Vim (`vim.tsx`, `keymap.ts`), Teme × Valuri | `docs/agent/valuri-vim-teme.md` |
| Scadențe, „Azi”/„7 zile”, web push, `sw.ts`, sunetul | `docs/agent/todo-mementouri.md` |
| Foaia rapidă, foaia de tichet (telefon), autosave, fișierele din foi | `docs/agent/foi-telefon.md` |
| Rândul de jetoane, `DescFold`, markdown (CodeMirror, tabele, `/`) | `docs/agent/formular-descriere.md` |
| Recurențe (trigger SQL), sarcini fixate, rutine | `docs/agent/recurente-fixate-rutine.md` |
| Glisare/selecție pe telefon, tab-uri și Back, sertar, filtre salvate | `docs/agent/navigare-telefon.md` |
| Obstacole, mutarea între proiecte, accesul la Notițe, coșul | `docs/agent/obstacole-mutare-acces-cos.md` |
| Firul, pasarea, „Ale mele”, `isMine`, firul în API | `docs/agent/fir-pasare.md` |
| Reîmprospătarea, listele lungi, offline (IndexedDB, coada) | `docs/agent/date-offline.md` |
| Viteza deschiderii unui tichet (măsurători, `planOpen`, preîncărcări) | `docs/agent/viteza-deschidere.md` |
| Cutia de Linux (Electron), bara de captură, mementouri | `docs/agent/linux.md` |
| APK-ul (Capacitor + Kotlin), widget-uri, bara, laptopul activ | `docs/agent/android.md` |
| Google Calendar | `docs/agent/google-calendar.md` |
| CLI-ul `tk`, ticket-kit (legacy) | `docs/agent/cli-tk.md` |

O decizie nouă a omului sau o capcană nouă se scrie în fișierul zonei, nu aici.
Aici intră doar ce se aplică peste tot.

## Mockups — fișier local, nu Artifact

Pentru orice mockup/design vizual (comparații before/after, explorare de layout):
scrie un fișier `.html` obișnuit în repo (ca `prototype.html` / `prototype-todo.html`),
deschis direct în browser. **Nu folosi tool-ul Artifact** pentru asta — omul preferă
fișierul local.

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

## Teste care cer un browser

`npm test` (vitest) nu face layout și nu are DOM real, deci nu poate vedea două
clase de regresii — amândouă au ajuns în producție o dată:

- **`npm run test:layout`** — lățimi măsurate în Chromium, pe CSS-ul real peste
  DOM-ul real (tiparul din `design/preview.html`, fără server și fără login).
  A prins bara de dependențe: al treilea tab a strivit câmpul de căutare la
  **0px** pe telefon, deci nu se putea scrie în el și nici crea un obstacol.
  Rulează-l după orice schimbare într-un rând de flex cu elemente care nu se
  micșorează (`flex-shrink: 0`).
- **`npm run test:nav`** — pornește singur `vite` pe backendul local și verifică
  în browser că o foaie deschisă nu urmează userul între taburi. A prins un
  tichet docat în panoul lateral al „Listei" care sărea ca modal peste „Cards".
  Rulează-l după orice atingere a stivei de foi, a `SplitView` sau a navigării.
  Tot el păzește și reîmprospătarea: verifică, printr-un `MutationObserver` pus
  ÎNAINTE de click, că o reîncărcare n-a golit `<main>` și n-a scos `.split-pane`
  din DOM măcar o randare. Un `waitForTimeout` n-ar prinde asta — clipirea poate
  dura un singur cadru. Și, în file curate (istoricul celorlalte teste ar falsifica
  un `back()`), că o sarcină deschisă din „Azi" rămâne pe „Azi" peste o repornire
  și peste ștergere, și că ștergerea nu redeschide tichetul vizitat înainte.

Amândouă sunt lente (pornesc un browser), deci nu sunt în `npm test`. Bancul de
probă din `design/preview.html` rămâne pentru CULOARE; astea două sunt pentru
GEOMETRIE și NAVIGARE — un banc nu poate arăta un control strivit la zero.

**`src/styles.css` are un BOM UTF-8** (salvat cândva de un editor Windows).
`design/build-preview.py` nu-l vede — folosește o foaie externă, unde BOM-ul e
inofensiv. Un test nou care injectează CSS-ul **inline** într-un `<style>` (ca
`scripts/test-layout.mjs`) nu are același noroc: BOM-ul ajunge text la începutul
blocului și invalidează prima regulă — care e `:root`, adică toate jetoanele de
culoare dintr-o singură lovitură. `test-layout.mjs` îl taie explicit
(`.replace(/^﻿/, '')`); orice test nou cu același tipar trebuie să facă la
fel, altfel pică tăcut pe „toate culorile sunt negru" în loc de eroare clară.

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

@TICKETING.md
