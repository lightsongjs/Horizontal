// Seriile de mementouri, pe un Postgres real: `npm run test:ping-series-sql`
//
// Ca `test:notes-sql`: testul SCRIE, deci pornește singur un container de
// unică folosință (sau `PING_SQL_URL=postgres://…`, tot de unică folosință).
// NICIODATĂ producția.
//
// Cazurile:
//   - constrângerea pasului (1–720) și migrarea re-rulabilă, cu UN singur job
//     de cron;
//   - `roll_ping_series()` ↔ `rollPingSeries` din `src/lib/pingSeries.ts`
//     (modul local): aceleași rânduri, aceeași ieșire — regula e scrisă în
//     două limbi, deci o compară aici, pe ceasul bazei;
//   - revendicarea din `send-reminders` (`reminder_sent_at` = pingul) nu se
//     bate cu trigger-ele de memento: o a doua revendicare a aceluiași ping nu
//     prinde, una pentru pingul următor da, iar `remind_at` rămâne neatins;
//   - „Gata azi": o serie zilnică sare pe mâine cu aceeași fereastră, una doar
//     de azi se închide.

// ÎNAINTE de orice `new Date`: SQL-ul socotește zilele în Europe/Bucharest.
process.env.TZ = 'Europe/Bucharest'

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { build } from 'esbuild'

const IMAGE = process.env.PING_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

/** Un modul TypeScript în Node, ca în `test-recurrence-sql.mjs`. */
async function loadTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}
const { rollPingSeries } = await loadTs('src/lib/pingSeries.ts')

// ── baza ────────────────────────────────────────────────────────────────────
let container = null
let connection = process.env.PING_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu PING_SQL_URL=postgres://…`)
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

// `supabase_admin` pune doar ce lipsește din imagine (pe Supabase, pg_cron e
// deja activat de `migration-cron.sql`); restul rulează ca `postgres`.
const admin = await connect(process.env.PING_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))
// `auth.jwt()`/`auth.uid()` în forma de azi, ca în `test-notes-sql.mjs`:
// `migration-access.sql` le cere, iar imaginea goală nu le are pe amândouă.
await admin.query(`
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to postgres;
create extension if not exists pg_cron;
grant usage on schema cron to postgres;
grant all on all tables in schema cron to postgres;
grant all on all sequences in schema cron to postgres;
grant execute on all functions in schema cron to postgres;
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
await db.query(read('supabase/migration-ping-series.sql'))
await db.query(read('supabase/migration-ping-series.sql'))

// ── unelte ──────────────────────────────────────────────────────────────────
let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`)
}

/** Un caz = o tranzacție anulată la final: cazurile nu se văd între ele. */
async function scenario(name, fn) {
  await db.query('begin')
  try {
    await fn()
  } catch (e) {
    check(name, false, `excepție: ${e.message}`)
  } finally {
    await db.query('rollback')
  }
}

await db.query(`insert into projects (id, name, prefix, current_wave) values ('p', 'P', 'P', 1)`)
let seq = 0
async function issue(cols) {
  const id = `P-${++seq}`
  const keys = ['id', 'project_id', 'title', 'wave', ...Object.keys(cols)]
  const vals = [id, 'p', id, 1, ...Object.values(cols)]
  await db.query(`insert into issues (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals)
  return id
}
const row = async (id) => (await db.query('select due_at, remind_at, done, reminder_sent_at, rrule, ping_every from issues where id = $1', [id])).rows[0]
const iso = (v) => (v ? new Date(v).toISOString() : null)

// ── constrângerea și migrarea ─────────────────────────────────────────────────
for (const [every, ok] of [[0, false], [1, true], [720, true], [721, false]]) {
  await scenario(`ping_every = ${every} ${ok ? 'acceptat' : 'refuzat'}`, async () => {
    let threw = false
    try { await issue({ ping_every: every }) } catch { threw = true }
    check(`ping_every = ${every} ${ok ? 'acceptat' : 'refuzat'}`, threw === !ok)
  })
}
{
  const { rows } = await db.query(`select count(*)::int as n from cron.job where jobname = 'roll-ping-series'`)
  check('migrarea rulată de două ori: un singur job „roll-ping-series"', rows[0].n === 1, `${rows[0].n} joburi`)
}

// ── roll_ping_series ↔ rollPingSeries ────────────────────────────────────────
// Rândurile se scriu relativ la ceasul BAZEI (`now()` dintr-o tranzacție e
// fix), iar TS primește exact acel `now` — altfel cele două ar putea cădea de o
// parte și de alta a miezului nopții.
// Rotunjit la minut, ca orice scadență reală: secundele nu există în model
// (TS le taie la salt, SQL le-ar păstra — o diferență fără obiect).
const H = 3_600_000
const D = 24 * H
const CASES = [
  { name: 'zilnică, nebifată, fereastra de ieri: aceeași fereastră, următoarea zi', rrule: 'FREQ=DAILY', every: 15, due: -D + 2 * H, lead: H },
  { name: 'zilnică, fereastra a trecut acum 3 zile: zilele sărite dispar', rrule: 'FREQ=DAILY', every: 60, due: -3 * D, lead: 8 * H },
  { name: 'lunea și joia: următoarea zi a seriei', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', every: 30, due: -2 * H, lead: H },
  { name: 'doar de azi (rrule null): rămâne restantă', rrule: null, every: 15, due: -H, lead: H },
  { name: 'fereastra încă deschisă: neatinsă', rrule: 'FREQ=DAILY', every: 15, due: H, lead: 2 * H },
  { name: 'bifată: neatinsă', rrule: 'FREQ=DAILY', every: 15, due: -H, lead: H, done: true },
  { name: 'recurentă obișnuită (fără ping_every): neatinsă', rrule: 'FREQ=DAILY', every: null, due: -H, lead: 0 },
]
for (const c of CASES) {
  await scenario(c.name, async () => {
    const now = new Date((await db.query("select date_trunc('minute', now()) as n")).rows[0].n)
    const due = new Date(now.getTime() + c.due).toISOString()
    const remind = new Date(now.getTime() + c.due - c.lead).toISOString()
    const id = await issue({ due_at: due, remind_at: remind, all_day: false, rrule: c.rrule, ping_every: c.every, done: !!c.done, reminder_sent_at: remind })
    await db.query('select roll_ping_series()')
    const got = await row(id)
    const ts = rollPingSeries({
      id, projectId: 'p', title: id, done: !!c.done, dueAt: due, remindAt: remind, allDay: false, rrule: c.rrule, pingEvery: c.every,
    }, now)
    const moved = ts.dueAt !== due
    const ok = iso(got.due_at) === ts.dueAt && iso(got.remind_at) === ts.remindAt
      && (moved ? got.reminder_sent_at === null : iso(got.reminder_sent_at) === remind)
    check(c.name, ok, `SQL ${iso(got.remind_at)} → ${iso(got.due_at)} (trimis ${iso(got.reminder_sent_at)}) · TS ${ts.remindAt} → ${ts.dueAt}`)
  })
}

// ── revendicarea din send-reminders ──────────────────────────────────────────
await scenario('revendicarea unui ping: o dată, apoi următorul; remind_at neatins', async () => {
  const id = await issue({ due_at: '2026-11-06T08:00:00Z', remind_at: '2026-11-06T07:00:00Z', all_day: false, ping_every: 15 })
  const claim = (ping) => db.query(
    `update issues set reminder_sent_at = $2 where id = $1 and (reminder_sent_at is null or reminder_sent_at < $2) returning id`, [id, ping])
  const a = (await claim('2026-11-06T07:15:00Z')).rowCount
  const b = (await claim('2026-11-06T07:15:00Z')).rowCount
  const c = (await claim('2026-11-06T07:30:00Z')).rowCount
  const r = await row(id)
  check('revendicarea unui ping: o dată, apoi următorul; remind_at neatins',
    a === 1 && b === 0 && c === 1 && iso(r.remind_at) === '2026-11-06T07:00:00.000Z' && iso(r.reminder_sent_at) === '2026-11-06T07:30:00.000Z',
    `revendicări ${a}/${b}/${c}, remind_at ${iso(r.remind_at)}, trimis ${iso(r.reminder_sent_at)}`)
})

// ── „Gata azi" ───────────────────────────────────────────────────────────────
await scenario('„Gata azi" pe o serie zilnică: mâine, aceeași fereastră, nelivrată', async () => {
  const now = new Date((await db.query("select date_trunc('minute', now()) as n")).rows[0].n)
  const due = new Date(now.getTime() + 2 * H).toISOString()
  const remind = new Date(now.getTime() + H).toISOString()
  const id = await issue({ due_at: due, remind_at: remind, all_day: false, rrule: 'FREQ=DAILY', ping_every: 15, reminder_sent_at: remind })
  await db.query('update issues set done = true where id = $1', [id])
  const r = await row(id)
  const lead = new Date(r.due_at).getTime() - new Date(r.remind_at).getTime()
  check('„Gata azi" pe o serie zilnică: mâine, aceeași fereastră, nelivrată',
    !r.done && new Date(r.due_at) > new Date(due) && lead === H && r.reminder_sent_at === null && r.ping_every === 15,
    JSON.stringify(r))
})
await scenario('„Gata azi" pe o serie doar de azi: se închide', async () => {
  const id = await issue({ due_at: '2026-11-06T08:00:00Z', remind_at: '2026-11-06T07:00:00Z', all_day: false, ping_every: 15 })
  await db.query('update issues set done = true where id = $1', [id])
  const r = await row(id)
  check('„Gata azi" pe o serie doar de azi: se închide', r.done === true && iso(r.due_at) === '2026-11-06T08:00:00.000Z', JSON.stringify(r))
})

await db.end()
console.log(failed ? `\n${failed} eșecuri, ${passed} trecute.` : `\n${passed} cazuri, toate trecute.`)
process.exit(failed ? 1 : 0)
