// cli/lib.mjs — partea pură a lui `tk`: argumentele, configurația, legătura
// cu proiectul (`.horizontal`), textele generate și corpurile cererilor.
// Fără rețea și fără scrieri pe disc aici (citirile trec prin `fs` dat ca
// parametru), ca testele să nu aibă nevoie de nimic din afară.

import { join, dirname, resolve, relative, isAbsolute } from 'node:path'

export const DEFAULT_API_URL = 'https://horizontal-dyx.pages.dev'
export const PROJECT_FILE = '.horizontal'
export const TICKETING_FILE = 'TICKETING.md'
export const CLAUDE_IMPORT = '@TICKETING.md'

export class UsageError extends Error {}

// ── Argumentele ──────────────────────────────────────────────────────────────

/** Flaguri fără valoare obligatorie: `--urgent` = true, `--urgent false` merge și el. */
const BOOL_FLAGS = new Set(['urgent', 'done', 'pin', 'json', 'help', 'no-check', 'force'])
/** Flaguri care se pot repeta; se strâng într-o listă. */
const MULTI_FLAGS = new Set(['file', 'attach'])

/** Numele scurte și cele vechi (ai-client) duc la aceeași comandă. */
export const COMMAND_ALIASES = {
  ls: 'list',
  rm: 'delete',
  people: 'assignees',
  show: 'get',
  config: 'login',
  'create-theme': 'theme-create',
  'update-theme': 'theme-update',
  'create-wave': 'wave-create',
  'update-wave': 'wave-update',
  'create-project': 'project-create',
  thread: 'comments',
  me: 'whoami',
}

export const COMMANDS = [
  'help', 'guide', 'login', 'init', 'status',
  'projects', 'project-create', 'waves', 'assignees', 'themes',
  'list', 'lookup', 'get', 'create', 'update', 'delete',
  'attach', 'attachments', 'comments', 'comment', 'whoami',
  'theme-create', 'theme-update', 'wave-create', 'wave-update',
]

function canonical(name) {
  const c = COMMAND_ALIASES[name] ?? name
  return COMMANDS.includes(c) ? c : null
}

/**
 * `tk create "Titlu" --deps A,B --urgent` → { cmd, positional, flags }.
 * Acceptă și forma veche, `tk --create --project x --title "…"`: primul
 * `--<comandă>` cunoscut devine comanda. `--a=b` merge ca `--a b`.
 * Un șir gol e o valoare (`--deps ""` golește), nu o lipsă.
 */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  let cmd = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { positional.push(...argv.slice(i + 1)); break }
    if (!a.startsWith('--') || a === '--') {
      if (cmd === null && positional.length === 0 && canonical(a)) cmd = canonical(a)
      else if (cmd === null && positional.length === 0 && a === '-h') cmd = 'help'
      else positional.push(a)
      continue
    }
    let name = a.slice(2)
    let value
    const eq = name.indexOf('=')
    if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq) }
    // Forma veche: `--create`, `--list`… fără valoare, în locul comenzii.
    if (cmd === null && value === undefined && canonical(name) && !BOOL_FLAGS.has(name) && name !== 'project') {
      cmd = canonical(name)
      continue
    }
    if (value === undefined) {
      const next = argv[i + 1]
      if (BOOL_FLAGS.has(name)) {
        if (next === 'true' || next === 'false') { value = next; i++ } else value = true
      } else {
        if (next === undefined || (next.startsWith('--') && next.length > 2)) {
          throw new UsageError(`--${name} cere o valoare`)
        }
        value = next
        i++
      }
    }
    if (BOOL_FLAGS.has(name)) {
      if (value === true || value === 'true') value = true
      else if (value === 'false') value = false
      else throw new UsageError(`--${name} e true sau false`)
    }
    if (MULTI_FLAGS.has(name)) (flags[name] ??= []).push(value)
    else flags[name] = value
  }
  return { cmd: cmd ?? (flags.help ? 'help' : null), positional, flags }
}

/** `A, B,,C` → ['A','B','C']; șirul gol → [] (golește). */
export function splitList(v) {
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}

function waveNumber(v, name = 'wave') {
  const n = Number(v)
  if (v === '' || !Number.isInteger(n) || n < 0) throw new UsageError(`--${name} e un număr întreg ≥ 0`)
  return n
}

function jsonFlag(flags, name) {
  try { return JSON.parse(flags[name]) } catch { throw new UsageError(`--${name} trebuie să fie JSON valid`) }
}

/** Titlul vine pozițional (`tk create "Titlu"`) sau, ca înainte, din `--title`. */
export function titleFrom(positional, flags) {
  const t = flags.title ?? positional.join(' ')
  return typeof t === 'string' ? t.trim() : ''
}

/** Corpul pentru POST /api/tickets. `wave` lipsă = valul activ, pus de apelant. */
export function buildCreateBody({ projectId, title, wave, flags, author = null }) {
  if (!title) throw new UsageError('lipsește titlul: tk create "Titlu"')
  const body = {
    projectId,
    title,
    wave: waveNumber(wave),
    deps: flags.deps !== undefined ? splitList(flags.deps) : [],
    desc: flags.desc ?? '',
    notes: flags.notes ?? '',
    assigneeId: flags.assignee ? String(flags.assignee) : null,
  }
  if (flags.theme !== undefined) body.theme = flags.theme
  if (flags.due !== undefined) body.due = String(flags.due)
  if (flags.urgent !== undefined) body.urgent = flags.urgent
  if (author) body.author = author
  return body
}

/**
 * Corpul pentru PATCH /api/tickets/<id>: numai câmpurile date. `--project`
 * (sau `--move-to`) MUTĂ tichetul — la `update` id-ul spune deja proiectul.
 */
export function buildUpdateBody(flags, positional = []) {
  const body = {}
  if (flags.title !== undefined) body.title = flags.title
  else if (positional.length) body.title = positional.join(' ')
  if (flags.desc !== undefined) body.desc = flags.desc
  if (flags.notes !== undefined) body.notes = flags.notes
  if (flags.theme !== undefined) body.theme = flags.theme
  if (flags.wave !== undefined) body.wave = waveNumber(flags.wave)
  if (flags.done !== undefined) body.done = flags.done
  const target = flags['move-to'] ?? flags.project
  if (target !== undefined) {
    if (!target) throw new UsageError('--project/--move-to cere proiectul țintă')
    body.projectId = String(target)
  }
  if (flags.deps !== undefined) body.deps = splitList(flags.deps)
  if (flags.assignee !== undefined) body.assigneeId = flags.assignee ? String(flags.assignee) : null
  if (flags.due !== undefined) body.due = String(flags.due)
  if (flags.urgent !== undefined) body.urgent = flags.urgent
  if (flags.pin !== undefined) body.pinned = flags.pin
  if (flags.selectors !== undefined) body.selectors = jsonFlag(flags, 'selectors')
  if (flags.scenarios !== undefined) body.scenarios = jsonFlag(flags, 'scenarios')
  if (!Object.keys(body).length) {
    throw new UsageError('nimic de schimbat: --title, --desc, --notes, --wave, --done, --deps, --theme, --assignee, --due, --urgent, --pin, --project, --selectors, --scenarios')
  }
  return body
}

/**
 * Corpul pentru POST /api/tickets/<id>/comments. `--to` (chiar gol) pasează
 * tichetul în același gest: `--to ""` = înapoi la creator. `attachmentIds`
 * le pune apelantul, după urcare.
 */
export function buildCommentBody(text, flags, author, attachmentIds = []) {
  if (!author) throw new UsageError(NO_AUTHOR)
  const body = { author, body: String(text ?? '') }
  if (flags.to !== undefined) body.to = flags.to === true ? '' : String(flags.to)
  if (attachmentIds.length) body.attachmentIds = attachmentIds
  return body
}

/** Comentariul are ce scrie? (text, fișiere sau o pasă) */
export function commentHasContent(text, flags) {
  return String(text ?? '').trim() !== '' || (flags.attach?.length ?? 0) > 0 || flags.to !== undefined
}

// ── Configurația ─────────────────────────────────────────────────────────────

/** `$XDG_CONFIG_HOME/horizontal/config.json`, altfel `~/.config/horizontal/config.json`. */
export function configPath(env, home) {
  const base = env.XDG_CONFIG_HOME || join(home, '.config')
  return join(base, 'horizontal', 'config.json')
}

/**
 * Mediul bate fișierul, câmp cu câmp. `source` spune de unde vine fiecare (fără cheie).
 * `me` = omul de pe calculatorul ăsta (`{ id, name }` din `tk whoami --set`,
 * sau `HORIZONTAL_ME` = nume/id): în numele lui scrie tk comentariile.
 */
export function resolveConfig(env, file) {
  const f = file ?? {}
  const apiUrl = env.HORIZONTAL_API_URL || f.apiUrl || ''
  const apiKey = env.HORIZONTAL_API_KEY || f.apiKey || ''
  const fileMe = f.me && typeof f.me === 'object' && f.me.id ? { id: String(f.me.id), name: String(f.me.name ?? f.me.id) } : null
  const me = env.HORIZONTAL_ME ? { id: env.HORIZONTAL_ME, name: env.HORIZONTAL_ME } : fileMe
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey,
    me,
    source: {
      apiUrl: env.HORIZONTAL_API_URL ? 'env' : f.apiUrl ? 'file' : null,
      apiKey: env.HORIZONTAL_API_KEY ? 'env' : f.apiKey ? 'file' : null,
      me: env.HORIZONTAL_ME ? 'env' : fileMe ? 'file' : null,
    },
  }
}

/**
 * Autorul unei scrieri: `--as` bate omul configurat. Întoarce nume/id-ul de
 * trimis ca `author`, sau null. Gol (`--as ""`) = nimeni.
 */
export function authorFor(flags, cfg) {
  if (flags.as !== undefined) return flags.as ? String(flags.as) : null
  return cfg.me?.id ?? null
}

/**
 * Omul ales pentru `tk whoami --set`: din `/api/assignees`, după id sau nume
 * (fără majuscule). Trebuie să aibă cont (`linked`) — altfel n-ar putea fi
 * autorul unui comentariu.
 */
export function pickMe(list, wanted) {
  const w = fold(wanted).trim()
  const p = list.find((a) => a.id === String(wanted).trim()) ?? list.find((a) => fold(a.name) === w)
  if (!p) return { error: 'author_not_found' }
  if (p.linked === false) return { error: 'author_not_linked', person: p }
  return { me: { id: p.id, name: p.name } }
}

/** Mesajul când nu se știe în numele cui se scrie. */
export const NO_AUTHOR = 'Nu știu în numele cui scriu: rulează `tk whoami --set <nume>` (numele din `tk assignees`), sau dă --as <nume>.'

// ── Legătura cu proiectul ────────────────────────────────────────────────────

/**
 * Urcă din `start` până la rădăcină după `.horizontal`. Întoarce
 * `{ path, dir, project }` sau `null`. `fs` = { existsSync, readFileSync }.
 */
export function findProjectFile(start, fs) {
  let dir = resolve(start)
  for (;;) {
    const p = join(dir, PROJECT_FILE)
    if (fs.existsSync(p)) {
      let data
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')) } catch {
        throw new UsageError(`${p} nu e JSON valid (așteptat: { "project": "<id>" })`)
      }
      if (!data || typeof data.project !== 'string' || !data.project) {
        throw new UsageError(`${p} nu are câmpul "project"`)
      }
      return { path: p, dir, project: data.project }
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/** Proiectul unei comenzi: `--project` bate `.horizontal`. */
export function contextProject(flags, found) {
  if (typeof flags.project === 'string' && flags.project) return flags.project
  return found?.project ?? null
}

/** Proiectul ales din lista API-ului: după id, prefix sau nume (fără majuscule). */
export function matchProject(list, wanted) {
  const w = String(wanted).trim().toLowerCase()
  return list.find((p) => p.id.toLowerCase() === w)
    ?? list.find((p) => String(p.prefix ?? '').toLowerCase() === w)
    ?? list.find((p) => String(p.name ?? '').toLowerCase() === w)
    ?? null
}

// ── Alegerea și crearea proiectului (`tk init` fără argument) ───────────────

/** Fără diacritice și fără majuscule: „Știri” → „stiri” (ș/ț cu virgulă incluse). */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Proiectele care se potrivesc cu `query`, cele mai bune întâi: id/prefix
 * exact → început de id/prefix/nume → început de cuvânt în nume → oriunde.
 * În fiecare nivel rămâne ordinea API-ului (după nume). Gol = toate.
 */
export function rankProjects(list, query) {
  const q = fold(query).trim()
  if (!q) return list.slice()
  const tier = (p) => {
    const id = fold(p.id), prefix = fold(p.prefix), name = fold(p.name)
    if (id === q || prefix === q) return 0
    if (id.startsWith(q) || prefix.startsWith(q) || name.startsWith(q)) return 1
    if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2
    if (id.includes(q) || prefix.includes(q) || name.includes(q)) return 3
    return null
  }
  return list
    .map((p, i) => ({ p, i, t: tier(p) }))
    .filter((x) => x.t !== null)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.p)
}

/** Ultimul rând al alegerii: proiect nou. */
export const NEW_PROJECT = Object.freeze({ create: true })

/**
 * Rândurile alegerii pentru `query`. O interogare numai din cifre („3”) nu
 * filtrează: e numărul rândului din lista întreagă (vezi `pickerKey`).
 */
export function pickerItems(list, query) {
  const shown = /^\d+$/.test(query) ? list.slice() : rankProjects(list, query)
  return [...shown, NEW_PROJECT]
}

/** Starea de pornire a alegerii. */
export function pickerStart() {
  return { query: '', index: 0 }
}

/**
 * O tastă în alegere → { state, done?, choice? }. `key` e normalizat de
 * apelant: { name: 'up'|'down'|'return'|'backspace'|'escape'|'abort' } sau
 * { char }. `choice` = proiectul, `NEW_PROJECT`, sau null (renunțat).
 * Cifrele scriu în interogare; o interogare numai din cifre mută rândul ales
 * pe acel număr (1 = primul), Enter confirmă.
 */
export function pickerKey(list, state, key) {
  const items = pickerItems(list, state.query)
  const n = items.length
  switch (key.name) {
    case 'abort':
    case 'escape':
      return { state, done: true, choice: null }
    case 'up':
      return { state: { ...state, index: (state.index - 1 + n) % n } }
    case 'down':
      return { state: { ...state, index: (state.index + 1) % n } }
    case 'return':
      return { state, done: true, choice: items[Math.min(state.index, n - 1)] }
    case 'backspace':
      return { state: withQuery(list, state.query.slice(0, -1)) }
  }
  if (typeof key.char === 'string' && key.char >= ' ' && key.char !== '\x7f') {
    return { state: withQuery(list, state.query + key.char) }
  }
  return { state }
}

function withQuery(list, query) {
  if (/^\d+$/.test(query)) {
    const k = Number(query) - 1
    const n = list.length + 1
    return { query, index: k >= 0 && k < n ? k : 0 }
  }
  return { query, index: 0 }
}

/**
 * Rândurile de desenat: antetul cu interogarea, apoi o fereastră de cel mult
 * `max` rânduri în jurul celui ales (numerotate, ca să poți scrie cifra).
 * `selected` e semnul rândului ales; desenul (culori, ștergere) e al apelantului.
 */
export function pickerView(list, state, max = 10) {
  const items = pickerItems(list, state.query)
  const index = Math.min(state.index, items.length - 1)
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), items.length - max))
  const rows = items.slice(start, start + max).map((p, k) => {
    const i = start + k
    const num = String(i + 1).padStart(String(items.length).length)
    const text = p.create ? '+ Proiect nou…' : `${p.id}  ${p.prefix}  ${p.name}  [${p.type ?? 'personal'}]`
    return { selected: i === index, text: `${num}  ${text}` }
  })
  const hidden = items.length - rows.length
  return {
    header: `Proiect: ${state.query}`,
    hint: `↑↓ sau număr · scrie ca să cauți · Enter alege · Esc renunță${hidden > 0 ? ` · încă ${hidden}` : ''}`,
    rows,
    matches: items.length - 1,
  }
}

/**
 * Prefixul sugerat din nume — regula formularului din aplicație
 * (`autoPrefix` + `cleanPrefix` din src/lib/newProject.ts, aici oglindită:
 * CLI-ul e .mjs fără build; un test ține cele două la fel). Dacă regula
 * aplicației dă gol („Știri” → „Ș” → „”), încearcă numele fără diacritice.
 */
export function suggestPrefix(name) {
  const auto = (n) => n.trim().split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 6) ||
    n.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return cleanPrefix(auto(name)) || cleanPrefix(auto(String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
}

/** Ca `cleanPrefix` din src/lib/newProject.ts: A–Z 0–9, majuscule, max 6. */
export function cleanPrefix(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

/** Ca `prefixOwner` din src/lib/newProject.ts: proiectul care ocupă prefixul (id sau prefix). */
export function prefixOwner(list, prefix) {
  const clean = cleanPrefix(prefix)
  if (!clean) return null
  const id = clean.toLowerCase()
  return list.find((p) => p.id.toLowerCase() === id || String(p.prefix ?? '').toUpperCase() === clean) ?? null
}

/** Tipul implicit: `work` sub ~/01Projects/Work, altfel `personal`. */
export function defaultProjectType(cwd, home) {
  const rel = relative(join(home, '01Projects', 'Work'), resolve(cwd))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? 'work' : 'personal'
}

/** Răspunsul la „Tip”: w/work/s/serviciu → work, p/personal → personal, gol → `def`; altfel null. */
export function parseProjectType(answer, def) {
  const a = fold(answer).trim()
  if (!a) return def
  if (['w', 'work', 's', 'serviciu'].includes(a)) return 'work'
  if (['p', 'personal'].includes(a)) return 'personal'
  return null
}

/** Corpul pentru POST /api/projects (`tk project-create`). */
export function buildProjectBody(positional, flags) {
  const name = String(flags.name ?? positional.join(' ')).trim()
  if (!name) throw new UsageError('tk project-create "Nume" [--prefix X] [--type work|personal]')
  const body = { name }
  if (flags.prefix !== undefined) {
    const prefix = cleanPrefix(flags.prefix)
    if (!prefix) throw new UsageError('--prefix are nevoie de cel puțin o literă A–Z sau o cifră')
    body.prefix = prefix
  }
  if (flags.type !== undefined) {
    if (flags.type !== 'work' && flags.type !== 'personal') throw new UsageError('--type e work sau personal')
    body.type = flags.type
  }
  if (flags.accent !== undefined) body.accent = String(flags.accent)
  if (flags.desc !== undefined) body.description = String(flags.desc)
  return body
}

/**
 * CLAUDE.md cu rândul `@TICKETING.md` adăugat la coadă; `null` dacă e deja
 * acolo (pe un rând al lui). `content` null = fișierul lipsește.
 */
export function withClaudeImport(content) {
  if (content == null || content === '') return `${CLAUDE_IMPORT}\n`
  if (content.split(/\r?\n/).some((l) => l.trim() === CLAUDE_IMPORT)) return null
  const sep = content.endsWith('\n') ? '\n' : '\n\n'
  return `${content}${sep}${CLAUDE_IMPORT}\n`
}

/** TICKETING.md: câteva rânduri; tot restul e în `tk guide`. */
export function ticketingMd(project) {
  return `# Tichete — Horizontal

Proiectul acesta e legat de proiectul Horizontal **${project.name}** (id \`${project.id}\`, prefix \`${project.prefix}\`), prin \`.horizontal\`.
Unealta de tichete e \`tk\` (CLI-ul Horizontal, instalat pe sistem) — nu scrie tichete altfel.

Rulează \`tk guide\` pentru tot: comenzi, reguli, dependențe.

\`\`\`bash
tk list                                 # tichetele proiectului
tk get ${project.prefix}-7                         # tot tichetul, cu atașamentele (uită-te la ele!)
tk create "Titlu" --deps ${project.prefix}-3 --desc "…"   # tichet nou
tk update ${project.prefix}-7 --done                       # bifat
\`\`\`
`
}

// ── Afișarea ─────────────────────────────────────────────────────────────────

/** „Val 1 / MVP" din { name, label }; null dacă n-are niciunul. */
export function waveLabel(w) {
  if (!w) return null
  return [w.name, w.label].filter(Boolean).join(' / ') || null
}

/** Un rând de `tk list`, la fel ca în ai-client. */
export function ticketLine(t, waveName) {
  const extra = [
    t.deps?.length ? `← ${t.deps.join(',')}` : '',
    t.dueAt ? `(due ${t.dueAt})` : '',
    t.urgent ? '!' : '',
  ].filter(Boolean).join('  ')
  return `${t.id}  [wave ${t.wave}${waveName ? ` · ${waveName}` : ''}]${t.done ? ' ✓' : ''}${t.theme ? `  #${t.theme}` : ''}  ${t.title}${extra ? `  ${extra}` : ''}`
}

/** Ora unui eveniment, ora României: `2026-10-27 14:32`. */
export function localTime(iso, tz = 'Europe/Bucharest') {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso ?? '')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * Un eveniment din fir → rândurile lui `tk comments`. Capul: ora, autorul
 * („API” = o unealtă; „notă mutată” = vechiul `notes`), „(editat)”; o pasă e
 * `Ionut → Ana` (`creator` = înapoi la cine l-a făcut). Corpul, indentat;
 * fișierele, ca la `tk attachments`.
 */
export function commentLines(e) {
  const head = `${localTime(e.createdAt)}  ${e.author}`
  const lines = []
  if (e.kind === 'handoff') {
    const name = (p) => p?.name ?? 'creator'
    lines.push(`${head}  pasă: ${name(e.handoff?.from)} → ${name(e.handoff?.to)}`)
  } else {
    lines.push(`${head}${e.editedAt ? '  (editat)' : ''}`)
    if (e.body) for (const l of String(e.body).split(/\r?\n/)) lines.push(`    ${l}`.trimEnd())
  }
  for (const a of e.attachments ?? []) lines.push(`    fișier: ${attachmentLine(a)}`)
  return lines
}

export function attachmentLine(a) {
  return `${a.id}  ${a.filename}  ${a.size}${a.url ? `  ${a.url}` : ''}`
}
