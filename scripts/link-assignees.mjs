// scripts/link-assignees.mjs — leagă un cont (auth.users) de un rând din
// `assignees`, prin `user_id`. Nicio potrivire automată după nume: ar lega
// tăcut contul greșit de munca altcuiva, iar greșeala s-ar vedea abia în
// firul unui tichet.
//
// Usage:
//   node scripts/link-assignees.mjs                          → listează
//   node scripts/link-assignees.mjs <email> <assigneeId>      → leagă un rând existent
//   node scripts/link-assignees.mjs --create <nume> <email>   → creează rândul ȘI îl leagă
//
// `--create` există fiindcă `assignees` e goală pe o bază nouă: fără el, omul
// rulează exact ce scrie în CLAUDE.md, vede o listă goală și n-are unde merge
// — nici un `<assigneeId>` de dat scriptului. Rândul creat capătă `user_id`
// direct la inserare, deci nu mai există o fereastră în care numele există dar
// nu e legat de nimeni.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

const args = process.argv.slice(2)

if (args[0] === '--create') {
  const [, name, email] = args
  if (!name || !email) {
    console.error('Usage: node scripts/link-assignees.mjs --create <nume> <email>')
    process.exit(1)
  }
  const { data: { users } } = await s.auth.admin.listUsers()
  const user = users.find((u) => u.email === email)
  if (!user) { console.error('cont inexistent:', email); process.exit(1) }
  const { data: existing } = await s.from('assignees').select('id, name').eq('user_id', user.id).maybeSingle()
  if (existing) {
    console.error(`${email} e deja legat de „${existing.name}" (${existing.id}) — nu creez un al doilea rând.`)
    process.exit(1)
  }
  const { data: row, error } = await s.from('assignees').insert({ name, user_id: user.id }).select('id, name').single()
  if (error) { console.error(error); process.exit(1) }
  console.log('creat și legat', row.name, `(${row.id})`, '→', email)
  process.exit(0)
}

const [email, assigneeId] = args
const { data: { users } } = await s.auth.admin.listUsers()
const { data: rows } = await s.from('assignees').select('id, name, user_id').order('name')

if (!email || !assigneeId) {
  console.log('Conturi:'); users.forEach((u) => console.log(' ', u.email, u.id))
  console.log('Assignees:'); rows.forEach((r) => console.log(' ', r.id, r.name, r.user_id ? '(legat)' : ''))
  console.log('\nLeagă un rând existent: node scripts/link-assignees.mjs <email> <assigneeId>')
  console.log('Creează un nume nou și leagă-l: node scripts/link-assignees.mjs --create <nume> <email>')
  process.exit(0)
}
const user = users.find((u) => u.email === email)
if (!user) { console.error('cont inexistent:', email); process.exit(1) }
const { error } = await s.from('assignees').update({ user_id: user.id }).eq('id', assigneeId)
if (error) { console.error(error); process.exit(1) }
console.log('legat', email, '→', assigneeId)
