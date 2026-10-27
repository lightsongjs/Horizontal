#!/usr/bin/env node
// cli/tk.mjs — CLI-ul de sistem pentru tichetele Horizontal.
// Un singur `tk` pe calculator (symlink în ~/.local/bin, vezi install.mjs),
// legat de fiecare proiect printr-un `.horizontal` mic. Înlocuiește copierea
// lui ticket-kit/ai-client.mjs în fiecare proiect. Fără dependențe npm:
// Node ≥ 20 are fetch, FormData și Blob.
//
// Ieșirea e pentru agenți: un rând pe element, aceleași cuvinte ca ai-client
// (`updated:`, `duplicate:`, `not_found`…), JSON acolo unde era JSON;
// `--json` dă răspunsul brut al API-ului la comenzile de listare.

import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface, emitKeypressEvents } from 'node:readline'
import {
  parseArgs, UsageError, configPath, resolveConfig, findProjectFile, contextProject,
  matchProject, withClaudeImport, ticketingMd, waveLabel, ticketLine, attachmentLine,
  buildCreateBody, buildUpdateBody, titleFrom, DEFAULT_API_URL, PROJECT_FILE, TICKETING_FILE,
  pickerStart, pickerKey, pickerView, suggestPrefix, cleanPrefix, prefixOwner,
  defaultProjectType, parseProjectType, buildProjectBody,
  buildCommentBody, commentHasContent, commentLines, authorFor, pickMe, NO_AUTHOR,
} from './lib.mjs'

// realpath: rulat prin symlink, ghidul stă lângă fișierul real, nu lângă link.
const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)))

const out = (s) => console.log(s)
const err = (s) => console.error(s)
function die(msg, code = 1) { err(msg); process.exit(code) }

// ── Configurația și rețeaua ──────────────────────────────────────────────────

function readConfigFile() {
  const p = configPath(process.env, homedir())
  if (!existsSync(p)) return { path: p, data: null }
  try { return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) } } catch {
    die(`${p} nu e JSON valid; refă-l cu: tk login`)
  }
}

function config() {
  const cfg = resolveConfig(process.env, readConfigFile().data)
  if (!cfg.apiUrl || !cfg.apiKey) {
    die('tk nu e configurat: rulează `tk login` (sau setează HORIZONTAL_API_URL și HORIZONTAL_API_KEY)')
  }
  return cfg
}

async function api(path, { method = 'GET', body, form } = {}, cfg = config()) {
  const headers = { 'X-API-Key': cfg.apiKey }
  // La multipart, boundary-ul îl pune fetch; un Content-Type scris de noi l-ar strica.
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(`${cfg.apiUrl}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch (e) {
    die(`Nu ajung la ${cfg.apiUrl}: ${e.cause?.code ?? e.message}`)
  }
  const data = await res.json().catch(() => ({ error: 'non-JSON response' }))
  if (res.status === 401) die('unauthorized: cheia API e greșită (tk login)')
  return { status: res.status, data }
}

/** Eroarea generică, ca `fail` din ai-client: cuvântul erorii pe stdout, exit 1. */
function fail(status, data) {
  if ([400, 404, 409, 413, 422].includes(status)) {
    if (data.existing_key) out(`${data.error}: ${data.existing_key}`)
    else if (data.existing_id) out(`duplicate: ${data.existing_id}`)
    else if (data.theme) out(`${data.error}: ${data.theme}`)
    else if (data.unknown) out(`${data.error}: ${[].concat(data.unknown).join(', ')}`)
    else out(data.error ?? `error ${status}`)
  } else {
    err(`Error ${status}: ${JSON.stringify(data)}`)
  }
  process.exit(1)
}

/** O rută nepublicată răspunde cu SPA-ul (HTML, 200): nu e „lista goală". */
function needList(data, route) {
  if (!Array.isArray(data)) die(`Error: ${route} nu a întors o listă (ruta nu e publicată?)`)
  return data
}

// ── Proiectul curent ─────────────────────────────────────────────────────────

function found() {
  try { return findProjectFile(process.cwd(), { existsSync, readFileSync }) } catch (e) {
    if (e instanceof UsageError) die(e.message)
    throw e
  }
}

function projectOrDie(flags) {
  const p = contextProject(flags, found())
  if (!p) die(`Niciun proiect: rulează \`tk init <id>\` în rădăcina repo-ului sau dă --project <id>`)
  return p
}

async function projectList() {
  const { status, data } = await api('/api/projects')
  if (status !== 200) fail(status, data)
  return needList(data, '/api/projects')
}

const q = (o) => new URLSearchParams(o).toString()
const enc = encodeURIComponent

function ticketId(positional, flags, usage) {
  const id = flags.id ?? positional[0]
  if (!id) throw new UsageError(usage)
  return String(id)
}

async function waveNames(project) {
  const { status, data } = await api(`/api/waves?${q({ project })}`)
  if (status !== 200 || !Array.isArray(data)) return new Map()
  return new Map(data.map((w) => [w.number, waveLabel(w)]))
}

// ── Comenzile ────────────────────────────────────────────────────────────────

const cmds = {}

cmds.help = () => out(HELP)

cmds.guide = () => {
  const f = found()
  if (f) out(`<!-- proiectul curent: ${f.project} (din ${f.path}) -->\n`)
  out(readFileSync(join(HERE, 'guide.md'), 'utf8'))
}

cmds.status = async () => {
  const file = readConfigFile()
  const cfg = resolveConfig(process.env, file.data)
  out(`config: ${file.path}${file.data ? '' : ' (lipsește)'}`)
  out(`apiUrl: ${cfg.apiUrl || '(nesetat)'}${cfg.source.apiUrl === 'env' ? '  [din HORIZONTAL_API_URL]' : ''}`)
  out(`apiKey: ${cfg.apiKey ? 'setată' : '(nesetată)'}${cfg.source.apiKey === 'env' ? '  [din HORIZONTAL_API_KEY]' : ''}`)
  out(`me: ${cfg.me ? cfg.me.name : '(nesetat: tk whoami --set <nume>)'}${cfg.source.me === 'env' ? '  [din HORIZONTAL_ME]' : ''}`)
  const f = found()
  out(`proiect: ${f ? `${f.project}  (${f.path})` : '(niciun .horizontal de aici în sus)'}`)
}

function ask(rl, question) {
  return new Promise((res) => rl.question(question, res))
}

/** Citește cheia fără s-o arate pe ecran (când stdin e un terminal). */
async function askSecret(question) {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin })
    for await (const line of rl) { rl.close(); return line.trim() }
    return ''
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  rl._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(question) }
  const v = await ask(rl, question)
  rl.close()
  process.stdout.write('\n')
  return v.trim()
}

cmds.login = async ({ flags }) => {
  const file = readConfigFile()
  const prev = file.data ?? {}
  let apiUrl = typeof flags.url === 'string' ? flags.url : null
  let apiKey = typeof flags.key === 'string' && flags.key !== '-' ? flags.key : null
  if (flags.key === '-') apiKey = await askSecret('')
  if (apiUrl === null) {
    const def = prev.apiUrl || DEFAULT_API_URL
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      apiUrl = (await ask(rl, `URL-ul API-ului [${def}]: `)).trim() || def
      rl.close()
    } else apiUrl = def
  }
  if (apiKey === null) {
    apiKey = await askSecret(`Cheia API${prev.apiKey ? ' [Enter = păstrează cea salvată]' : ''}: `) || prev.apiKey || ''
  }
  apiUrl = apiUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(apiUrl)) die('URL-ul trebuie să înceapă cu http:// sau https://')
  if (!apiKey) die('Lipsește cheia API')
  // `me` (omul de pe calculator) rămâne peste un login nou.
  writeConfig(file.path, { apiUrl, apiKey, ...(prev.me ? { me: prev.me } : {}) })
  out(`salvat: ${file.path}`)
  if (typeof flags.me === 'string') return setMe(flags.me, { apiUrl, apiKey })
  if (flags['no-check']) return
  const { status, data } = await api('/api/projects', {}, { apiUrl, apiKey })
  if (status !== 200 || !Array.isArray(data)) fail(status, data)
  out(`ok: ${data.length} proiecte vizibile`)
  if (!prev.me) out('cine ești (autorul comentariilor): tk whoami --set <nume>   (vezi: tk assignees)')
}

function writeConfig(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(path, 0o600) // writeFileSync nu schimbă modul unui fișier existent
}

/** Alege omul din /api/assignees și îl ține în config (numai id + nume). */
async function setMe(wanted, cfg = config()) {
  const { status, data } = await api('/api/assignees', {}, cfg)
  if (status !== 200) fail(status, data)
  const r = pickMe(needList(data, '/api/assignees'), wanted)
  if (r.error === 'author_not_found') { out(`author_not_found: ${wanted}`); err(`Oamenii: ${data.map((a) => a.name).join(', ')}`); process.exit(1) }
  if (r.error === 'author_not_linked') { out(`author_not_linked: ${r.person.name} n-are cont legat (se leagă din aplicație / scripts/link-assignees.mjs)`); process.exit(1) }
  const file = readConfigFile()
  writeConfig(file.path, { ...(file.data ?? {}), me: r.me })
  out(`me: ${r.me.name}  (${r.me.id})`)
}

cmds.whoami = async ({ positional, flags }) => {
  const wanted = flags.set ?? positional[0]
  if (wanted !== undefined) {
    if (!wanted || wanted === true) throw new UsageError('tk whoami --set <nume|id>')
    return setMe(String(wanted))
  }
  const cfg = resolveConfig(process.env, readConfigFile().data)
  if (!cfg.me) { out('(nesetat)'); err(NO_AUTHOR); process.exit(1) }
  out(`${cfg.me.name}${cfg.me.name !== cfg.me.id ? `  (${cfg.me.id})` : ''}${cfg.source.me === 'env' ? '  [din HORIZONTAL_ME]' : ''}`)
}

/** Scrie legătura: `.horizontal`, TICKETING.md și importul din CLAUDE.md. */
function linkProject(p) {
  const dir = process.cwd()
  writeFileSync(join(dir, PROJECT_FILE), JSON.stringify({ project: p.id }, null, 2) + '\n')
  writeFileSync(join(dir, TICKETING_FILE), ticketingMd(p))
  const claudePath = join(dir, 'CLAUDE.md')
  const before = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : null
  const after = withClaudeImport(before)
  if (after !== null) writeFileSync(claudePath, after)
  out(`init: ${p.id}  ${p.prefix}  ${p.name}`)
  out(`  ${PROJECT_FILE}, ${TICKETING_FILE} scrise; CLAUDE.md ${after === null ? 'avea deja' : before == null ? 'creat cu' : 'a primit'} @${TICKETING_FILE}`)
}

/**
 * Alegerea interactivă e permisă doar într-un terminal (stdin + stdout).
 * `TK_INTERACTIVE=1` o forțează pe un pipe — numai pentru proba de fum, care
 * trimite tastele ca octeți; un agent dă mereu id-ul.
 */
const interactive = () => (process.stdin.isTTY && process.stdout.isTTY) || process.env.TK_INTERACTIVE === '1'

cmds.init = async ({ positional, flags }) => {
  const wanted = positional[0] ?? flags.project
  if (!wanted) {
    if (!interactive()) throw new UsageError('tk init <id-proiect>   (vezi: tk projects; fără argument, numai într-un terminal)')
    const p = await chooseProject(await projectList())
    if (!p) { err('init: renunțat; nu s-a scris nimic'); process.exit(1) }
    return linkProject(p)
  }
  const list = await projectList()
  const p = matchProject(list, wanted)
  if (!p) {
    out('project_not_found')
    err(`Proiectele: ${list.map((x) => x.id).join(', ')}`)
    process.exit(1)
  }
  linkProject(p)
}

// ── Tastele (alegerea și întrebările din `tk init`) ─────────────────────────
// O SINGURĂ coadă de taste pentru toată sesiunea: alegerea și întrebările
// care urmează citesc din ea pe rând, deci o tastă venită înainte ca
// următoarea întrebare să asculte nu se pierde (contează la un pipe).

let keys = null

function keyQueue() {
  if (keys) return keys
  const queue = []
  let waiting = null
  let ended = false
  const push = (k) => { if (waiting) { const w = waiting; waiting = null; w(k) } else queue.push(k) }
  emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key = {}) => {
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) return push({ name: 'abort' })
    if (['up', 'down', 'return', 'enter', 'backspace', 'escape'].includes(key.name)) {
      return push({ name: key.name === 'enter' ? 'return' : key.name })
    }
    if (str && !key.ctrl && !key.meta) push({ char: str })
  })
  process.stdin.on('end', () => { ended = true; push({ name: 'abort' }) })
  process.stdin.resume()
  keys = {
    next: () => queue.length ? Promise.resolve(queue.shift()) : ended ? Promise.resolve({ name: 'abort' }) : new Promise((r) => { waiting = r }),
    close: () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false)
      process.stdin.pause()
    },
  }
  // Orice ieșire (și `die`) lasă terminalul cum l-a găsit.
  process.on('exit', () => { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdout.write('\x1b[?25h') })
  return keys
}

const tty = process.stdout.isTTY
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)

/** Alegerea: filtru + săgeți/cifre + Enter. Întoarce proiectul (creat, dacă trebuie) sau null. */
async function chooseProject(list) {
  const k = keyQueue()
  let state = pickerStart()
  let drawn = 0
  const draw = () => {
    const v = pickerView(list, state)
    // Un rând rupt de terminal ar strica numărătoarea de mai jos: tăiem la lățime.
    const width = Math.max(20, (process.stdout.columns || 80) - 1)
    const fit = (t) => ([...t].length > width ? [...t].slice(0, width - 1).join('') + '…' : t)
    const count = `   (${v.matches} ${v.matches === 1 ? 'proiect' : 'proiecte'})`
    const lines = [
      fit(v.header + count).replace(count, paint('2', count)),
      ...v.rows.map((r) => (r.selected ? paint('7', fit(`> ${r.text}`)) : fit(`  ${r.text}`))),
      paint('2', fit(v.hint)),
    ]
    // Înapoi la începutul desenului de dinainte, șters până la capăt.
    if (drawn) process.stdout.write(`\x1b[${drawn}F`)
    process.stdout.write('\x1b[J' + lines.join('\n') + '\n')
    drawn = lines.length
  }
  if (tty) process.stdout.write('\x1b[?25l')
  for (;;) {
    if (tty) draw()
    const r = pickerKey(list, state, await k.next())
    state = r.state
    if (!r.done) continue
    if (tty) { process.stdout.write(`\x1b[${drawn}F\x1b[J\x1b[?25h`) }
    if (!r.choice) { k.close(); return null }
    if (!r.choice.create) { k.close(); return r.choice }
    const created = await createInteractively(list, /^\d+$/.test(state.query) ? '' : state.query.trim())
    k.close()
    return created
  }
}

/** Un rând de text în modul brut: Enter = gata (gol → `def`), Esc / Ctrl+C = null. */
async function promptLine(label, def = '') {
  const k = keyQueue()
  let value = ''
  const shown = () => `${label}${def ? paint('2', ` [${def}]`) : ''}: ${value}`
  process.stdout.write(shown())
  for (;;) {
    const key = await k.next()
    if (key.name === 'abort' || key.name === 'escape') { process.stdout.write('\n'); return null }
    if (key.name === 'return') { process.stdout.write('\n'); return value.trim() || def }
    if (key.name === 'backspace') value = [...value].slice(0, -1).join('')
    else if (key.char && key.char >= ' ' && key.char !== '\x7f') value += key.char
    else continue
    process.stdout.write(`\r\x1b[K${shown()}`)
  }
}

/** „+ Proiect nou…”: Nume, Prefix, Tip, apoi POST /api/projects. */
async function createInteractively(list, nameHint) {
  const name = await promptLine('Nume', nameHint)
  if (!name) return null
  let prefix
  for (;;) {
    const answer = await promptLine('Prefix', suggestPrefix(name))
    if (answer === null) return null
    prefix = cleanPrefix(answer)
    if (!prefix) { err('  prefixul are nevoie de o literă A–Z sau o cifră'); continue }
    const owner = prefixOwner(list, prefix)
    if (owner) { err(`  ${prefix} e deja folosit de ${owner.id} (${owner.name})`); continue }
    break
  }
  const def = defaultProjectType(process.cwd(), homedir())
  let type
  for (;;) {
    const answer = await promptLine('Tip (work/personal)', def)
    if (answer === null) return null
    type = parseProjectType(answer, def)
    if (type) break
    err('  work sau personal')
  }
  const { status, data } = await api('/api/projects', { method: 'POST', body: { name, prefix, type } })
  if (status === 201) { out(`creat: ${data.id}  ${data.prefix}  ${data.name}  [${data.type}]`); return data }
  if (status === 409 && data.error === 'prefix_taken') die(`prefix_taken: ${data.prefix} (${data.existing_project}); nu s-a scris nimic`)
  fail(status, data)
}

cmds['project-create'] = async ({ positional, flags }) => {
  const body = buildProjectBody(positional, flags)
  const { status, data } = await api('/api/projects', { method: 'POST', body })
  if (status === 201) return out(`${data.id}  ${data.prefix}  ${data.name}  [${data.type}]`)
  if (status === 409 && data.error === 'prefix_taken') { out(`prefix_taken: ${data.existing_project}`); process.exit(1) }
  fail(status, data)
}

cmds.projects = async ({ flags }) => {
  const data = await projectList()
  if (flags.json) return out(JSON.stringify(data, null, 2))
  if (!data.length) return out('(no projects found)')
  for (const p of data) out(`${p.id}  ${p.prefix}  ${p.name}  [${p.type}]`)
}

cmds.waves = async ({ flags }) => {
  const project = projectOrDie(flags)
  const { status, data } = await api(`/api/waves?${q({ project })}`)
  if (status !== 200) fail(status, data)
  needList(data, '/api/waves')
  if (flags.json) return out(JSON.stringify(data, null, 2))
  if (!data.length) return out('(no waves found)')
  for (const w of data) out(`${w.number}  ${waveLabel(w) ?? ''}`.trimEnd())
}

cmds.assignees = async ({ flags }) => {
  const { status, data } = await api('/api/assignees')
  if (status !== 200) fail(status, data)
  needList(data, '/api/assignees')
  if (flags.json) return out(JSON.stringify(data, null, 2))
  if (!data.length) return out('(no assignees found)')
  // „fără cont” = nu poate fi autor (tk whoami --set), doar destinatar al unei pase.
  for (const a of data) out(`${a.id}  ${a.name}${a.linked === false ? '  (fără cont)' : ''}`)
}

cmds.themes = async ({ flags }) => {
  const project = projectOrDie(flags)
  const { status, data } = await api(`/api/themes?${q({ project })}`)
  if (status !== 200) fail(status, data)
  needList(data, '/api/themes')
  if (flags.json) return out(JSON.stringify(data, null, 2))
  if (!data.length) return out('(no themes found)')
  for (const t of data) out(`${t.key}  ${t.color}  ${t.name}`)
}

cmds.list = async ({ flags }) => {
  const project = projectOrDie(flags)
  const params = { project }
  if (flags.wave !== undefined) params.wave = String(flags.wave)
  if (flags.theme !== undefined) params.theme = String(flags.theme)
  const { status, data } = await api(`/api/tickets?${q(params)}`)
  if (status !== 200) fail(status, data)
  needList(data, '/api/tickets')
  let rows = data
  if (flags.done === false) rows = rows.filter((t) => !t.done)
  if (flags.done === true) rows = rows.filter((t) => t.done)
  if (flags.json) return out(JSON.stringify(rows, null, 2))
  if (!rows.length) return out('(no tickets found)')
  const names = await waveNames(project)
  for (const t of rows) out(ticketLine(t, names.get(t.wave)))
}

cmds.lookup = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const title = titleFrom(positional, flags)
  if (!title || flags.wave === undefined) throw new UsageError('tk lookup "Titlu" --wave <n>')
  const { status, data } = await api(`/api/tickets?${q({ project, title, wave: String(flags.wave) })}`)
  if (status === 200) return out(data.id)
  if (status === 404 && data.error === 'not_found') return out('not_found')
  fail(status, data)
}

cmds.get = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk get <ID>')
  const { status, data } = await api(`/api/tickets/${enc(id)}`)
  if (status === 200) return out(JSON.stringify(data, null, 2))
  if (status === 404) { out('not_found'); process.exit(1) }
  fail(status, data)
}

cmds.create = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  let wave = flags.wave
  let projectId = project
  if (wave === undefined) {
    // Fără --wave: valul activ al proiectului, ca o captură din aplicație.
    const p = matchProject(await projectList(), project)
    if (!p) { out('project_not_found'); process.exit(1) }
    projectId = p.id
    wave = p.currentWave
  }
  // Autorul (`created_by`) dacă omul e configurat; fără el tichetul rămâne fără autor uman, ca înainte.
  const body = buildCreateBody({ projectId, title: titleFrom(positional, flags), wave, flags, author: authorFor(flags, config()) })
  const { status, data } = await api('/api/tickets', { method: 'POST', body })
  if (status === 201) return out(data.id)
  if (status === 409 && data.existing_id) return out(`duplicate: ${data.existing_id}`)
  fail(status, data)
}

cmds.update = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk update <ID> [--title …] [--done] [--deps A,B] …')
  const rest = flags.id !== undefined ? positional : positional.slice(1)
  const body = buildUpdateBody(flags, rest)
  const { status, data } = await api(`/api/tickets/${enc(id)}`, { method: 'PATCH', body })
  if (status === 200) return out(data.movedFrom ? `moved: ${data.movedFrom} -> ${data.id}` : `updated: ${id}`)
  if (status === 404) { out(data.error === 'project_not_found' ? 'project_not_found' : 'not_found'); process.exit(1) }
  if (status === 409 && data.error === 'has_dependencies') {
    out('has_dependencies')
    if (data.dependsOn?.length) out(`  depends on: ${data.dependsOn.join(', ')}`)
    if (data.dependedOnBy?.length) out(`  depended on by: ${data.dependedOnBy.join(', ')}`)
    out('  golește-le cu: tk update <ID> --deps ""  apoi mută')
    process.exit(1)
  }
  if (status === 409 && data.error === 'recurring') {
    out('recurring: tichetul se repetă; scadența se schimbă din aplicație')
    process.exit(1)
  }
  fail(status, data)
}

cmds.delete = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk delete <ID>')
  const { status, data } = await api(`/api/tickets/${enc(id)}`, { method: 'DELETE' })
  if (status === 200) return out(`deleted: ${data.id}`)
  if (status === 409 && data.error === 'has_dependents') {
    out(`has_dependents: ${data.dependedOnBy.join(', ')}`)
    process.exit(1)
  }
  fail(status, data)
}

/** Urcă fișierele pe tichet; întoarce `{ status, data }` al API-ului. */
async function uploadFiles(id, paths) {
  const form = new FormData()
  for (const p of paths) {
    let bytes
    try { bytes = await readFile(p) } catch (e) { die(`Nu pot citi ${p}: ${e.message}`) }
    // Fără tip: API-ul îl ghicește după extensie (png/jpg/webp/gif/pdf/…).
    form.append('file', new Blob([bytes]), basename(p))
  }
  return api(`/api/tickets/${enc(id)}/attachments`, { method: 'POST', form })
}

/** Un eșec de urcare spune ce a ajuns totuși (rămâne pe tichet) și iese. */
function uploadFailed(status, data) {
  if (status === 404) { out('not_found'); process.exit(1) }
  err(`Error ${status}: ${data.error}${data.filename ? ` (${data.filename})` : ''}`)
  if (data.attachments?.length) {
    err('Atașate înainte de eșec:')
    for (const a of data.attachments) err(attachmentLine(a))
  }
  process.exit(1)
}

cmds.attach = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk attach <ID> <fișier> [<fișier> …]')
  const paths = [...(flags.id !== undefined ? positional : positional.slice(1)), ...(flags.file ?? [])]
  if (!paths.length) throw new UsageError('tk attach <ID> <fișier> [<fișier> …]')
  const { status, data } = await uploadFiles(id, paths)
  if (status === 201) {
    if (flags.json) return out(JSON.stringify(data.attachments, null, 2))
    for (const a of data.attachments ?? []) out(attachmentLine(a))
    return
  }
  uploadFailed(status, data)
}

cmds.comments = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk comments <ID>')
  const { status, data } = await api(`/api/tickets/${enc(id)}/comments`)
  if (status === 404) { out('not_found'); process.exit(1) }
  if (status !== 200 || !Array.isArray(data.comments)) fail(status, data)
  if (flags.json) return out(JSON.stringify(data.comments, null, 2))
  if (!data.comments.length) return out('(no comments)')
  for (const e of data.comments) for (const l of commentLines(e)) out(l)
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

cmds.comment = async ({ positional, flags }) => {
  const usage = 'tk comment <ID> "text" [--to <persoană>|""] [--attach fișier …]'
  const id = ticketId(positional, flags, usage)
  const rest = flags.id !== undefined ? positional : positional.slice(1)
  let text = flags.body ?? flags.text ?? rest.join(' ')
  if (text === '-') text = await readStdin() // textul lung (markdown) vine pe stdin
  if (!commentHasContent(text, flags)) throw new UsageError(usage)
  // Autorul ÎNAINTE de orice urcare: fără el nu scriem nimic (nici fișierele).
  const author = authorFor(flags, config())
  if (!author) die(NO_AUTHOR)
  // Fișierele întâi, pe tichet; apoi comentariul le leagă de el (drumul aplicației).
  let ids = []
  if (flags.attach?.length) {
    const up = await uploadFiles(id, flags.attach)
    if (up.status !== 201) uploadFailed(up.status, up.data)
    ids = up.data.attachments.map((a) => a.id)
  }
  const { status, data } = await api(`/api/tickets/${enc(id)}/comments`, { method: 'POST', body: buildCommentBody(text, flags, author, ids) })
  if (status === 201 || status === 200) {
    if (flags.json) return out(JSON.stringify(data, null, 2))
    if (data.unchanged) return out(`unchanged: ${id}`)
    for (const e of data.comments ?? []) {
      if (e.kind === 'comment') out(`commented: ${id}  ${e.id}`)
      else out(`passed: ${id} -> ${e.handoff?.to?.name ?? 'creator'}`)
    }
    return
  }
  if (ids.length) err(`Fișierele au rămas pe tichet (fără comentariu): ${ids.join(', ')}`)
  if (status === 404) { out('not_found'); process.exit(1) }
  if (status === 422 && data.error?.startsWith('author_')) {
    out(`${data.error}: ${data.author}`)
    err(NO_AUTHOR)
    process.exit(1)
  }
  if (status === 501) { out('migration_missing: firul din API cere supabase/migration-thread-api.sql'); process.exit(1) }
  fail(status, data)
}
cmds.attachments = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'tk attachments <ID>')
  const { status, data } = await api(`/api/tickets/${enc(id)}/attachments`)
  if (status === 404) { out('not_found'); process.exit(1) }
  if (status !== 200) fail(status, data)
  if (flags.json) return out(JSON.stringify(data.attachments ?? [], null, 2))
  if (!data.attachments?.length) return out('(no attachments)')
  for (const a of data.attachments) out(attachmentLine(a))
}

cmds['theme-create'] = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const name = flags.name ?? positional.join(' ')
  if (!name || typeof flags.color !== 'string') throw new UsageError('tk theme-create "Nume" --color "#RRGGBB"')
  const { status, data } = await api('/api/themes', { method: 'POST', body: { projectId: project, name, color: flags.color } })
  if (status !== 201) fail(status, data)
  out(data.key)
}

cmds['theme-update'] = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const key = flags.key ?? positional[0]
  if (!key) throw new UsageError('tk theme-update <cheie> [--name "…"] [--color "#RRGGBB"]')
  const body = {}
  if (typeof flags.name === 'string') body.name = flags.name
  if (typeof flags.color === 'string') body.color = flags.color
  const { status, data } = await api(`/api/themes/${enc(key)}?${q({ project })}`, { method: 'PATCH', body })
  if (status !== 200) fail(status, data)
  out(`updated: ${data.key}`)
}

cmds['wave-create'] = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const body = { projectId: project, label: flags.label ?? positional.join(' ') }
  if (typeof flags.name === 'string') body.name = flags.name
  const { status, data } = await api('/api/waves', { method: 'POST', body })
  if (status !== 201) fail(status, data)
  out(`${data.number}  ${waveLabel(data) ?? ''}`.trimEnd())
}

cmds['wave-update'] = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const number = flags.number ?? positional[0]
  if (number === undefined) throw new UsageError('tk wave-update <n> [--name "…"] [--label "…"]')
  const body = {}
  if (typeof flags.name === 'string') body.name = flags.name
  if (typeof flags.label === 'string') body.label = flags.label
  const { status, data } = await api(`/api/waves/${enc(number)}?${q({ project })}`, { method: 'PATCH', body })
  if (status !== 200) fail(status, data)
  out(`updated: ${data.number}  ${waveLabel(data) ?? ''}`.trimEnd())
}

const HELP = `tk — tichetele Horizontal din terminal. Ghidul complet: tk guide

Configurare
  tk login [--url URL] [--key -]     salvează URL-ul și cheia API (~/.config/horizontal)
  tk init <proiect>                  leagă repo-ul curent (.horizontal, TICKETING.md, CLAUDE.md)
  tk init                            în terminal: caută proiectul sau creează unul (+ Proiect nou…)
  tk status                          ce config și ce proiect vede tk de aici
  tk whoami [--set nume]             cine ești: autorul comentariilor (și created_by)

Citire
  tk projects | waves | themes | assignees      [--json]
  tk list [--wave N] [--theme cheie] [--done false] [--json]
  tk lookup "Titlu" --wave N
  tk get HZ-7                        tot tichetul (commentCount = câte rânduri are firul)
  tk comments HZ-7 [--json]          firul: comentarii + pase, cronologic
  tk attachments HZ-7

Scriere
  tk create "Titlu" [--desc …] [--deps A,B] [--wave N] [--theme cheie]
                    [--assignee nume] [--due "AAAA-LL-ZZ[ HH:MM]"] [--urgent] [--notes …]
  tk update HZ-7 [--title …] [--done [false]] [--deps A,B|""] [--wave N] [--desc …]
                 [--theme cheie|""] [--assignee nume|""] [--due …|""] [--urgent [false]]
                 [--pin [false]] [--notes …] [--selectors JSON] [--scenarios JSON]
                 [--project țintă]  (mută; ID nou)
  tk comment HZ-7 "text" [--to persoană|""] [--attach a.png …] [--as persoană]
                 comentariu (+ pasă) în numele tău (tk whoami); text "-" = de pe stdin
  tk delete HZ-7
  tk attach HZ-7 a.png b.pdf
  tk project-create "Nume" [--prefix X] [--type work|personal] [--accent "#RRGGBB"] [--desc …]
  tk theme-create "Nume" --color "#RRGGBB"   |  tk theme-update <cheie> [--name …] [--color …]
  tk wave-create "Etichetă" [--name IV]      |  tk wave-update <n> [--name …] [--label …]

--project <id> bate .horizontal (la update înseamnă mutare). Forma veche merge:
tk --create --title "…" --wave 1, tk --get --id HZ-7, tk --attach --id HZ-7 --file a.png`

// ── Pornirea ─────────────────────────────────────────────────────────────────

let parsed
try { parsed = parseArgs(process.argv.slice(2)) } catch (e) {
  if (e instanceof UsageError) die(`tk: ${e.message}`)
  throw e
}
const { cmd, positional, flags } = parsed
if (!cmd) {
  if (positional.length) die(`tk: comandă necunoscută: ${positional[0]}\n\n${HELP}`)
  out(HELP)
} else if (flags.help && cmd !== 'help') {
  out(HELP)
} else {
  try {
    await cmds[cmd]({ positional, flags })
  } catch (e) {
    if (e instanceof UsageError) die(`Usage: ${e.message}`)
    throw e
  }
}
