// Cât spațiu ocupă fiecare proiect, și ce obiecte n-au rând în tabel.
//
// Orfanii apar când ștergerea rândurilor a reușit dar ștergerea octeților nu
// (eșec de rețea în fereastra dintre cele două) — vezi `removeObjects` din
// src/data/attachments.ts. Sunt invizibili în interfață, deci scriptul ăsta e
// singurul mod de a-i găsi.
//
// Rulează: npm run storage:report
// Curăță:  npm run storage:report -- --clean
//
// Service-role, fiindcă enumerarea bucketului trece peste RLS. `storage.list()`
// NU se apelează niciodată din aplicație (politica nu e indexabilă pe scanări de
// prefix); aici e în regulă, e o unealtă de administrare rulată manual.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const BUCKET = 'attachments'
const PAGE = 100
const clean = process.argv.includes('--clean')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/** Enumeră recursiv: storage.list() nu e recursiv și paginează la 100. */
async function walk(prefix = '') {
  const found = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list('${prefix}') a eșuat: ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Un „folder" în Storage e o intrare fără metadate.
      if (entry.id === null || !entry.metadata) found.push(...(await walk(path)))
      else found.push({ path, size: entry.metadata.size ?? 0 })
    }
    if (data.length < PAGE) break
  }
  return found
}

const objects = await walk()

const { data: rows, error } = await supabase.from('attachments').select('path, project_id, size, filename')
if (error) {
  console.error('Nu s-a putut citi tabelul attachments:', error.message)
  process.exit(1)
}

const byPath = new Map(rows.map((r) => [r.path, r]))
const orphans = objects.filter((o) => !byPath.has(o.path))
const missing = rows.filter((r) => !objects.some((o) => o.path === r.path))

const perProject = new Map()
for (const o of objects) {
  const project = o.path.split('/')[0]
  perProject.set(project, (perProject.get(project) ?? 0) + o.size)
}

const mb = (b) => (b / 1024 / 1024).toFixed(2)
const total = objects.reduce((s, o) => s + o.size, 0)

console.log(`\nBucket \`${BUCKET}\`: ${objects.length} obiecte, ${mb(total)} MB\n`)
console.log('proiect              obiecte     marime')
for (const [project, bytes] of [...perProject].sort((a, b) => b[1] - a[1])) {
  const count = objects.filter((o) => o.path.startsWith(`${project}/`)).length
  console.log(`${project.padEnd(20)} ${String(count).padStart(7)}  ${mb(bytes).padStart(9)} MB`)
}

console.log(`\nOrfani (octeti fara rand in tabel): ${orphans.length}, ${mb(orphans.reduce((s, o) => s + o.size, 0))} MB`)
for (const o of orphans.slice(0, 20)) console.log(`  ${o.path}  ${mb(o.size)} MB`)
if (orphans.length > 20) console.log(`  … si inca ${orphans.length - 20}`)

console.log(`\nRanduri fara octeti (miniaturi rupte): ${missing.length}`)
for (const r of missing.slice(0, 20)) console.log(`  ${r.path}  ${r.filename}`)
if (missing.length > 20) console.log(`  … si inca ${missing.length - 20}`)

if (!clean) {
  if (orphans.length) console.log('\nRuleaza cu --clean ca sa stergi orfanii.')
  process.exit(0)
}

if (orphans.length === 0) {
  console.log('\nNimic de curatat.')
  process.exit(0)
}

// Doar orfanii. Rândurile fără octeți NU se ating: acolo lipsesc datele, iar
// ștergerea rândului ar ascunde problema în loc să o rezolve.
for (let i = 0; i < orphans.length; i += PAGE) {
  const batch = orphans.slice(i, i + PAGE).map((o) => o.path)
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch)
  if (rmErr) {
    console.error('Stergerea a esuat:', rmErr.message)
    process.exit(1)
  }
  console.log(`Sters: ${batch.length} obiecte`)
}
console.log(`\n${orphans.length} orfani stersi.`)
