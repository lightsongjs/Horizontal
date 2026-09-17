// scripts/link-assignees.mjs — leagă un cont (auth.users) de un rând din
// `assignees`, prin `user_id`. Nicio potrivire automată după nume: ar lega
// tăcut contul greșit de munca altcuiva, iar greșeala s-ar vedea abia în
// firul unui tichet.
//
// Usage:
//   node scripts/link-assignees.mjs                      → listează
//   node scripts/link-assignees.mjs <email> <assigneeId>  → leagă
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

const [email, assigneeId] = process.argv.slice(2)
const { data: { users } } = await s.auth.admin.listUsers()
const { data: rows } = await s.from('assignees').select('id, name, user_id').order('name')

if (!email || !assigneeId) {
  console.log('Conturi:'); users.forEach((u) => console.log(' ', u.email, u.id))
  console.log('Assignees:'); rows.forEach((r) => console.log(' ', r.id, r.name, r.user_id ? '(legat)' : ''))
  console.log('\nLeagă: node scripts/link-assignees.mjs <email> <assigneeId>')
  process.exit(0)
}
const user = users.find((u) => u.email === email)
if (!user) { console.error('cont inexistent:', email); process.exit(1) }
const { error } = await s.from('assignees').update({ user_id: user.id }).eq('id', assigneeId)
if (error) { console.error(error); process.exit(1) }
console.log('legat', email, '→', assigneeId)
