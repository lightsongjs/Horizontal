#!/usr/bin/env node
// cli/hz.mjs — CLI-ul de sistem pentru tichetele Horizontal.
// Un singur `hz` pe calculator (symlink în ~/.local/bin, vezi install.mjs),
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
import { createInterface } from 'node:readline'
import {
  parseArgs, UsageError, configPath, resolveConfig, findProjectFile, contextProject,
  matchProject, withClaudeImport, ticketingMd, waveLabel, ticketLine, attachmentLine,
  buildCreateBody, buildUpdateBody, titleFrom, DEFAULT_API_URL, PROJECT_FILE, TICKETING_FILE,
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
    die(`${p} nu e JSON valid; refă-l cu: hz login`)
  }
}

function config() {
  const cfg = resolveConfig(process.env, readConfigFile().data)
  if (!cfg.apiUrl || !cfg.apiKey) {
    die('hz nu e configurat: rulează `hz login` (sau setează HORIZONTAL_API_URL și HORIZONTAL_API_KEY)')
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
  if (res.status === 401) die('unauthorized: cheia API e greșită (hz login)')
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
  if (!p) die(`Niciun proiect: rulează \`hz init <id>\` în rădăcina repo-ului sau dă --project <id>`)
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
  mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 })
  writeFileSync(file.path, JSON.stringify({ apiUrl, apiKey }, null, 2) + '\n', { mode: 0o600 })
  chmodSync(file.path, 0o600) // writeFileSync nu schimbă modul unui fișier existent
  out(`salvat: ${file.path}`)
  if (flags['no-check']) return
  const { status, data } = await api('/api/projects', {}, { apiUrl, apiKey })
  if (status !== 200 || !Array.isArray(data)) fail(status, data)
  out(`ok: ${data.length} proiecte vizibile`)
}

cmds.init = async ({ positional, flags }) => {
  const wanted = positional[0] ?? flags.project
  if (!wanted) throw new UsageError('hz init <id-proiect>   (vezi: hz projects)')
  const list = await projectList()
  const p = matchProject(list, wanted)
  if (!p) {
    out('project_not_found')
    err(`Proiectele: ${list.map((x) => x.id).join(', ')}`)
    process.exit(1)
  }
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
  for (const a of data) out(`${a.id}  ${a.name}`)
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
  if (!title || flags.wave === undefined) throw new UsageError('hz lookup "Titlu" --wave <n>')
  const { status, data } = await api(`/api/tickets?${q({ project, title, wave: String(flags.wave) })}`)
  if (status === 200) return out(data.id)
  if (status === 404 && data.error === 'not_found') return out('not_found')
  fail(status, data)
}

cmds.get = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'hz get <ID>')
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
  const body = buildCreateBody({ projectId, title: titleFrom(positional, flags), wave, flags })
  const { status, data } = await api('/api/tickets', { method: 'POST', body })
  if (status === 201) return out(data.id)
  if (status === 409 && data.existing_id) return out(`duplicate: ${data.existing_id}`)
  fail(status, data)
}

cmds.update = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'hz update <ID> [--title …] [--done] [--deps A,B] …')
  const rest = flags.id !== undefined ? positional : positional.slice(1)
  const body = buildUpdateBody(flags, rest)
  const { status, data } = await api(`/api/tickets/${enc(id)}`, { method: 'PATCH', body })
  if (status === 200) return out(data.movedFrom ? `moved: ${data.movedFrom} -> ${data.id}` : `updated: ${id}`)
  if (status === 404) { out(data.error === 'project_not_found' ? 'project_not_found' : 'not_found'); process.exit(1) }
  if (status === 409 && data.error === 'has_dependencies') {
    out('has_dependencies')
    if (data.dependsOn?.length) out(`  depends on: ${data.dependsOn.join(', ')}`)
    if (data.dependedOnBy?.length) out(`  depended on by: ${data.dependedOnBy.join(', ')}`)
    out('  golește-le cu: hz update <ID> --deps ""  apoi mută')
    process.exit(1)
  }
  if (status === 409 && data.error === 'recurring') {
    out('recurring: tichetul se repetă; scadența se schimbă din aplicație')
    process.exit(1)
  }
  fail(status, data)
}

cmds.delete = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'hz delete <ID>')
  const { status, data } = await api(`/api/tickets/${enc(id)}`, { method: 'DELETE' })
  if (status === 200) return out(`deleted: ${data.id}`)
  if (status === 409 && data.error === 'has_dependents') {
    out(`has_dependents: ${data.dependedOnBy.join(', ')}`)
    process.exit(1)
  }
  fail(status, data)
}

cmds.attach = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'hz attach <ID> <fișier> [<fișier> …]')
  const paths = [...(flags.id !== undefined ? positional : positional.slice(1)), ...(flags.file ?? [])]
  if (!paths.length) throw new UsageError('hz attach <ID> <fișier> [<fișier> …]')
  const form = new FormData()
  for (const p of paths) {
    let bytes
    try { bytes = await readFile(p) } catch (e) { die(`Nu pot citi ${p}: ${e.message}`) }
    // Fără tip: API-ul îl ghicește după extensie (png/jpg/webp/gif/pdf/…).
    form.append('file', new Blob([bytes]), basename(p))
  }
  const { status, data } = await api(`/api/tickets/${enc(id)}/attachments`, { method: 'POST', form })
  if (status === 201) {
    if (flags.json) return out(JSON.stringify(data.attachments, null, 2))
    for (const a of data.attachments ?? []) out(attachmentLine(a))
    return
  }
  if (status === 404) { out('not_found'); process.exit(1) }
  // Un eșec parțial spune ce a ajuns totuși (rămâne pe tichet).
  err(`Error ${status}: ${data.error}${data.filename ? ` (${data.filename})` : ''}`)
  if (data.attachments?.length) {
    err('Atașate înainte de eșec:')
    for (const a of data.attachments) err(attachmentLine(a))
  }
  process.exit(1)
}

cmds.attachments = async ({ positional, flags }) => {
  const id = ticketId(positional, flags, 'hz attachments <ID>')
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
  if (!name || typeof flags.color !== 'string') throw new UsageError('hz theme-create "Nume" --color "#RRGGBB"')
  const { status, data } = await api('/api/themes', { method: 'POST', body: { projectId: project, name, color: flags.color } })
  if (status !== 201) fail(status, data)
  out(data.key)
}

cmds['theme-update'] = async ({ positional, flags }) => {
  const project = projectOrDie(flags)
  const key = flags.key ?? positional[0]
  if (!key) throw new UsageError('hz theme-update <cheie> [--name "…"] [--color "#RRGGBB"]')
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
  if (number === undefined) throw new UsageError('hz wave-update <n> [--name "…"] [--label "…"]')
  const body = {}
  if (typeof flags.name === 'string') body.name = flags.name
  if (typeof flags.label === 'string') body.label = flags.label
  const { status, data } = await api(`/api/waves/${enc(number)}?${q({ project })}`, { method: 'PATCH', body })
  if (status !== 200) fail(status, data)
  out(`updated: ${data.number}  ${waveLabel(data) ?? ''}`.trimEnd())
}

const HELP = `hz — tichetele Horizontal din terminal. Ghidul complet: hz guide

Configurare
  hz login [--url URL] [--key -]     salvează URL-ul și cheia API (~/.config/horizontal)
  hz init <proiect>                  leagă repo-ul curent (.horizontal, TICKETING.md, CLAUDE.md)
  hz status                          ce config și ce proiect vede hz de aici

Citire
  hz projects | waves | themes | assignees      [--json]
  hz list [--wave N] [--theme cheie] [--done false] [--json]
  hz lookup "Titlu" --wave N
  hz get HZ-7
  hz attachments HZ-7

Scriere
  hz create "Titlu" [--desc …] [--deps A,B] [--wave N] [--theme cheie]
                    [--assignee nume] [--due "AAAA-LL-ZZ[ HH:MM]"] [--urgent] [--notes …]
  hz update HZ-7 [--title …] [--done [false]] [--deps A,B|""] [--wave N] [--desc …]
                 [--theme cheie|""] [--assignee nume|""] [--due …|""] [--urgent [false]]
                 [--project țintă]  (mută; ID nou)
  hz delete HZ-7
  hz attach HZ-7 a.png b.pdf
  hz theme-create "Nume" --color "#RRGGBB"   |  hz theme-update <cheie> [--name …] [--color …]
  hz wave-create "Etichetă" [--name IV]      |  hz wave-update <n> [--name …] [--label …]

--project <id> bate .horizontal (la update înseamnă mutare). Forma veche merge:
hz --create --title "…" --wave 1, hz --get --id HZ-7, hz --attach --id HZ-7 --file a.png`

// ── Pornirea ─────────────────────────────────────────────────────────────────

let parsed
try { parsed = parseArgs(process.argv.slice(2)) } catch (e) {
  if (e instanceof UsageError) die(`hz: ${e.message}`)
  throw e
}
const { cmd, positional, flags } = parsed
if (!cmd) {
  if (positional.length) die(`hz: comandă necunoscută: ${positional[0]}\n\n${HELP}`)
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
