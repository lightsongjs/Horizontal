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

// --urgent true|false  →  boolean; anything else is a usage error.
function boolFlag(name) {
  const v = flags[name]
  if (v === 'true' || v === true) return true
  if (v === 'false') return false
  console.error(`--${name} must be true or false`)
  process.exit(1)
}

// --create --project kata --title "Auth flow" --wave 1 --deps KATA-03,KATA-04
// --assignee takes a name or an id, like --project; the API resolves it.
// --theme must be an existing theme key (see --themes); unknown keys are refused.
// --due "2026-10-24" (all day) or "2026-10-24 15:30" (Romanian time); --urgent true
// Prints: KATA-05   OR   duplicate: KATA-03   OR   theme_not_found
async function create() {
  const { project, title, wave, deps, theme, desc, notes, assignee, due } = flags
  if (!project || !title || wave === undefined) {
    console.error('Usage: --create --project <id> --title "<title>" --wave <n> [--deps ID1,ID2] [--theme key] [--desc "..."] [--notes "..."] [--assignee <id|name>] [--due "YYYY-MM-DD[ HH:MM]"] [--urgent true]')
    process.exit(1)
  }
  if (due === true) {
    console.error('--due requires a value: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"')
    process.exit(1)
  }
  if (assignee === true) {
    console.error('--assignee requires a value (a name or an id)')
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
      assigneeId: assignee ? String(assignee) : null,
      ...(due !== undefined ? { due: String(due) } : {}),
      ...('urgent' in flags ? { urgent: boolFlag('urgent') } : {}),
    }),
  })
  if (status === 201) {
    console.log(data.id)
  } else if (status === 409) {
    console.log(`duplicate: ${data.existing_id}`)
  } else if (status === 422 || status === 400) {
    console.log(data.theme ? `${data.error}: ${data.theme}` : data.error)
    process.exit(1)
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
// Prints one line per wave, in column order (position): 0  Scratchpad
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

// --list --project KATA [--wave 1] [--theme key]   (--theme "" = tickets without a theme)
// Prints one line per ticket:
//   KATA-01  [wave 1 · Val 1 / MVP]  #auth  Setup DB  ← KATA-00  (due 2026-10-24) !
async function list() {
  const { project, wave, theme } = flags
  if (!project) {
    console.error('Usage: --list --project <id> [--wave <n>] [--theme <key>]')
    process.exit(1)
  }
  const params = new URLSearchParams({ project })
  if (wave !== undefined) params.set('wave', String(wave))
  if (theme !== undefined) params.set('theme', theme === true ? '' : String(theme))
  const { status, data } = await apiFetch(`/api/tickets?${params}`)
  if (status === 200) {
    if (!data.length) {
      console.log('(no tickets found)')
    } else {
      const names = await fetchWaveNames(project)
      for (const t of data) {
        const name = names.get(t.wave)
        const extra = [
          t.deps?.length ? `← ${t.deps.join(',')}` : '',
          t.dueAt ? `(due ${t.dueAt})` : '',
          t.urgent ? '!' : '',
        ].filter(Boolean).join('  ')
        console.log(`${t.id}  [wave ${t.wave}${name ? ` · ${name}` : ''}]${t.done ? ' ✓' : ''}${t.theme ? `  #${t.theme}` : ''}  ${t.title}${extra ? `  ${extra}` : ''}`)
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

// --assignees
// Prints one line per person: a3fa07cf-b1ac-4b2e-8895-a855e1c55929  Ionut
// The list is global, not per project — assignees have no project of their own.
async function assignees() {
  const { status, data } = await apiFetch('/api/assignees')
  if (status === 200) {
    // An undeployed route is answered by the SPA fallback: HTML, with status 200.
    // Without this check that would read as "nobody exists yet" instead of a fault.
    if (!Array.isArray(data)) {
      console.error('Error: /api/assignees did not return a list (route not deployed?)')
      process.exit(1)
    }
    if (!data.length) {
      console.log('(no assignees found)')
    } else {
      for (const a of data) {
        console.log(`${a.id}  ${a.name}`)
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
// [--assignee <id|name>]  gives the ticket to a person; --assignee "" takes it back.
// [--due "YYYY-MM-DD[ HH:MM]"]  sets the due date (--due "" clears it); refused on recurring tickets.
// [--urgent true|false]
// Prints: updated: KATA-03  |  moved: KATA-03 -> TK-12  |  duplicate: KATA-07  |  not_found
async function update() {
  const { id } = flags
  if (!id) {
    console.error('Usage: --update --id <ticket-id> [--title "..."] [--wave N] [--done true|false] [--deps ID1,ID2] [--desc "..."] [--notes "..."] [--theme key] [--project <target>] [--assignee <id|name>] [--selectors \'[...]\'] [--scenarios \'[...]\']')
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
  if ('assignee' in flags) {
    if (flags.assignee === true) { console.error('--assignee requires a value (use --assignee "" to clear it)'); process.exit(1) }
    body.assigneeId = flags.assignee ? String(flags.assignee) : null
  }

  if ('due' in flags) {
    if (flags.due === true) { console.error('--due requires a value (use --due "" to clear it)'); process.exit(1) }
    body.due = String(flags.due)
  }
  if ('urgent' in flags) body.urgent = boolFlag('urgent')

  if ('selectors' in flags) {
    try { body.selectors = JSON.parse(flags.selectors) }
    catch { console.error('--selectors must be valid JSON array'); process.exit(1) }
  }
  if ('scenarios' in flags) {
    try { body.scenarios = JSON.parse(flags.scenarios) }
    catch { console.error('--scenarios must be valid JSON array'); process.exit(1) }
  }

  const knownFields = ['title', 'desc', 'theme', 'wave', 'done', 'notes', 'deps', 'selectors', 'scenarios', 'projectId', 'assigneeId', 'due', 'urgent']
  if (!knownFields.some(f => f in body)) {
    console.error('Provide at least one field: --title, --wave, --done, --deps, --desc, --notes, --theme, --project, --assignee, --due, --urgent, --selectors, --scenarios')
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
  } else if (status === 409 && data.error === 'recurring') {
    console.log('recurring: the ticket repeats; change its due date in the app')
    process.exit(1)
  } else if (status === 409) {
    console.log(`duplicate: ${data.existing_id}`)
  } else if (status === 422) {
    console.log(data.theme ? `${data.error}: ${data.theme}` : data.error)
    process.exit(1)
  } else if (status === 400) {
    console.log(data.error)
    process.exit(1)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
    process.exit(1)
  }
}

function need(names, usage) {
  for (const n of names) {
    if (flags[n] === undefined || flags[n] === true) { console.error(`Usage: ${usage}`); process.exit(1) }
  }
}
function fail(status, data) {
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    console.log(data.existing_key ? `${data.error}: ${data.existing_key}` : data.error ?? `error ${status}`)
  } else {
    console.error(`Error ${status}: ${JSON.stringify(data)}`)
  }
  process.exit(1)
}

// --themes --project cc
// Prints one line per theme, in the app's order: pasul-2  #F06B1F  Pasul 2: Admiterea
async function themes() {
  need(['project'], '--themes --project <id>')
  const { status, data } = await apiFetch(`/api/themes?project=${encodeURIComponent(flags.project)}`)
  if (status !== 200) fail(status, data)
  if (!Array.isArray(data)) { console.error('Error: /api/themes did not return a list (route not deployed?)'); process.exit(1) }
  if (!data.length) console.log('(no themes found)')
  for (const t of data) console.log(`${t.key}  ${t.color}  ${t.name}`)
}

// --create-theme --project cc --name "Pasul 2: Admiterea" --color "#F06B1F"
// Prints the new key: pasul-2-admiterea   OR   duplicate_theme: <key>
async function createTheme() {
  need(['project', 'name', 'color'], '--create-theme --project <id> --name "<name>" --color "#RRGGBB"')
  const { status, data } = await apiFetch('/api/themes', {
    method: 'POST',
    body: JSON.stringify({ projectId: String(flags.project), name: String(flags.name), color: String(flags.color) }),
  })
  if (status !== 201) fail(status, data)
  console.log(data.key)
}

// --update-theme --project cc --key pasul-2 [--name "..."] [--color "#RRGGBB"]
// The key never changes (tickets hold it). Prints: updated: pasul-2
async function updateTheme() {
  need(['project', 'key'], '--update-theme --project <id> --key <key> [--name "..."] [--color "#RRGGBB"]')
  const body = {}
  if (typeof flags.name === 'string') body.name = flags.name
  if (typeof flags.color === 'string') body.color = flags.color
  const { status, data } = await apiFetch(
    `/api/themes/${encodeURIComponent(flags.key)}?project=${encodeURIComponent(flags.project)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
  if (status !== 200) fail(status, data)
  console.log(`updated: ${data.key}`)
}

// --create-wave --project cc --label "Pilot" [--name "IV"]
// Number and position are computed like in the app; the default name is the next
// roman numeral. Prints: 4  IV / Pilot
async function createWave() {
  need(['project'], '--create-wave --project <id> --label "<label>" [--name "<name>"]')
  const body = { projectId: String(flags.project), label: typeof flags.label === 'string' ? flags.label : '' }
  if (typeof flags.name === 'string') body.name = flags.name
  const { status, data } = await apiFetch('/api/waves', { method: 'POST', body: JSON.stringify(body) })
  if (status !== 201) fail(status, data)
  console.log(`${data.number}  ${waveLabel(data)}`)
}

// --update-wave --project cc --number 2 [--name "II"] [--label "Pilot"]
// Prints: updated: 2  II / Pilot
async function updateWave() {
  need(['project', 'number'], '--update-wave --project <id> --number <n> [--name "..."] [--label "..."]')
  const body = {}
  if (typeof flags.name === 'string') body.name = flags.name
  if (typeof flags.label === 'string') body.label = flags.label
  const { status, data } = await apiFetch(
    `/api/waves/${encodeURIComponent(flags.number)}?project=${encodeURIComponent(flags.project)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
  if (status !== 200) fail(status, data)
  console.log(`updated: ${data.number}  ${waveLabel(data) ?? ''}`)
}

// --delete --id CC-05
// For fixing a bad import. Refused if other tickets depend on it (has_dependents)
// or it has comments / files (has_activity) — those are deleted in the app.
// Prints: deleted: CC-05
async function del() {
  need(['id'], '--delete --id <ticket-id>')
  const { status, data } = await apiFetch(`/api/tickets/${encodeURIComponent(flags.id)}`, { method: 'DELETE' })
  if (status === 409 && data.error === 'has_dependents') {
    console.log(`has_dependents: ${data.dependedOnBy.join(', ')}`)
    process.exit(1)
  }
  if (status !== 200) fail(status, data)
  console.log(`deleted: ${data.id}`)
}

// One line per file: <attachment-id>  <filename>  <size>  <url>
function printAttachments(list) {
  for (const a of list ?? []) {
    console.log(`${a.id}  ${a.filename}  ${a.size}${a.url ? `  ${a.url}` : ''}`)
  }
}

// --attach --id KATA-03 --file poza.jpg [--file ecran.png ...]
// Uploads files onto the ticket (not onto a comment), like the app's file bar.
// Max 10 files, 25 MB each, 50 MB per call. Photos are NOT shrunk here.
// Prints one line per attached file:  <attachment-id>  <filename>  <size>  <url>
async function attach() {
  const { id } = flags
  const paths = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1] && !args[i + 1].startsWith('--')) paths.push(args[i + 1])
  }
  if (!id || id === true || !paths.length) {
    console.error('Usage: --attach --id <ticket-id> --file <path> [--file <path> ...]')
    process.exit(1)
  }
  const { readFile } = await import('fs/promises')
  const { basename } = await import('path')
  const form = new FormData()
  for (const p of paths) {
    let bytes
    try { bytes = await readFile(p) } catch (e) {
      console.error(`Cannot read ${p}: ${e.message}`)
      process.exit(1)
    }
    // No type: the API guesses it from the extension (png/jpg/webp/gif/pdf/...).
    form.append('file', new Blob([bytes]), basename(p))
  }
  // Not apiFetch: fetch must set the multipart boundary itself.
  const res = await fetch(`${API_URL}/api/tickets/${encodeURIComponent(id)}/attachments`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: form,
  })
  const data = await res.json().catch(() => ({ error: 'non-JSON response' }))
  if (res.status === 201) {
    printAttachments(data.attachments)
  } else if (res.status === 404) {
    console.log('not_found')
    process.exit(1)
  } else {
    // A partial failure still lists what landed (it stays on the ticket).
    console.error(`Error ${res.status}: ${data.error}${data.filename ? ` (${data.filename})` : ''}`)
    if (data.attachments?.length) {
      console.error('Attached before the failure:')
      printAttachments(data.attachments)
    }
    process.exit(1)
  }
}

// --attachments --id KATA-03
// Prints one line per file with a signed download URL (valid 8 h).
async function attachments() {
  const { id } = flags
  if (!id || id === true) {
    console.error('Usage: --attachments --id <ticket-id>')
    process.exit(1)
  }
  const { status, data } = await apiFetch(`/api/tickets/${encodeURIComponent(id)}/attachments`)
  if (status === 200) {
    printAttachments(data.attachments)
  } else if (status === 404) {
    console.log('not_found')
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
} else if (flags.assignees !== undefined) {
  await assignees()
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
} else if (flags.themes !== undefined) {
  await themes()
} else if (flags['create-theme'] !== undefined) {
  await createTheme()
} else if (flags['update-theme'] !== undefined) {
  await updateTheme()
} else if (flags['create-wave'] !== undefined) {
  await createWave()
} else if (flags['update-wave'] !== undefined) {
  await updateWave()
} else if (flags.attach !== undefined) {
  await attach()
} else if (flags.attachments !== undefined) {
  await attachments()
} else if (flags.delete !== undefined) {
  await del()
} else {
  console.error('Usage: node ai-client.mjs --projects|--waves|--assignees|--themes|--lookup|--create|--list|--get|--update|--delete|--create-theme|--update-theme|--create-wave|--update-wave|--attach|--attachments [options]')
  process.exit(1)
}
