// cli/lib.mjs — partea pură a lui `hz`: argumentele, configurația, legătura
// cu proiectul (`.horizontal`), textele generate și corpurile cererilor.
// Fără rețea și fără scrieri pe disc aici (citirile trec prin `fs` dat ca
// parametru), ca testele să nu aibă nevoie de nimic din afară.

import { join, dirname, resolve } from 'node:path'

export const DEFAULT_API_URL = 'https://horizontal-dyx.pages.dev'
export const PROJECT_FILE = '.horizontal'
export const TICKETING_FILE = 'TICKETING.md'
export const CLAUDE_IMPORT = '@TICKETING.md'

export class UsageError extends Error {}

// ── Argumentele ──────────────────────────────────────────────────────────────

/** Flaguri fără valoare obligatorie: `--urgent` = true, `--urgent false` merge și el. */
const BOOL_FLAGS = new Set(['urgent', 'done', 'json', 'help', 'no-check', 'force'])
/** Flaguri care se pot repeta; se strâng într-o listă. */
const MULTI_FLAGS = new Set(['file'])

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
}

export const COMMANDS = [
  'help', 'guide', 'login', 'init', 'status',
  'projects', 'waves', 'assignees', 'themes',
  'list', 'lookup', 'get', 'create', 'update', 'delete',
  'attach', 'attachments',
  'theme-create', 'theme-update', 'wave-create', 'wave-update',
]

function canonical(name) {
  const c = COMMAND_ALIASES[name] ?? name
  return COMMANDS.includes(c) ? c : null
}

/**
 * `hz create "Titlu" --deps A,B --urgent` → { cmd, positional, flags }.
 * Acceptă și forma veche, `hz --create --project x --title "…"`: primul
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

/** Titlul vine pozițional (`hz create "Titlu"`) sau, ca înainte, din `--title`. */
export function titleFrom(positional, flags) {
  const t = flags.title ?? positional.join(' ')
  return typeof t === 'string' ? t.trim() : ''
}

/** Corpul pentru POST /api/tickets. `wave` lipsă = valul activ, pus de apelant. */
export function buildCreateBody({ projectId, title, wave, flags }) {
  if (!title) throw new UsageError('lipsește titlul: hz create "Titlu"')
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
  if (flags.selectors !== undefined) body.selectors = jsonFlag(flags, 'selectors')
  if (flags.scenarios !== undefined) body.scenarios = jsonFlag(flags, 'scenarios')
  if (!Object.keys(body).length) {
    throw new UsageError('nimic de schimbat: --title, --desc, --notes, --wave, --done, --deps, --theme, --assignee, --due, --urgent, --project, --selectors, --scenarios')
  }
  return body
}

// ── Configurația ─────────────────────────────────────────────────────────────

/** `$XDG_CONFIG_HOME/horizontal/config.json`, altfel `~/.config/horizontal/config.json`. */
export function configPath(env, home) {
  const base = env.XDG_CONFIG_HOME || join(home, '.config')
  return join(base, 'horizontal', 'config.json')
}

/** Mediul bate fișierul, câmp cu câmp. `source` spune de unde vine fiecare (fără cheie). */
export function resolveConfig(env, file) {
  const f = file ?? {}
  const apiUrl = env.HORIZONTAL_API_URL || f.apiUrl || ''
  const apiKey = env.HORIZONTAL_API_KEY || f.apiKey || ''
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    apiKey,
    source: {
      apiUrl: env.HORIZONTAL_API_URL ? 'env' : f.apiUrl ? 'file' : null,
      apiKey: env.HORIZONTAL_API_KEY ? 'env' : f.apiKey ? 'file' : null,
    },
  }
}

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

/** TICKETING.md: câteva rânduri; tot restul e în `hz guide`. */
export function ticketingMd(project) {
  return `# Tichete — Horizontal

Proiectul acesta e legat de proiectul Horizontal **${project.name}** (id \`${project.id}\`, prefix \`${project.prefix}\`), prin \`.horizontal\`.
Unealta de tichete e \`hz\` (CLI-ul Horizontal, instalat pe sistem) — nu scrie tichete altfel.

Rulează \`hz guide\` pentru tot: comenzi, reguli, dependențe.

\`\`\`bash
hz list                                 # tichetele proiectului
hz get ${project.prefix}-7                         # tot tichetul, cu atașamentele (uită-te la ele!)
hz create "Titlu" --deps ${project.prefix}-3 --desc "…"   # tichet nou
hz update ${project.prefix}-7 --done                       # bifat
\`\`\`
`
}

// ── Afișarea ─────────────────────────────────────────────────────────────────

/** „Val 1 / MVP" din { name, label }; null dacă n-are niciunul. */
export function waveLabel(w) {
  if (!w) return null
  return [w.name, w.label].filter(Boolean).join(' / ') || null
}

/** Un rând de `hz list`, la fel ca în ai-client. */
export function ticketLine(t, waveName) {
  const extra = [
    t.deps?.length ? `← ${t.deps.join(',')}` : '',
    t.dueAt ? `(due ${t.dueAt})` : '',
    t.urgent ? '!' : '',
  ].filter(Boolean).join('  ')
  return `${t.id}  [wave ${t.wave}${waveName ? ` · ${waveName}` : ''}]${t.done ? ' ✓' : ''}${t.theme ? `  #${t.theme}` : ''}  ${t.title}${extra ? `  ${extra}` : ''}`
}

export function attachmentLine(a) {
  return `${a.id}  ${a.filename}  ${a.size}${a.url ? `  ${a.url}` : ''}`
}
