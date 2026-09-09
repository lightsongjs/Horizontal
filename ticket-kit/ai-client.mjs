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
  if (!project || !title || wave === undefined) {
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
  if (!project || !title || wave === undefined) {
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

// "Val 1 / MVP" from { number, name, label } — falls back to the bare number.
function waveLabel(w) {
  if (!w) return null
  return [w.name, w.label].filter(Boolean).join(' / ') || null
}

// Wave number -> label, so --list can show names instead of bare numbers.
// Returns an empty map if the lookup fails; naming is a nicety, not a hard requirement.
async function fetchWaveNames(project) {
  const { status, data } = await apiFetch(`/api/waves?project=${encodeURIComponent(project)}`)
  if (status !== 200 || !Array.isArray(data)) return new Map()
  return new Map(data.map(w => [w.number, waveLabel(w)]))
}

// --waves --project KATA
// Prints one line per wave: 0  Scratchpad
async function waves() {
  const { project } = flags
  if (!project) {
    console.error('Usage: --waves --project <id>')
    process.exit(1)
  }
  const { status, data } = await apiFetch(`/api/waves?project=${encodeURIComponent(project)}`)
  if (status === 200) {
    if (!data.length) {
      console.log('(no waves found)')
    } else {
      for (const w of data) {
        console.log(`${w.number}  ${waveLabel(w) ?? '(unnamed)'}`)
      }
    }
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

// --list --project KATA [--wave 1]
// Prints one line per ticket: KATA-01  [wave 1 · Val 1 / MVP]  Setup DB
async function list() {
  const { project, wave } = flags
  if (!project) {
    console.error('Usage: --list --project <id> [--wave <n>]')
    process.exit(1)
  }
  const params = new URLSearchParams({ project })
  if (wave !== undefined) params.set('wave', String(wave))
  const { status, data } = await apiFetch(`/api/tickets?${params}`)
  if (status === 200) {
    if (!data.length) {
      console.log('(no tickets found)')
    } else {
      const names = await fetchWaveNames(project)
      for (const t of data) {
        const name = names.get(t.wave)
        console.log(`${t.id}  [wave ${t.wave}${name ? ` · ${name}` : ''}]${t.done ? ' ✓' : ''}  ${t.title}`)
      }
    }
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

// --projects
// Prints one line per project: kata  KATA  Katalist  [work]
async function projects() {
  const { status, data } = await apiFetch('/api/projects')
  if (status === 200) {
    if (!data.length) {
      console.log('(no projects found)')
    } else {
      for (const p of data) {
        console.log(`${p.id}  ${p.prefix}  ${p.name}  [${p.type}]`)
      }
    }
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

async function get() {
  const { id } = flags
  if (!id) {
    console.error('Usage: --get --id <ticket-id>')
    process.exit(1)
  }
  const { status, data } = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`)
  if (status === 200) {
    console.log(JSON.stringify(data, null, 2))
  } else if (status === 404) {
    console.log('not_found')
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

// --update --id KATA-03 [--title "..."] [--wave N] [--done true] [--deps ID1,ID2]
// [--desc "..."] [--notes "..."] [--theme key] [--selectors '[...]'] [--scenarios '[...]']
// [--project <target>]  moves the ticket to another project; it gets a new ID with
//                       that project's prefix. Refused if any dependency touches it.
// Prints: updated: KATA-03  |  moved: KATA-03 -> TK-12  |  duplicate: KATA-07  |  not_found
async function update() {
  const { id } = flags
  if (!id) {
    console.error('Usage: --update --id <ticket-id> [--title "..."] [--wave N] [--done true|false] [--deps ID1,ID2] [--desc "..."] [--notes "..."] [--theme key] [--project <target>] [--selectors \'[...]\'] [--scenarios \'[...]\']')
    process.exit(1)
  }

  const body = {}
  if ('title' in flags) body.title = flags.title
  if ('desc' in flags) body.desc = flags.desc
  if ('theme' in flags) body.theme = flags.theme
  if ('wave' in flags) {
    body.wave = Number(flags.wave)
    if (isNaN(body.wave)) { console.error('--wave must be a number'); process.exit(1) }
  }
  if ('done' in flags) body.done = flags.done === 'true'
  if ('notes' in flags) body.notes = flags.notes
  if ('project' in flags) {
    if (flags.project === true) { console.error('--project requires a value'); process.exit(1) }
    body.projectId = String(flags.project)
  }
  if ('deps' in flags) {
    if (flags.deps === true) { console.error('--deps requires a value (use --deps "" to clear all)'); process.exit(1) }
    body.deps = flags.deps ? String(flags.deps).split(',').map(s => s.trim()).filter(Boolean) : []
  }

  if ('selectors' in flags) {
    try { body.selectors = JSON.parse(flags.selectors) }
    catch { console.error('--selectors must be valid JSON array'); process.exit(1) }
  }
  if ('scenarios' in flags) {
    try { body.scenarios = JSON.parse(flags.scenarios) }
    catch { console.error('--scenarios must be valid JSON array'); process.exit(1) }
  }

  const knownFields = ['title', 'desc', 'theme', 'wave', 'done', 'notes', 'deps', 'selectors', 'scenarios', 'projectId']
  if (!knownFields.some(f => f in body)) {
    console.error('Provide at least one field: --title, --wave, --done, --deps, --desc, --notes, --theme, --project, --selectors, --scenarios')
    process.exit(1)
  }

  const { status, data } = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

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
  } else if (status === 400) {
    console.log(data.error)
    process.exit(1)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

if (flags.projects !== undefined) {
  await projects()
} else if (flags.waves !== undefined) {
  await waves()
} else if (flags.lookup !== undefined) {
  await lookup()
} else if (flags.create !== undefined) {
  await create()
} else if (flags.list !== undefined) {
  await list()
} else if (flags.get !== undefined) {
  await get()
} else if (flags.update !== undefined) {
  await update()
} else {
  console.error('Usage: node ai-client.mjs --projects|--waves|--lookup|--create|--list|--get|--update [options]')
  process.exit(1)
}
