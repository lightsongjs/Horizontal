// Notițele (valul 0) ascunse de membrii fără drept, pe un Postgres real:
// `npm run test:notes-sql`
//
// Ca `test:trash-sql`: testul SCRIE, deci pornește singur un container de
// unică folosință (sau `NOTES_SQL_URL=postgres://…`, tot de unică folosință).
// NICIODATĂ producția.
//
// Cazurile: clientul nu vede tichetul-notiță, nici valul 0, nici firul,
// fișierele (rânduri și obiecte din Storage, și cele încă fără rând), nici
// dependențele / obstacolele spre el, nici „Ale mele", nici coșul; nu poate
// scrie în Notițe, nici muta / restaura / șterge definitiv o notiță; membrul
// cu dreptul și adminul văd tot; scoasă din Notițe, notița se vede întreagă.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const IMAGE = process.env.NOTES_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// ── baza ────────────────────────────────────────────────────────────────────
let container = null
let connection = process.env.NOTES_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu NOTES_SQL_URL=postgres://…`)
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

// Două conexiuni: `supabase_admin` (superuser) pune doar ce lipsește din
// imagine; restul rulează ca `postgres`, ca pe Supabase — funcția `security
// definer` îi aparține lui, deci testul vede exact drepturile de producție.
const admin = await connect(process.env.NOTES_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))

// Ce imaginea goală nu are, dar Supabase da: `auth.jwt()`, `auth.uid()` care
// citește și `request.jwt.claims` (forma de azi), tabela de obiecte din
// Storage (o creează storage-api, nu imaginea) și coloanele puse cândva din
// dashboard, nu din migrări.
const HARNESS = `
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
grant usage on schema auth, storage to postgres;
grant select, insert on auth.users to postgres;
grant all on storage.objects to postgres;
alter table storage.objects owner to postgres;
`
const EXTRA_COLUMNS = `
alter table issues add column if not exists selectors jsonb not null default '[]'::jsonb;
alter table issues add column if not exists scenarios jsonb not null default '[]'::jsonb;
alter table issues add column if not exists notes text not null default '';
alter table issues add column if not exists urgent boolean not null default false;
alter table issues add column if not exists reminder_sent_at timestamptz;
alter table projects add column if not exists type text;
`

await admin.query(HARNESS)
await admin.end()
const db = await connect(connection)
for (const f of ['supabase/schema.sql', 'supabase/migration-access.sql', 'supabase/migration-todo.sql']) await db.query(read(f))
await db.query(EXTRA_COLUMNS)
for (const f of ['supabase/migration-push.sql', 'supabase/migration-attachments.sql', 'supabase/migration-comments.sql', 'supabase/migration-obstacles.sql', 'supabase/migration-routines.sql', 'supabase/migration-notes-access.sql']) {
  // migration-push cere pg_cron/vault doar în migration-cron, nu aici.
  await db.query(read(f))
}
// De două ori: migrările trebuie să fie re-rulabile.
for (const f of ['supabase/migration-move-issue.sql', 'supabase/migration-trash.sql']) {
  await db.query(read(f))
  await db.query(read(f))
}

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

async function user({ admin = false } = {}) {
  const id = randomUUID()
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data, aud, role) values ($1, $2, $3, 'authenticated', 'authenticated')`,
    [id, `${id.slice(0, 8)}@test.local`, admin ? { role: 'admin' } : {}],
  )
  return { id, admin }
}
const project = (id, prefix, name = id, wave = 1) =>
  db.query(`insert into projects (id, name, prefix, current_wave) values ($1, $2, $3, $4)`, [id, name, prefix, wave])
const member = (u, pid, role = 'write') =>
  db.query(`insert into project_members (user_id, project_id, role) values ($1, $2, $3)`, [u.id, pid, role])
const issue = (id, pid, extra = {}) =>
  db.query(
    `insert into issues (id, project_id, title, wave, theme, due_at, rrule, urgent, done, created_by, reminder_sent_at, assignee_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, pid, extra.title ?? `titlu ${id}`, extra.wave ?? 1, extra.theme ?? null, extra.dueAt ?? null, extra.rrule ?? null,
      extra.urgent ?? false, extra.done ?? false, extra.createdBy ?? null, extra.reminderSentAt ?? null, extra.assigneeId ?? null],
  )

/** `move_issue` ca utilizatorul dat, cu RLS și grant-urile lui `authenticated`. */
async function moveAs(u, id, target) {
  await db.query('savepoint mv')
  try {
    const claims = JSON.stringify({ sub: u.id, role: 'authenticated', app_metadata: u.admin ? { role: 'admin' } : {} })
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    await db.query('set local role authenticated')
    const { rows } = await db.query('select public.move_issue($1, $2) as id', [id, target])
    await db.query('reset role')
    await db.query('release savepoint mv')
    return { id: rows[0].id }
  } catch (e) {
    await db.query('rollback to savepoint mv')
    await db.query('reset role')
    return { error: e }
  }
}
async function asUser(u, sql, params = []) {
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })])
  await db.query('set local role authenticated')
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role') }
}
const refused = (r, code, text) =>
  !!r.error && r.error.code === code && (!text || r.error.message.includes(text))
const why = (r) => (r.error ? `${r.error.code}: ${r.error.message}` : `a mutat în ${r.id}`)

/** O instrucțiune ca utilizatorul dat; `{ value, rows }` sau `{ error }`. */
async function rpcAs(u, sql, params = []) {
  await db.query('savepoint rp')
  try {
    const claims = JSON.stringify({ sub: u.id, role: 'authenticated', app_metadata: u.admin ? { role: 'admin' } : {} })
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    await db.query('set local role authenticated')
    const { rows } = await db.query(sql, params)
    await db.query('reset role')
    await db.query('release savepoint rp')
    return { value: rows[0] ? Object.values(rows[0])[0] : undefined, rows }
  } catch (e) {
    await db.query('rollback to savepoint rp')
    await db.query('reset role')
    return { error: e }
  }
}
const del = (u, ...ids) => rpcAs(u, 'delete from issues where id = any($1) returning id', [ids])
const restore = (u, trashId) => rpcAs(u, 'select public.restore_issue($1) as r', [trashId])
const trashOf = async (issueId) => (await db.query('select * from issues_trash where issue_id = $1 order by deleted_at desc', [issueId])).rows[0]

const err = (r) => (r.error ? `${r.error.code}: ${r.error.message}` : JSON.stringify(r.value))
const n = (r) => (r.error ? `eroare ${r.error.code}: ${r.error.message}` : `${r.rows.length} rânduri`)
const wave = (pid, number) => db.query(`insert into waves (project_id, number, name) values ($1, $2, $3)`, [pid, number, number === 0 ? 'Notițe' : `V${number}`])
const comment = (id, author) => db.query(`insert into issue_events (issue_id, project_id, kind, author_id, body) values ($1, 'hz', 'comment', $2, 'secret')`, [id, author])
const attach = (id, path) => db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ($1, 'hz', $2, 'f', 1, 'audio/ogg')`, [id, path])
const object = (path) => db.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [path])

/** Proiectul hz cu V1 + Notițe, un client, un coleg cu drept, un admin. */
async function setup() {
  await project('hz', 'HZ')
  await wave('hz', 0); await wave('hz', 1)
  const client = await user(); await member(client, 'hz')
  const mate = await user(); await member(mate, 'hz')
  await db.query(`update project_members set can_see_notes = true where user_id = $1`, [mate.id])
  const boss = await user({ admin: true })
  await issue('HZ-01', 'hz')
  await issue('HZ-02', 'hz', { wave: 0 })
  return { client, mate, boss }
}

await scenario('citirea', async () => {
  const { client, mate, boss } = await setup()
  await comment('HZ-02', boss.id); await comment('HZ-01', boss.id)
  await attach('HZ-02', 'hz/HZ-02/a.ogg'); await object('hz/HZ-02/a.ogg')
  await attach('HZ-01', 'hz/HZ-01/b.png'); await object('hz/HZ-01/b.png')
  await object('hz/HZ-02/fara-rand.ogg')
  await db.query(`insert into dependencies (issue_id, depends_on_id) values ('HZ-01', 'HZ-02')`)
  await db.query(`insert into obstacles (id, project_id, title) values ('O1', 'hz', 'o')`)
  await db.query(`insert into obstacle_issues (obstacle_id, issue_id) values ('O1', 'HZ-02')`)
  const ids = (r) => (r.rows ?? []).map((x) => Object.values(x)[0]).sort().join(',')

  const q = {
    issues: 'select id from issues order by id',
    waves: 'select number from waves order by number',
    events: 'select issue_id from issue_events order by issue_id',
    attachments: 'select issue_id from attachments order by issue_id',
    objects: 'select name from storage.objects order by name',
    deps: 'select depends_on_id from dependencies',
    obstacles: 'select issue_id from obstacle_issues',
  }
  const want = {
    client: { issues: 'HZ-01', waves: '1', events: 'HZ-01', attachments: 'HZ-01', objects: 'hz/HZ-01/b.png', deps: '', obstacles: '' },
    mate: { issues: 'HZ-01,HZ-02', waves: '0,1', events: 'HZ-01,HZ-02', attachments: 'HZ-01,HZ-02', objects: 'hz/HZ-01/b.png,hz/HZ-02/a.ogg,hz/HZ-02/fara-rand.ogg', deps: 'HZ-02', obstacles: 'HZ-02' },
  }
  want.boss = want.mate
  for (const [who, u] of Object.entries({ client, mate, boss })) {
    for (const [k, sql] of Object.entries(q)) {
      const r = await rpcAs(u, sql)
      check(`${who} · ${k}`, !r.error && ids(r) === want[who][k], r.error ? n(r) : ids(r))
    }
  }
})

await scenario('„Ale mele" nu scapă o notiță pasată clientului', async () => {
  const { client } = await setup()
  const { rows: [a] } = await db.query(`insert into assignees (name, user_id) values ('Client', $1) returning id`, [client.id])
  await db.query(`update issues set assignee_id = $1`, [a.id])
  const r = await rpcAs(client, 'select issue_id from inbox_rows')
  check('inbox_rows: doar HZ-01', !r.error && r.rows.length === 1 && r.rows[0].issue_id === 'HZ-01', n(r))
})

await scenario('scrierea clientului', async () => {
  const { client, mate } = await setup()
  const ins = await rpcAs(client, `insert into issues (id, project_id, title, wave) values ('HZ-03', 'hz', 'x', 0)`)
  check('nu creează în Notițe', !!ins.error, n(ins))
  const mv = await rpcAs(client, `update issues set wave = 0 where id = 'HZ-01'`)
  check('nu mută în Notițe', !!mv.error, n(mv))
  const up = await rpcAs(client, `update issues set title = 'x' where id = 'HZ-02' returning id`)
  check('nu editează o notiță', !up.error && up.rows.length === 0, n(up))
  const dl = await rpcAs(client, `delete from issues where id = 'HZ-02' returning id`)
  check('nu șterge o notiță', !dl.error && dl.rows.length === 0, n(dl))
  const cm = await rpcAs(client, `insert into issue_events (issue_id, project_id, kind, author_id, body) values ('HZ-02', 'hz', 'comment', '${client.id}', 'x')`)
  check('nu comentează pe o notiță', !!cm.error, n(cm))
  const wv = await rpcAs(client, `update waves set label = 'x' where number = 0 returning number`)
  check('nu redenumește Notițele', !wv.error && wv.rows.length === 0, n(wv))
  const ok = await rpcAs(mate, `insert into issues (id, project_id, title, wave) values ('HZ-03', 'hz', 'x', 0) returning id`)
  check('colegul cu drept creează în Notițe', !ok.error && ok.rows.length === 1, n(ok))
})

await scenario('mutarea în alt proiect', async () => {
  const { client } = await setup()
  await project('ap', 'AP'); await wave('ap', 1); await member(client, 'ap')
  const r = await moveAs(client, 'HZ-02', 'ap')
  check('o notiță „nu există" pentru client', refused(r, 'HZM06'), why(r))
})

await scenario('coșul', async () => {
  const { client, boss } = await setup()
  await attach('HZ-02', 'hz/HZ-02/a.ogg'); await object('hz/HZ-02/a.ogg')
  const d = await del(boss, 'HZ-02')
  check('adminul șterge notița', !d.error && d.rows.length === 1, err(d))
  const t = await trashOf('HZ-02')
  const seen = await rpcAs(client, 'select issue_id from trash_rows')
  check('clientul nu o vede în coș', !seen.error && seen.rows.length === 0, n(seen))
  const ob = await rpcAs(client, `select name from storage.objects where name = 'hz/HZ-02/a.ogg'`)
  check('nici fișierul ei din coș', !ob.error && ob.rows.length === 0, n(ob))
  const rs = await restore(client, t.id)
  check('nu o restaurează', refused(rs, 'HZT01'), err(rs))
  const pg_ = await rpcAs(client, 'select public.purge_trash($1)', [t.id])
  check('nu o șterge definitiv', refused(pg_, 'HZT01'), err(pg_))
  const bs = await rpcAs(boss, 'select issue_id from trash_rows')
  check('adminul o vede în coș', !bs.error && bs.rows.length === 1, n(bs))
})

await scenario('scoasă din Notițe, se vede întreagă', async () => {
  const { client, boss } = await setup()
  await comment('HZ-02', boss.id)
  await attach('HZ-02', 'hz/HZ-02/a.ogg'); await object('hz/HZ-02/a.ogg')
  await db.query(`update issues set wave = 1 where id = 'HZ-02'`)
  const i = await rpcAs(client, `select id from issues where id = 'HZ-02'`)
  const e = await rpcAs(client, `select id from issue_events where issue_id = 'HZ-02'`)
  const o = await rpcAs(client, `select name from storage.objects where name = 'hz/HZ-02/a.ogg'`)
  check('tichet, fir și fișier', i.rows?.length === 1 && e.rows?.length === 1 && o.rows?.length === 1, `${n(i)} / ${n(e)} / ${n(o)}`)
})

await db.end()
console.log(failed ? `\n${failed} eșecuri, ${passed} trecute.` : `\n${passed} verificări trecute.`)
process.exitCode = failed ? 1 : 0
