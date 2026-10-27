// Firul din API pe un Postgres real: `npm run test:thread-api-sql`
//
// Ca `test:trash-sql`: testul SCRIE, deci pornește singur un container de unică
// folosință cu imaginea Postgres a lui Supabase, aplică migrările din repo,
// rulează cazurile și îl șterge. Cu `THREAD_SQL_URL=postgres://…` folosește o
// bază dată — tot de unică folosință. NICIODATĂ producția: testul scrie.
//
// Cazurile: comentariu + pasă atomic, în numele omului (author_id = contul lui,
// handoff_from = cine îl avea, „văzut” pentru autor); pasa spre cine îl are deja
// nu scrie pasă; fișierele se leagă de comentariu; refuzurile (autor necunoscut
// sau fără cont, tichet inexistent, gol); numai `service_role` o poate chema;
// migrarea e re-rulabilă.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const IMAGE = process.env.THREAD_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

let container = null
let connection = process.env.THREAD_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu THREAD_SQL_URL=postgres://…`)
    process.exit(2)
  }
  container = run.stdout.trim()
  connection = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
}
const stop = () => { if (container) spawnSync('docker', ['rm', '-f', container]) }
process.on('exit', stop)

async function connect(url) {
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

const admin = await connect(process.env.THREAD_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))
// Ce imaginea goală nu are, dar Supabase da (vezi test-trash-sql.mjs).
await admin.query(`
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema auth, storage to postgres;
grant select, insert on auth.users to postgres;
grant all on storage.objects to postgres;
alter table storage.objects owner to postgres;
`)
await admin.end()
const db = await connect(connection)
for (const f of ['supabase/schema.sql', 'supabase/migration-access.sql', 'supabase/migration-todo.sql']) await db.query(read(f))
await db.query(`alter table issues add column if not exists notes text not null default '';`)
for (const f of ['supabase/migration-attachments.sql', 'supabase/migration-comments.sql']) await db.query(read(f))
// De două ori: migrarea trebuie să fie re-rulabilă.
await db.query(read('supabase/migration-thread-api.sql'))
await db.query(read('supabase/migration-thread-api.sql'))

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`)
}
async function scenario(name, fn) {
  await db.query('begin')
  try { await fn() } catch (e) { check(name, false, `excepție: ${e.message}`) } finally { await db.query('rollback') }
}

async function person(name, { linked = true } = {}) {
  const uid = linked ? randomUUID() : null
  if (uid) await db.query(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`, [uid, `${uid.slice(0, 8)}@test.local`])
  const { rows: [a] } = await db.query('insert into assignees (name, user_id) values ($1, $2) returning id', [name, uid])
  return { uid, aid: a.id }
}

/** Funcția ca `service_role` (cheia API) — sau alt rol, pentru refuzuri. */
async function post(args, role = 'service_role') {
  await db.query('savepoint p')
  try {
    await db.query(`set local role ${role}`)
    const { rows: [r] } = await db.query(
      'select public.post_to_thread_api($1, $2, $3, $4, $5, $6) as r',
      [args.issue, args.author, args.body ?? '', args.handoff ?? false, args.to ?? null, args.files ?? []],
    )
    await db.query('reset role')
    await db.query('release savepoint p')
    return { value: r.r }
  } catch (e) {
    await db.query('rollback to savepoint p')
    await db.query('reset role')
    return { error: e }
  }
}
const err = (r) => (r.error ? `${r.error.code}: ${r.error.message}` : JSON.stringify(r.value))

async function base() {
  await db.query(`insert into projects (id, name, prefix, current_wave) values ('hz', 'hz', 'HZ', 1)`)
  await db.query(`insert into issues (id, project_id, title, wave) values ('HZ-01', 'hz', 'T', 1)`)
}

await scenario('comentariu + pasă: un gest, în numele omului', async () => {
  await base()
  const ion = await person('Ionut'); const ana = await person('Ana', { linked: false })
  const r = await post({ issue: 'HZ-01', author: ion.uid, body: '  ia-l tu  ', handoff: true, to: ana.aid })
  check('reușește', !r.error, err(r))
  const ev = r.value?.events ?? []
  check('două rânduri: comentariul, apoi pasa', ev.map((e) => e.kind).join() === 'comment,handoff', JSON.stringify(ev))
  check('autorul ambelor = contul omului', ev.every((e) => e.author_id === ion.uid), JSON.stringify(ev.map((e) => e.author_id)))
  check('corpul tăiat la capete', ev[0]?.body === 'ia-l tu')
  check('handoff_from = cine îl avea (nimeni), handoff_to = Ana', ev[1]?.handoff_from === null && ev[1]?.handoff_to === ana.aid)
  const { rows: [i] } = await db.query(`select assignee_id from issues where id = 'HZ-01'`)
  check('tichetul e acum al Anei', i.assignee_id === ana.aid && r.value.assignee_id === ana.aid)
  const { rows: seen } = await db.query(`select user_id from issue_seen where issue_id = 'HZ-01'`)
  check('„văzut” pentru autor', seen.length === 1 && seen[0].user_id === ion.uid, JSON.stringify(seen))
  const { rows: inbox } = await db.query(`select id from issues where assignee_id = $1`, [ana.aid])
  check('ajunge în „Ale mele” al Anei (assignee_id)', inbox.length === 1)
})

await scenario('pasa spre cine îl are deja nu scrie pasă; doar comentariul', async () => {
  await base()
  const ion = await person('Ionut'); const ana = await person('Ana')
  await db.query(`update issues set assignee_id = $1 where id = 'HZ-01'`, [ana.aid])
  const r = await post({ issue: 'HZ-01', author: ion.uid, body: 'tot al tău', handoff: true, to: ana.aid })
  check('un singur rând, comentariul', !r.error && r.value.events.length === 1 && r.value.events[0].kind === 'comment', err(r))
  const back = await post({ issue: 'HZ-01', author: ion.uid, handoff: true, to: null })
  check('pasa înapoi la creator: handoff_from = Ana, to = null', !back.error && back.value.events[0]?.handoff_from === ana.aid && back.value.events[0]?.handoff_to === null && back.value.assignee_id === null, err(back))
})

await scenario('fișierele se leagă de comentariu; cele străine nu', async () => {
  await base()
  await db.query(`insert into issues (id, project_id, title, wave) values ('HZ-02', 'hz', 'Alt', 1)`)
  const ion = await person('Ionut')
  const { rows: [a] } = await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-01','hz','hz/HZ-01/a','a.png',1,'image/png') returning id`)
  const { rows: [b] } = await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-02','hz','hz/HZ-02/b','b.png',1,'image/png') returning id`)
  const r = await post({ issue: 'HZ-01', author: ion.uid, files: [a.id, b.id] })
  check('numai fișierele = un comentariu gol cu fișier', !r.error && r.value.events.length === 1 && r.value.events[0].body === '', err(r))
  const { rows } = await db.query('select id, event_id from attachments order by filename')
  check('al tichetului legat, al altui tichet neatins', rows[0].event_id === r.value?.events[0]?.id && rows[1].event_id === null, JSON.stringify(rows))
})

await scenario('refuzuri', async () => {
  await base()
  const ion = await person('Ionut'); const ana = await person('Ana', { linked: false })
  const stranger = randomUUID()
  await db.query(`insert into auth.users (id, email, aud, role) values ($1, 'x@test.local', 'authenticated', 'authenticated')`, [stranger])
  let r = await post({ issue: 'HZ-01', author: stranger, body: 'x' })
  check('cont fără rând în assignees → HZC03', r.error?.code === 'HZC03', err(r))
  r = await post({ issue: 'HZ-01', author: null, body: 'x' })
  check('fără autor → HZC03', r.error?.code === 'HZC03', err(r))
  r = await post({ issue: 'HZ-99', author: ion.uid, body: 'x' })
  check('tichet inexistent → HZC01', r.error?.code === 'HZC01', err(r))
  r = await post({ issue: 'HZ-01', author: ion.uid, body: '   ' })
  check('gol → HZC02', r.error?.code === 'HZC02', err(r))
  r = await post({ issue: 'HZ-01', author: ion.uid, body: 'x' }, 'authenticated')
  check('un cont obișnuit n-o poate chema (42501)', r.error?.code === '42501', err(r))
  r = await post({ issue: 'HZ-01', author: ion.uid, body: 'x' }, 'anon')
  check('anon n-o poate chema (42501)', r.error?.code === '42501', err(r))
  const { rows: [n] } = await db.query('select count(*)::int c from issue_events')
  check('nimic scris de refuzuri', n.c === 0, String(n.c))
  void ana
})

await db.end()
console.log(failed ? `\n${failed} eșecuri, ${passed} trecute.` : `\n${passed} verificări trecute.`)
process.exitCode = failed ? 1 : 0
