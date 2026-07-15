// scripts/set-admin.mjs — mark a user as global admin.
// Usage: node scripts/set-admin.mjs you@example.com
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()

const email = process.argv[2]
if (!email) { console.error('Usage: node scripts/set-admin.mjs <email>'); process.exit(1) }

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data, error } = await supabase.auth.admin.listUsers()
if (error) { console.error(error.message); process.exit(1) }
const user = data.users.find((u) => u.email === email)
if (!user) { console.error(`No user with email ${email}`); process.exit(1) }

const { error: upErr } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: 'admin' },
})
if (upErr) { console.error(upErr.message); process.exit(1) }
console.log(`OK: ${email} is now admin`)
