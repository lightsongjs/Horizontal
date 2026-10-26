// supabase/functions/purge-trash/index.ts
//
// Golește coșul de gunoi: tichetele mai vechi de 30 de zile ies din
// `issues_trash` (`purge_expired_trash`), iar octeții pozelor lor — și ai celor
// scoase de mână cu „Șterge definitiv" — se șterg din bucket. Chemată de pg_cron
// o dată pe zi (supabase/migration-trash.sql).
//
// De ce o funcție edge și nu SQL: un `delete from storage.objects` ar scoate
// doar rândul de metadate și ar lăsa octeții în S3. Numai Storage API șterge și
// octeții.
//
// Ordinea: rândul din `storage_purge` iese abia după ce `remove` a răspuns fără
// eroare. Un eșec lasă calea în coadă, deci se reîncearcă mâine.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const BUCKET = 'attachments'
/** Câte căi pe rulare; restul rămân pentru mâine. */
const BATCH = 1000
/** Storage API primește cel mult atâtea căi într-un `remove`. */
const CHUNK = 100

Deno.serve(async (req) => {
  // Numai cheia de serviciu — altfel oricine cu URL-ul ar goli coșul.
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return json({ error: 'forbidden' }, 403)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: expired, error: pErr } = await db.rpc('purge_expired_trash', { p_days: 30 })
  if (pErr) return json({ error: pErr.message }, 500)

  const { data: queue, error: qErr } = await db.from('storage_purge').select('path').limit(BATCH)
  if (qErr) return json({ error: qErr.message, expired }, 500)

  const paths = (queue ?? []).map((r: { path: string }) => r.path)
  let removed = 0
  const failed: string[] = []
  for (let i = 0; i < paths.length; i += CHUNK) {
    const batch = paths.slice(i, i + CHUNK)
    const { error } = await db.storage.from(BUCKET).remove(batch)
    if (error) { failed.push(error.message); continue }
    const { error: dErr } = await db.from('storage_purge').delete().in('path', batch)
    if (dErr) failed.push(dErr.message)
    else removed += batch.length
  }

  return json({ expired, removed, pending: paths.length - removed, errors: failed })
})
