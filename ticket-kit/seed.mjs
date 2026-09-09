// Portable Horizontal ticket seeder. See README.md for usage.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'

// .env is at the project root (one level up), alongside the app's own env vars.
config({ path: '../.env' })

const db = createClient(
  process.env.HORIZONTAL_SUPABASE_URL,
  process.env.HORIZONTAL_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

async function listIssues(prefix) {
  const projectId = prefix.toLowerCase()
  const { data, error } = await db.from('issues').select('id, title, wave, done').eq('project_id', projectId).order('id')
  if (error) throw error
  if (!data.length) {
    console.log(`Niciun tichet pentru proiectul "${projectId}".`)
    return
  }
  for (const i of data) console.log(`${i.id}  [wave ${i.wave}]${i.done ? ' (done)' : ''}  ${i.title}`)
}

async function seed(specPath) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const projectId = spec.project.prefix.toLowerCase()

  const { data: existingProject } = await db.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (!existingProject) {
    const { error } = await db.from('projects').insert({
      id: projectId,
      name: spec.project.name,
      description: spec.project.description ?? '',
      prefix: spec.project.prefix.toUpperCase(),
      current_wave: 1,
      accent: spec.project.accent ?? '#6e7bff',
      type: spec.project.type ?? 'personal',
    })
    if (error) throw error
    const { error: wErr } = await db.from('waves').insert({ project_id: projectId, number: 1, name: 'Val 1', label: 'MVP', position: 0 })
    if (wErr) throw wErr
    console.log(`Proiect creat: ${projectId}`)
  } else {
    console.log(`Proiect existent, reutilizat: ${projectId}`)
  }

  const { data: existingWaves } = await db.from('waves').select('number').eq('project_id', projectId)
  const existingWaveNumbers = new Set((existingWaves ?? []).map((w) => w.number))
  for (const w of (spec.waves ?? []).filter((w) => w.number !== 1 && !existingWaveNumbers.has(w.number))) {
    const { error } = await db.from('waves').insert({ project_id: projectId, ...w })
    if (error) throw error
  }

  const { data: existingThemes } = await db.from('themes').select('key').eq('project_id', projectId)
  const existingThemeKeys = new Set((existingThemes ?? []).map((t) => t.key))
  const themeKeys = {}
  for (const t of spec.themes ?? []) {
    const key = t.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!existingThemeKeys.has(key)) {
      const { error } = await db.from('themes').insert({ project_id: projectId, key, name: t.name, color: t.color })
      if (error) throw error
    }
    themeKeys[t.name] = key
  }

  const { data: existingIssues, error: exErr } = await db.from('issues').select('id').eq('project_id', projectId)
  if (exErr) throw exErr
  let next = (existingIssues ?? [])
    .map((r) => Number(r.id.slice(spec.project.prefix.length + 1)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0) + 1

  const idByKey = {}
  for (const t of spec.tickets) idByKey[t.key] = `${spec.project.prefix.toUpperCase()}-${String(next++).padStart(2, '0')}`

  const { error: insErr } = await db.from('issues').insert(spec.tickets.map((t) => ({
    id: idByKey[t.key],
    project_id: projectId,
    title: t.title,
    details: t.desc ?? '',
    theme: t.theme ? (themeKeys[t.theme] ?? t.theme) : null,
    wave: t.wave ?? 1,
    done: false,
    selectors: t.selectors ?? [],
    scenarios: t.scenarios ?? [],
    notes: t.notes ?? '',
    assignee_id: t.assigneeId ?? null,
  })))
  if (insErr) throw insErr

  // deps pot fi chei temporare din acest batch (idByKey) SAU ID-uri reale ale
  // unor tichete deja existente (ex. "KATA-01") — folosite ca atare dacă nu
  // sunt găsite printre cheile temporare.
  const deps = spec.tickets.flatMap((t) => (t.deps ?? []).map((depKey) => ({
    issue_id: idByKey[t.key],
    depends_on_id: idByKey[depKey] ?? depKey,
  })))
  if (deps.length) {
    const { error: depErr } = await db.from('dependencies').insert(deps)
    if (depErr) throw depErr
  }

  console.log(`Create ${spec.tickets.length} tichete în ${projectId}: ${Object.values(idByKey).join(', ')}`)
}

const [, , cmd, arg] = process.argv
if (cmd === '--list') {
  if (!arg) { console.error('Folosire: node seed.mjs --list <prefix>'); process.exit(1) }
  await listIssues(arg)
} else if (cmd) {
  await seed(cmd)
} else {
  console.error('Folosire: node seed.mjs <horizontal_project_settings.json>  |  node seed.mjs --list <prefix>')
  process.exit(1)
}
