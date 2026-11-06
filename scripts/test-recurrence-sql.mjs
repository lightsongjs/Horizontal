// Paritate TS ↔ SQL pentru recurență: `npm run test:recurrence-sql`
//
// Regula de salt exista in doua limbi — `src/lib/recurrence.ts` (pentru
// interfata si pentru modul local, care n-are Postgres) si `next_occurrence()`
// din migrarea de recurente (pentru cele trei drumuri de bifare care trec prin
// baza). Doua implementari ale aceleiasi reguli driftează; intrebarea e cand.
//
// Scriptul trece ACELEASI fixtures prin amandoua. Un caz adaugat in
// `src/lib/recurrence.fixtures.ts` e verificat automat si aici:
//   - `FIXTURES`: `nextOccurrence` ↔ `next_occurrence()`;
//   - `ADVANCE_FIXTURES`: bifa pe un rand real, prin trigger-ul
//     `issues_zz_advance_recurrence` ↔ `applyIssuePatch`, la ACELASI ceas
//     (`now()` al tranzactiei). Aici e si „amânat, apoi bifat" (ROUTIN-12,
//     `migration-snoozed-from.sql`): decalajul pleaca de la mementoul
//     planificat, nu de la ora amanarii.
//
// Testul SCRIE, deci porneste singur un container de unica folosinta (ca
// `test:ping-series-sql`), sau `RECURRENCE_SQL_URL=postgres://…`, tot de unica
// folosinta. NICIODATA productia — nu citeste `.env` (`PG_*`).
// De ce nu in `npm test`: cere Docker, ca `test:layout` si `test:nav`.

// ÎNAINTE de orice `new Date`: fusul trebuie sa fie cel pe care il presupune si
// SQL-ul, altfel comparam mere cu pere si testul cade pe nimic.
process.env.TZ = 'Europe/Bucharest'

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { build } from 'esbuild'

const IMAGE = process.env.RECURRENCE_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

/**
 * Incarca un modul TypeScript in Node fara unealta noua: esbuild e deja in
 * node_modules (il aduce vite), iar rezultatul se importa ca data URL.
 */
async function loadTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' })
  const code = Buffer.from(out.outputFiles[0].text).toString('base64')
  return import(`data:text/javascript;base64,${code}`)
}

const { FIXTURES, ADVANCE_FIXTURES } = await loadTs('src/lib/recurrence.fixtures.ts')
const { nextOccurrence } = await loadTs('src/lib/recurrence.ts')
const { applyIssuePatch } = await loadTs('src/lib/issuePatch.ts')

// ── baza de unică folosință ─────────────────────────────────────────────────
let container = null
let connection = process.env.RECURRENCE_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu RECURRENCE_SQL_URL=postgres://…`)
    process.exit(2)
  }
  container = run.stdout.trim()
  connection = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
}
const stop = () => { if (container) spawnSync('docker', ['rm', '-f', container]) }
process.on('exit', stop)

async function connect(url) {
  // Imaginea își rulează scripturile de init și repornește o dată: așteptăm
  // până răspunde stabil, nu doar prima dată.
  const deadline = Date.now() + 90_000
  let ok = 0
  for (;;) {
    const c = new pg.Client({ connectionString: url })
    try {
      await c.connect()
      await c.query('select 1 from auth.users limit 1')
      if (++ok >= 3) return c
      await c.end()
    } catch (e) {
      ok = 0
      await c.end().catch(() => {})
      if (Date.now() > deadline) throw e
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// `auth.jwt()`/`auth.uid()` în forma de azi, ca în `test-ping-series-sql.mjs`:
// `migration-access.sql` le cere, iar imaginea goală nu le are pe amândouă.
const admin = await connect(process.env.RECURRENCE_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))
await admin.query(`
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to postgres;
`)
await admin.end()
const db = await connect(connection)
for (const f of ['supabase/schema.sql', 'supabase/migration-access.sql', 'supabase/migration-todo.sql']) await db.query(read(f))
await db.query(`
alter table issues add column if not exists selectors jsonb not null default '[]'::jsonb;
alter table issues add column if not exists scenarios jsonb not null default '[]'::jsonb;
alter table issues add column if not exists urgent boolean not null default false;
alter table issues add column if not exists reminder_sent_at timestamptz;
`)
for (const f of ['supabase/migration-push.sql', 'supabase/migration-recurrence.sql']) await db.query(read(f))
// De două ori: migrarea trebuie să fie re-rulabilă.
await db.query(read('supabase/migration-snoozed-from.sql'))
await db.query(read('supabase/migration-snoozed-from.sql'))

/** ISO → `2026-08-25 09:00` în ora locală (care e Europe/Bucharest, vezi sus). */
function local(s) {
  if (!s) return null
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const iso = (v) => (v ? new Date(v).toISOString() : null)

let failed = 0

// ── next_occurrence ↔ nextOccurrence ────────────────────────────────────────
for (const f of FIXTURES) {
  const ts = local(nextOccurrence(f.rrule, new Date(f.from), f.due))
  const { rows } = await db.query('select next_occurrence($1, $2::timestamptz, $3::timestamptz) as n', [
    f.rrule, f.due, f.from,
  ])
  const sql = local(rows[0].n ? new Date(rows[0].n).toISOString() : null)
  const ok = ts === f.want && sql === f.want
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${f.name}\n      așteptat ${f.want} · TS ${ts} · SQL ${sql}`)
}

// ── bifa prin trigger ↔ applyIssuePatch ──────────────────────────────────────
await db.query(`insert into projects (id, name, prefix, current_wave) values ('p', 'P', 'P', 1)`)
let seq = 0
for (const f of ADVANCE_FIXTURES) {
  const id = `P-${++seq}`
  await db.query('begin')
  try {
    // `now()` e ceasul tranzacției: același în trigger și în varianta TS.
    const now = new Date((await db.query('select now() as n')).rows[0].n)
    await db.query(
      `insert into issues (id, project_id, title, wave, due_at, all_day, remind_at, snoozed_from, rrule)
       values ($1, 'p', $1, 1, $2, false, $3, $4, $5)`,
      [id, f.due, f.remind, f.snoozedFrom, f.rrule],
    )
    await db.query('update issues set done = true where id = $1', [id])
    const r = (await db.query('select due_at, remind_at, snoozed_from, done from issues where id = $1', [id])).rows[0]
    const sql = { due: iso(r.due_at), remind: iso(r.remind_at), snoozedFrom: iso(r.snoozed_from), done: r.done }
    const issue = { id, dueAt: f.due, remindAt: f.remind, snoozedFrom: f.snoozedFrom, rrule: f.rrule, allDay: false, done: false }
    const out = applyIssuePatch(issue, { done: true }, now)
    const ts = { due: out.dueAt, remind: out.remindAt, snoozedFrom: out.snoozedFrom ?? null, done: out.done }
    // Decalajul planificat (din fixture), pe care saltul trebuie să-l păstreze.
    const lead = f.want.remind ? Date.parse(f.want.due) - Date.parse(f.want.remind) : null
    const sqlLead = sql.remind ? Date.parse(sql.due) - Date.parse(sql.remind) : null
    const ok = JSON.stringify(sql) === JSON.stringify(ts) && sql.snoozedFrom === null && sql.done === false && sqlLead === lead
    if (!ok) failed++
    console.log(`${ok ? 'OK  ' : 'FAIL'}  bifă: ${f.name}\n      SQL ${JSON.stringify(sql)}${ok ? '' : `\n      TS  ${JSON.stringify(ts)} · decalaj așteptat ${lead}`}`)
  } catch (e) {
    failed++
    console.log(`FAIL  bifă: ${f.name}\n      excepție: ${e.message}`)
  } finally {
    await db.query('rollback')
  }
}
await db.end()

const total = FIXTURES.length + ADVANCE_FIXTURES.length
console.log(failed ? `\n${failed} nepotriviri.` : `\n${total} cazuri, TS și SQL de acord.`)
process.exit(failed ? 1 : 0)
