// Creează bucketul privat `attachments`. Cheia anon nu poate insera în
// storage.buckets, deci pasul ăsta cere service-role și nu poate fi făcut din
// aplicație. Idempotent: dacă bucketul există, spune și iese cu 0.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: existing, error: listErr } = await supabase.storage.listBuckets()
if (listErr) {
  console.error('Nu s-au putut citi bucketurile:', listErr.message)
  process.exit(1)
}
if (existing.some((b) => b.name === 'attachments')) {
  console.log('Bucketul `attachments` există deja. Nimic de făcut.')
  process.exit(0)
}

const { error } = await supabase.storage.createBucket('attachments', { public: false })
if (error) {
  console.error('Crearea bucketului a eșuat:', error.message)
  process.exit(1)
}
console.log('Bucketul privat `attachments` a fost creat.')
