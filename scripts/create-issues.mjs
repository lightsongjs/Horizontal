/**
 * create-issues.mjs — inserează tichete în DepFlow via Supabase
 *
 * Folosire:
 *   node scripts/create-issues.mjs issues.json
 *   node scripts/create-issues.mjs issues.json --dry-run   (arată ce ar face, fără să scrie)
 *   cat issues.json | node scripts/create-issues.mjs       (citește din stdin)
 *
 * Format input (array JSON):
 * [
 *   {
 *     "id":        "TUR-09",           // obligatoriu
 *     "projectId": "tur",              // obligatoriu
 *     "title":     "Titlu tichet",     // obligatoriu
 *     "details":   "Descriere lungă",  // opțional
 *     "theme":     "auth",             // opțional — cheie din tabela themes
 *     "wave":      1,                  // opțional, default 1
 *     "deps":      ["TUR-02"],         // opțional — array de id-uri de care depinde
 *     "done":      false               // opțional, default false
 *   }
 * ]
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'

config()

const DRY_RUN = process.argv.includes('--dry-run')
const filePath = process.argv.find((a) => a.endsWith('.json'))

// --- Citire input ---
let raw
if (filePath) {
  raw = readFileSync(filePath, 'utf8')
} else if (!process.stdin.isTTY) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  raw = Buffer.concat(chunks).toString('utf8')
} else {
  console.error('❌  Niciun input. Dă un fișier .json sau pipe prin stdin.')
  process.exit(1)
}

const issues = JSON.parse(raw)
if (!Array.isArray(issues) || issues.length === 0) {
  console.error('❌  Input-ul trebuie să fie un array JSON cu cel puțin un tichet.')
  process.exit(1)
}

// --- Validare câmpuri obligatorii ---
const errors = []
for (const issue of issues) {
  if (!issue.id)        errors.push(`Tichet fără "id": ${JSON.stringify(issue)}`)
  if (!issue.projectId) errors.push(`Tichet "${issue.id}" fără "projectId"`)
  if (!issue.title)     errors.push(`Tichet "${issue.id}" fără "title"`)
}
if (errors.length) {
  errors.forEach((e) => console.error('❌ ', e))
  process.exit(1)
}

// --- Preview ---
console.log(`\n📋  ${issues.length} tichet(e) de inserat${DRY_RUN ? ' (DRY RUN — nu se scrie nimic)' : ''}:\n`)
for (const issue of issues) {
  const deps = issue.deps?.length ? ` → depinde de [${issue.deps.join(', ')}]` : ''
  console.log(`  ${issue.id.padEnd(12)} ${issue.title}${deps}`)
}
console.log()

if (DRY_RUN) {
  console.log('✅  Dry run complet. Rulează fără --dry-run ca să inserezi.')
  process.exit(0)
}

// --- Supabase client ---
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// --- Upsert issues ---
const issueRows = issues.map((issue) => ({
  id:         issue.id,
  project_id: issue.projectId,
  title:      issue.title,
  details:    issue.details ?? null,
  theme:      issue.theme ?? null,
  wave:       issue.wave ?? 1,
  done:       issue.done ?? false,
}))

const { error: issueErr } = await supabase
  .from('issues')
  .upsert(issueRows, { onConflict: 'id' })

if (issueErr) {
  console.error('❌  Eroare la inserare tichete:', issueErr.message)
  process.exit(1)
}
console.log(`✅  ${issueRows.length} tichet(e) inserate/actualizate.`)

// --- Upsert dependencies ---
const depRows = issues.flatMap((issue) =>
  (issue.deps ?? []).map((dep) => ({
    issue_id:      issue.id,
    depends_on_id: dep,
  }))
)

if (depRows.length > 0) {
  const { error: depErr } = await supabase
    .from('dependencies')
    .upsert(depRows, { onConflict: 'issue_id,depends_on_id' })

  if (depErr) {
    console.error('❌  Eroare la inserare dependențe:', depErr.message)
    process.exit(1)
  }
  console.log(`✅  ${depRows.length} dependență/dependențe inserate/actualizate.`)
} else {
  console.log('ℹ️   Nicio dependență de inserat.')
}

console.log('\n🎉  Done!\n')
