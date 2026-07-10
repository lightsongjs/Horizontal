// scripts/normalize-wave-names.mjs
// One-off: rename every delivery wave (number !== 0) to its Roman numeral based
// on position order, per project. Scratchpad (number 0) is left untouched.
// Run once: `node scripts/normalize-wave-names.mjs`. Safe to re-run (idempotent).
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

function toRoman(n) {
  const map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  for (const [value, symbol] of map) {
    while (n >= value) {
      out += symbol
      n -= value
    }
  }
  return out
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: waves, error } = await supabase
  .from('waves')
  .select('project_id, number, name, position')
if (error) throw error

// Group delivery waves by project, ordered by position.
const byProject = new Map()
for (const w of waves ?? []) {
  if (w.number === 0) continue
  if (!byProject.has(w.project_id)) byProject.set(w.project_id, [])
  byProject.get(w.project_id).push(w)
}

let updated = 0
for (const [, list] of byProject) {
  list.sort((a, b) => a.position - b.position)
  for (let i = 0; i < list.length; i++) {
    const w = list[i]
    const roman = toRoman(i + 1)
    if (w.name === roman) continue
    const { error: upErr } = await supabase
      .from('waves')
      .update({ name: roman })
      .eq('project_id', w.project_id)
      .eq('number', w.number)
    if (upErr) throw upErr
    updated++
  }
}

console.log(updated === 0 ? 'All wave names already normalized. Nothing to do.' : `Renamed ${updated} wave(s) to Roman numerals.`)
