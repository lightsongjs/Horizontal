// `move_issue` pe un Postgres real: `npm run test:move-sql`
//
// De ce nu pe baza din `.env` (ca `test:recurrence-sql`): testul ăsta SCRIE —
// creează proiecte, conturi, tichete și mută. Pe producție n-are ce căuta. Deci
// pornește singur un container de unică folosință cu imaginea Postgres a lui
// Supabase (are deja `auth`, rolurile `anon`/`authenticated` și grant-urile
// implicite), aplică migrările din repo peste el, rulează cazurile și îl
// șterge. Cu `MOVE_SQL_URL=postgres://…` folosește în schimb o bază dată — tot
// de unică folosință; scriptul nu citește niciodată `PG_*`.
//
// Cazurile (spec, „Teste"): refuz cu dependență în ambele sensuri, refuz cu
// obstacol, refuz fără drept pe țintă/sursă, mutare reușită cu fir + atașament
// + văzut, numerotarea (ACELEAȘI fixtures ca `nextIssueId` din client —
// `src/lib/issueId.fixtures.json`), poza citibilă de un membru doar al țintei,
// persoana păstrată/scoasă, migrarea re-rulabilă.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const IMAGE = process.env.MOVE_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// ── baza ────────────────────────────────────────────────────────────────────
let container = null
let connection = process.env.MOVE_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu MOVE_SQL_URL=postgres://…`)
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
const admin = await connect(process.env.MOVE_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))

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
for (const f of ['supabase/migration-push.sql', 'supabase/migration-attachments.sql', 'supabase/migration-comments.sql', 'supabase/migration-obstacles.sql', 'supabase/migration-routines.sql']) {
  // migration-push cere pg_cron/vault doar în migration-cron, nu aici.
  await db.query(read(f))
}
// De două ori: migrarea trebuie să fie re-rulabilă.
await db.query(read('supabase/migration-move-issue.sql'))
await db.query(read('supabase/migration-move-issue.sql'))

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

// ── cazurile ────────────────────────────────────────────────────────────────
await scenario('refuz: tichetul depinde de altul', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz'); await member(u, 'apo')
  await issue('HZ-03', 'hz'); await issue('HZ-12', 'hz'); await issue('HZ-09', 'hz')
  await db.query(`insert into dependencies values ('HZ-12','HZ-09'), ('HZ-12','HZ-03')`)
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: tichetul depinde de altul', refused(r, 'HZM01', 'Nu se poate muta HZ-12: are dependențe (HZ-03, HZ-09). Scoate-le întâi.'), why(r))
})

await scenario('refuz: altul depinde de tichet', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz'); await member(u, 'apo')
  await issue('HZ-12', 'hz'); await issue('HZ-13', 'hz')
  await db.query(`insert into dependencies values ('HZ-13','HZ-12')`)
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: altul depinde de tichet', refused(r, 'HZM01', '(HZ-13)'), why(r))
})

await scenario('refuz: legat de un obstacol', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz'); await member(u, 'apo')
  await issue('HZ-12', 'hz')
  await db.query(`insert into obstacles (id, project_id, title) values ('HZ-O01','hz','API')`)
  await db.query(`insert into obstacle_issues values ('HZ-O01','HZ-12')`)
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: legat de un obstacol', refused(r, 'HZM02', 'e legat de un obstacol'), why(r))
})

await scenario('refuz: doar citire pe țintă', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO', 'Apologetica'); await member(u, 'hz'); await member(u, 'apo', 'read')
  await issue('HZ-12', 'hz')
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: doar citire pe țintă', refused(r, 'HZM03', 'Nu ai drept de editare în proiectul „Apologetica".'), why(r))
})

await scenario('refuz: doar citire pe sursă', async () => {
  const u = await user(); await project('hz', 'HZ', 'Horizontal'); await project('apo', 'APO'); await member(u, 'hz', 'read'); await member(u, 'apo')
  await issue('HZ-12', 'hz')
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: doar citire pe sursă', refused(r, 'HZM03', '„Horizontal"'), why(r))
})

await scenario('refuz: țintă fără acces deloc', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz')
  await issue('HZ-12', 'hz')
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: țintă fără acces deloc', refused(r, 'HZM06', 'Proiectul țintă nu există.'), why(r))
})

await scenario('refuz: tichet invizibil', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'apo')
  await issue('HZ-12', 'hz')
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('refuz: tichet invizibil (ne-membru al sursei)', refused(r, 'HZM06', 'Tichetul HZ-12 nu există.'), why(r))
})

await scenario('refuz: același proiect și ID provizoriu', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz'); await member(u, 'apo')
  await issue('HZ-12', 'hz')
  const same = await moveAs(u, 'HZ-12', 'hz')
  check('refuz: ținta e chiar sursa', refused(same, 'HZM04'), why(same))
  const temp = await moveAs(u, 'HZ-~ab12cd', 'apo')
  check('refuz: ID provizoriu', refused(temp, 'HZM05'), why(temp))
})

await scenario('mutare reușită: fir, atașament, văzut, câmpuri', async () => {
  const u = await user(); const other = await user()
  await project('hz', 'HZ'); await project('apo', 'APO', 'Apologetica', 3)
  await member(u, 'hz'); await member(u, 'apo'); await member(other, 'hz')
  await db.query(`insert into themes values ('hz','ui','UI','#123456')`)
  for (const id of ['APO-01', 'APO-07']) await issue(id, 'apo')
  await issue('HZ-12', 'hz', {
    title: 'Mută-mă', wave: 2, theme: 'ui', dueAt: '2026-10-20T07:00:00Z', rrule: 'FREQ=WEEKLY', urgent: true,
    createdBy: other.id, reminderSentAt: '2026-10-19T07:00:00Z',
  })
  await db.query(`insert into issue_events (issue_id, project_id, kind, author_id, body) values ('HZ-12','hz','comment',$1,'salut')`, [other.id])
  await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-12','hz','hz/HZ-12/a.jpg','a.jpg',10,'image/jpeg')`)
  await db.query(`insert into issue_seen (user_id, issue_id) values ($1,'HZ-12'), ($2,'HZ-12')`, [u.id, other.id])
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('mută și întoarce ID-ul nou', r.id === 'APO-08', why(r))
  const { rows: [row] } = await db.query(`select * from issues where id = 'APO-08'`)
  check('câmpurile: proiect, val activ, fără temă', row?.project_id === 'apo' && row.wave === 3 && row.theme === null, JSON.stringify(row))
  check('câmpurile copiate neschimbate', row?.title === 'Mută-mă' && row.rrule === 'FREQ=WEEKLY' && row.urgent === true
    && row.created_by === other.id && row.due_at?.toISOString() === '2026-10-20T07:00:00.000Z'
    && row.reminder_sent_at?.toISOString() === '2026-10-19T07:00:00.000Z', JSON.stringify(row))
  const { rows: gone } = await db.query(`select 1 from issues where id = 'HZ-12'`)
  check('rândul vechi a dispărut', gone.length === 0)
  const { rows: ev } = await db.query(`select issue_id, project_id from issue_events`)
  check('firul a urmat tichetul', ev.length === 1 && ev[0].issue_id === 'APO-08' && ev[0].project_id === 'apo', JSON.stringify(ev))
  const { rows: at } = await db.query(`select issue_id, project_id, path from attachments`)
  check('atașamentul a urmat tichetul, calea a rămas', at.length === 1 && at[0].issue_id === 'APO-08' && at[0].project_id === 'apo' && at[0].path === 'hz/HZ-12/a.jpg', JSON.stringify(at))
  const { rows: seen } = await db.query(`select issue_id from issue_seen`)
  check('vizitele (și ale altora) au urmat tichetul', seen.length === 2 && seen.every((s) => s.issue_id === 'APO-08'), JSON.stringify(seen))
})

await scenario('persoana: păstrată dacă e membru al țintei, altfel scoasă', async () => {
  const u = await user(); const inTarget = await user(); const outside = await user(); const admin = await user({ admin: true })
  await project('hz', 'HZ'); await project('apo', 'APO')
  await member(u, 'hz'); await member(u, 'apo'); await member(inTarget, 'apo', 'read'); await member(outside, 'hz')
  const a = {}
  for (const [k, who] of [['in', inTarget], ['out', outside], ['admin', admin], ['nolink', null]]) {
    const { rows: [r] } = await db.query(`insert into assignees (name, user_id) values ($1, $2) returning id`, [k, who?.id ?? null])
    a[k] = r.id
  }
  await issue('HZ-01', 'hz', { assigneeId: a.in }); await issue('HZ-02', 'hz', { assigneeId: a.out })
  await issue('HZ-03', 'hz', { assigneeId: a.admin }); await issue('HZ-04', 'hz', { assigneeId: a.nolink })
  const got = {}
  for (const [id, k] of [['HZ-01', 'in'], ['HZ-02', 'out'], ['HZ-03', 'admin'], ['HZ-04', 'nolink']]) {
    const r = await moveAs(u, id, 'apo')
    got[k] = r.id ? (await db.query('select assignee_id from issues where id = $1', [r.id])).rows[0].assignee_id : why(r)
  }
  check('persoana membru al țintei rămâne', got.in === a.in, String(got.in))
  check('persoana din afara țintei e scoasă', got.out === null, String(got.out))
  check('un admin rămâne', got.admin === a.admin, String(got.admin))
  check('un nume nelegat de cont e scos', got.nolink === null, String(got.nolink))
})

await scenario('adminul mută fără să fie membru', async () => {
  const admin = await user({ admin: true }); await project('hz', 'HZ'); await project('apo', 'APO')
  await issue('HZ-12', 'hz')
  const r = await moveAs(admin, 'HZ-12', 'apo')
  check('adminul mută fără să fie membru', r.id === 'APO-01', why(r))
})

// Aceleași fixtures ca `nextIssueId` din client: numărul ales de SQL trebuie
// să fie exact cel pe care l-ar fi ales `createIssue`.
const FIXTURES = JSON.parse(read('src/lib/issueId.fixtures.json'))
for (const f of FIXTURES) {
  await scenario(`numerotare: ${f.name}`, async () => {
    const u = await user(); await project('src', 'SRC'); await project('dst', f.prefix); await member(u, 'src'); await member(u, 'dst')
    for (const id of f.existing) await issue(id, 'dst')
    await issue('SRC-01', 'src')
    const r = await moveAs(u, 'SRC-01', 'dst')
    check(`numerotare: ${f.name}`, r.id === f.want, `așteptat ${f.want} · ${why(r)}`)
  })
}

await scenario('numerotare: un ID luat în alt proiect sare mai departe', async () => {
  const u = await user(); await project('src', 'SRC'); await project('dst', 'DST'); await project('old', 'OLD')
  await member(u, 'src'); await member(u, 'dst')
  await issue('DST-01', 'dst'); await issue('DST-02', 'old') // rămas cu prefixul vechi în alt proiect
  await issue('SRC-01', 'src')
  const r = await moveAs(u, 'SRC-01', 'dst')
  check('numerotare: un ID luat în alt proiect sare mai departe', r.id === 'DST-03', why(r))
})

await scenario('poza: citibilă de un membru doar al țintei', async () => {
  const u = await user(); const onlyTarget = await user(); const onlySource = await user()
  await project('hz', 'HZ'); await project('apo', 'APO')
  await member(u, 'hz'); await member(u, 'apo'); await member(onlyTarget, 'apo', 'write'); await member(onlySource, 'hz', 'read')
  await issue('HZ-12', 'hz')
  await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-12','hz','hz/HZ-12/p.jpg','p.jpg',10,'image/jpeg')`)
  await db.query(`insert into storage.objects (bucket_id, name) values ('attachments','hz/HZ-12/p.jpg')`)
  const before = await asUser(onlyTarget, 'select name from storage.objects')
  check('înainte: membrul țintei nu vede poza', before.length === 0, JSON.stringify(before))
  const r = await moveAs(u, 'HZ-12', 'apo')
  check('poza: mutarea a reușit', !!r.id, why(r))
  const after = await asUser(onlyTarget, 'select name from storage.objects')
  check('după: membrul doar al țintei vede poza', after.length === 1, JSON.stringify(after))
  const del = await asUser(onlyTarget, 'delete from storage.objects returning name')
  check('după: și o poate șterge (scriere pe țintă)', del.length === 1, JSON.stringify(del))
})

await scenario('poza: drumul vechi rămâne pentru proiectul din cale', async () => {
  const onlySource = await user(); await project('hz', 'HZ')
  await member(onlySource, 'hz', 'read')
  await db.query(`insert into storage.objects (bucket_id, name) values ('attachments','hz/HZ-12/x.jpg'), ('altul','hz/HZ-12/x.jpg')`)
  const rows = await asUser(onlySource, 'select bucket_id from storage.objects')
  check('poza: prima regulă neschimbată, doar bucketul attachments', rows.length === 1 && rows[0].bucket_id === 'attachments', JSON.stringify(rows))
})

await db.end()
console.log(failed ? `\n${failed} eșecuri, ${passed} trecute.` : `\n${passed} verificări trecute.`)
process.exitCode = failed ? 1 : 0
