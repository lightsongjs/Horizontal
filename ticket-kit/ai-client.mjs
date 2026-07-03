// ticket-kit/ai-client.mjs
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

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
  const data = await res.json().catch(() => ({ error: 'non-JSON response' }))
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
