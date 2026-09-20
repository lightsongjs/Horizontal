// Paritate TS ↔ SQL pentru recurență: `npm run test:recurrence-sql`
//
// Regula de salt exista in doua limbi — `src/lib/recurrence.ts` (pentru
// interfata si pentru modul local, care n-are Postgres) si `next_occurrence()`
// din migrarea de recurente (pentru cele trei drumuri de bifare care trec prin
// baza). Doua implementari ale aceleiasi reguli driftează; intrebarea e cand.
//
// Scriptul trece ACELEASI fixtures prin amandoua. Un caz adaugat in
// `src/lib/recurrence.fixtures.ts` e verificat automat si aici.
//
// De ce nu in `npm test`: cere retea si credentiale, ca `test:layout` si
// `test:nav`. De ce `pg` si nu supabase-js: parametri separati, fiindca parola
// are `@` in ea (vezi CLAUDE.md).

// ÎNAINTE de orice `new Date`: fusul trebuie sa fie cel pe care il presupune si
// SQL-ul, altfel comparam mere cu pere si testul cade pe nimic.
process.env.TZ = 'Europe/Bucharest'

import pg from 'pg'
import { config } from 'dotenv'
import { build } from 'esbuild'

config()

/**
 * Incarca un modul TypeScript in Node fara unealta noua: esbuild e deja in
 * node_modules (il aduce vite), iar rezultatul se importa ca data URL.
 */
async function loadTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' })
  const code = Buffer.from(out.outputFiles[0].text).toString('base64')
  return import(`data:text/javascript;base64,${code}`)
}

const { FIXTURES } = await loadTs('src/lib/recurrence.fixtures.ts')
const { nextOccurrence } = await loadTs('src/lib/recurrence.ts')

const client = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

/** ISO → `2026-08-25 09:00` în ora locală (care e Europe/Bucharest, vezi sus). */
function local(s) {
  if (!s) return null
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

await client.connect()
let failed = 0
for (const f of FIXTURES) {
  const ts = local(nextOccurrence(f.rrule, new Date(f.from), f.due))
  const { rows } = await client.query('select next_occurrence($1, $2::timestamptz, $3::timestamptz) as n', [
    f.rrule, f.due, f.from,
  ])
  const sql = local(rows[0].n ? new Date(rows[0].n).toISOString() : null)
  const ok = ts === f.want && sql === f.want
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${f.name}\n      așteptat ${f.want} · TS ${ts} · SQL ${sql}`)
}
await client.end()

console.log(failed ? `\n${failed} nepotriviri.` : `\n${FIXTURES.length} cazuri, TS și SQL de acord.`)
process.exit(failed ? 1 : 0)
