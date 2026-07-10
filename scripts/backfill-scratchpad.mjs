// scripts/backfill-scratchpad.mjs
// One-off: add a Scratchpad wave (number 0) to every project that lacks one.
// Run once: `node scripts/backfill-scratchpad.mjs`. Safe to re-run (idempotent).
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: projects, error: pErr } = await supabase.from('projects').select('id')
if (pErr) throw pErr

const { data: existingScratch, error: wErr } = await supabase
  .from('waves')
  .select('project_id')
  .eq('number', 0)
if (wErr) throw wErr

const haveScratch = new Set((existingScratch ?? []).map((w) => w.project_id))
// Existing projects already have Val 1 at position 0. Insert Scratchpad at
// position -1 so it sorts first WITHOUT renumbering their existing waves.
// (New projects created after this feature seed it at position 0 instead —
// both render Scratchpad first, ordering is relative.)
const toInsert = (projects ?? [])
  .filter((p) => !haveScratch.has(p.id))
  .map((p) => ({ project_id: p.id, number: 0, name: 'Scratchpad', label: '', position: -1 }))

if (toInsert.length === 0) {
  console.log('All projects already have a Scratchpad. Nothing to do.')
} else {
  const { error: insErr } = await supabase.from('waves').insert(toInsert)
  if (insErr) throw insErr
  console.log(`Inserted Scratchpad into ${toInsert.length} project(s):`, toInsert.map((w) => w.project_id).join(', '))
}
