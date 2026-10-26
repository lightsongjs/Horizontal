// Coșul de gunoi pe un Postgres real: `npm run test:trash-sql`
//
// Ca `test:move-sql`: testul SCRIE (proiecte, conturi, tichete, ștergeri), deci
// pornește singur un container de unică folosință cu imaginea Postgres a lui
// Supabase, aplică migrările din repo, rulează cazurile și îl șterge. Cu
// `TRASH_SQL_URL=postgres://…` folosește o bază dată — tot de unică folosință;
// scriptul nu citește niciodată `PG_*`. NICIODATĂ producția: testul scrie.
//
// Cazurile (spec, „Teste"): ștergerea pune în coș tichetul și tot ce ar lua
// cascada (fir, fișiere, vizite, obstacole, dependențe în ambele sensuri);
// coșul se vede doar de membri; restaurarea cu același număr și cu număr nou;
// dependențele doar spre tichete existente și fără ciclu; valul / tema /
// mementoul după ce s-a schimbat în jur; refuzurile; mutarea și ștergerea
// proiectului nu umplu coșul; „Șterge definitiv" și expirarea pun căile în
// coada octeților; o coloană nouă primește default-ul; migrarea re-rulabilă.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const IMAGE = process.env.TRASH_SQL_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.6.1.155'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// ── baza ────────────────────────────────────────────────────────────────────
let container = null
let connection = process.env.TRASH_SQL_URL
if (!connection) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = spawnSync('docker', ['run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=postgres', '-p', `127.0.0.1:${port}:5432`, IMAGE], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`Nu pot porni containerul (${IMAGE}): ${run.stderr || run.error}\nDă o bază de unică folosință cu TRASH_SQL_URL=postgres://…`)
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
const admin = await connect(process.env.TRASH_SQL_ADMIN_URL ?? connection.replace('//postgres:', '//supabase_admin:'))

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

await scenario('ștergerea pune în coș tot ce ar lua cascada', async () => {
  const u = await user(); const other = await user(); const stranger = await user()
  await project('hz', 'HZ'); await member(u, 'hz'); await member(other, 'hz', 'read'); await project('apo', 'APO'); await member(stranger, 'apo')
  await db.query(`insert into assignees (name, user_id) values ('Ion', $1)`, [u.id])
  await issue('HZ-01', 'hz'); await issue('HZ-02', 'hz'); await issue('HZ-12', 'hz', { title: 'De șters' })
  await db.query(`insert into dependencies values ('HZ-12','HZ-01'), ('HZ-02','HZ-12')`)
  await db.query(`insert into obstacles (id, project_id, title) values ('HZ-O01','hz','API')`)
  await db.query(`insert into obstacle_issues values ('HZ-O01','HZ-12')`)
  await db.query(`insert into issue_events (issue_id, project_id, kind, author_id, body) values ('HZ-12','hz','comment',$1,'salut')`, [other.id])
  await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-12','hz','hz/HZ-12/a.jpg','a.jpg',10,'image/jpeg')`)
  await db.query(`insert into issue_seen (user_id, issue_id) values ($1,'HZ-12'), ($2,'HZ-12')`, [u.id, other.id])
  const r = await del(u, 'HZ-12')
  check('ștergerea reușește', !r.error && r.rows.length === 1, err(r))
  const t = await trashOf('HZ-12')
  check('rândul din coș: titlu, proiect, cine', t?.title === 'De șters' && t.project_id === 'hz' && t.deleted_by === u.id, JSON.stringify(t && { title: t.title, by: t.deleted_by }))
  check('poza rândului e completă', t?.issue?.id === 'HZ-12' && t.issue.title === 'De șters', JSON.stringify(t?.issue))
  check('dependențele, în ambele sensuri', t?.deps.length === 2, JSON.stringify(t?.deps))
  check('obstacolul, firul, fișierul, vizitele (ale tuturor)', t?.obstacles.length === 1 && t.events.length === 1 && t.attachments.length === 1 && t.seen.length === 2, JSON.stringify([t?.obstacles, t?.events.length, t?.attachments.length, t?.seen.length]))
  check('calea pozei e ținută', JSON.stringify(t?.paths) === '["hz/HZ-12/a.jpg"]', JSON.stringify(t?.paths))
  const { rows: [left] } = await db.query(`select (select count(*) from issue_events)::int e, (select count(*) from attachments)::int a, (select count(*) from issue_seen)::int s, (select count(*) from dependencies)::int d`)
  check('cascada a șters copiii din tabele', left.e === 0 && left.a === 0 && left.s === 0 && left.d === 0, JSON.stringify(left))
  const seenByReader = await asUser(other, 'select issue_id, title, deleted_by_name from trash_rows')
  check('un membru (chiar doar citire) vede coșul, cu numele celui care a șters', seenByReader.length === 1 && seenByReader[0].deleted_by_name === 'Ion', JSON.stringify(seenByReader))
  const seenByStranger = await asUser(stranger, 'select 1 from trash_rows union all select 1 from issues_trash')
  check('un ne-membru nu vede coșul', seenByStranger.length === 0, JSON.stringify(seenByStranger))
  const write = await rpcAs(u, 'delete from issues_trash returning id')
  check('nicio scriere directă în coș', !!write.error || write.rows.length === 0, err(write))
})

await scenario('restaurarea pune totul la loc, cu același număr', async () => {
  const u = await user(); const other = await user()
  await project('hz', 'HZ'); await member(u, 'hz'); await member(other, 'hz')
  await issue('HZ-01', 'hz'); await issue('HZ-02', 'hz'); await issue('HZ-03', 'hz'); await issue('HZ-12', 'hz', { title: 'Revino', urgent: true })
  await db.query(`insert into dependencies values ('HZ-12','HZ-01'), ('HZ-02','HZ-12'), ('HZ-12','HZ-03')`)
  await db.query(`insert into obstacles (id, project_id, title) values ('HZ-O01','hz','API')`)
  await db.query(`insert into obstacle_issues values ('HZ-O01','HZ-12')`)
  const { rows: [ev] } = await db.query(`insert into issue_events (issue_id, project_id, kind, author_id, body) values ('HZ-12','hz','comment',$1,'salut') returning id`, [other.id])
  await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type, event_id) values ('HZ-12','hz','hz/HZ-12/a.jpg','a.jpg',10,'image/jpeg',$1)`, [ev.id])
  await db.query(`insert into issue_seen (user_id, issue_id) values ($1,'HZ-12'), ($2,'HZ-12')`, [u.id, other.id])
  await del(u, 'HZ-12')
  await del(u, 'HZ-03') // cealaltă parte a unei dependențe dispare între timp
  const t = await trashOf('HZ-12')
  const r = await restore(u, t.id)
  check('întoarce același ID', !r.error && r.value?.id === 'HZ-12' && r.value?.original_id === 'HZ-12', err(r))
  const { rows: [row] } = await db.query(`select * from issues where id = 'HZ-12'`)
  check('câmpurile revin', row?.title === 'Revino' && row.urgent === true, JSON.stringify(row))
  const { rows: deps } = await db.query(`select issue_id || '>' || depends_on_id as e from dependencies order by 1`)
  check('dependențele revin doar spre tichete existente', JSON.stringify(deps.map((d) => d.e)) === '["HZ-02>HZ-12","HZ-12>HZ-01"]', JSON.stringify(deps))
  const { rows: [c] } = await db.query(`select (select count(*) from issue_events where issue_id='HZ-12')::int e,
    (select count(*) from attachments where issue_id='HZ-12' and event_id is not null)::int a,
    (select count(*) from issue_seen where issue_id='HZ-12')::int s,
    (select count(*) from obstacle_issues where issue_id='HZ-12')::int o,
    (select count(*) from issues_trash where issue_id='HZ-12')::int t`)
  check('firul, fișierul (legat de comentariu), vizitele, obstacolul revin; coșul se golește', c.e === 1 && c.a === 1 && c.s === 2 && c.o === 1 && c.t === 0, JSON.stringify(c))
  const again = await restore(u, t.id)
  check('a doua restaurare: „nu mai e în coș"', !!again.error && again.error.code === 'HZT01', err(again))
})

await scenario('numărul refolosit între timp → număr nou', async () => {
  const u = await user(); await project('hz', 'HZ'); await member(u, 'hz')
  await issue('HZ-01', 'hz'); await issue('HZ-02', 'hz')
  await db.query(`insert into issue_events (issue_id, project_id, kind, author_id, body) values ('HZ-02','hz','comment',$1,'x')`, [u.id])
  await del(u, 'HZ-02')
  await issue('HZ-02', 'hz', { title: 'altul, cu numărul refolosit' })
  const r = await restore(u, (await trashOf('HZ-02')).id)
  check('întoarce numărul nou și pe cel vechi', !r.error && r.value?.id === 'HZ-03' && r.value?.original_id === 'HZ-02', err(r))
  const { rows } = await db.query('select issue_id from issue_events')
  check('firul urmează numărul nou', rows.length === 1 && rows[0].issue_id === 'HZ-03', JSON.stringify(rows))
})

await scenario('refuzuri: doar citire, ne-membru', async () => {
  const u = await user(); const reader = await user(); const stranger = await user()
  await project('hz', 'HZ', 'Horizontal'); await member(u, 'hz'); await member(reader, 'hz', 'read')
  await issue('HZ-12', 'hz'); await del(u, 'HZ-12')
  const t = await trashOf('HZ-12')
  const ro = await restore(reader, t.id)
  check('doar citire → HZT02', !!ro.error && ro.error.code === 'HZT02' && ro.error.message.includes('„Horizontal"'), err(ro))
  const out = await restore(stranger, t.id)
  check('ne-membru → HZT01 (invizibil)', !!out.error && out.error.code === 'HZT01', err(out))
  const pro = await rpcAs(reader, 'select public.purge_trash($1)', [t.id])
  check('„Șterge definitiv" cere și el scriere', !!pro.error && pro.error.code === 'HZT02', err(pro))
  const admin = await user({ admin: true })
  const ok = await restore(admin, t.id)
  check('adminul restaurează fără să fie membru', !ok.error && ok.value?.id === 'HZ-12', err(ok))
})

await scenario('mutarea și ștergerea proiectului nu umplu coșul', async () => {
  const u = await user(); await project('hz', 'HZ'); await project('apo', 'APO'); await member(u, 'hz'); await member(u, 'apo')
  await issue('HZ-12', 'hz')
  const m = await moveAs(u, 'HZ-12', 'apo')
  const { rows: t1 } = await db.query('select issue_id from issues_trash')
  check('mutarea nu pune rândul vechi în coș', m.id === 'APO-01' && t1.length === 0, `${why(m)} · ${JSON.stringify(t1)}`)
  await issue('APO-02', 'apo')
  await del(u, 'APO-02')
  const { rows: t3 } = await db.query('select issue_id from issues_trash')
  check('după o mutare, o ștergere din aceeași tranzacție ajunge iar în coș', t3.length === 1 && t3[0].issue_id === 'APO-02', JSON.stringify(t3))
  await issue('HZ-13', 'hz')
  await del(u, 'HZ-13')
  await issue('HZ-14', 'hz')
  await db.query(`delete from projects where id = 'hz'`)
  const { rows: t2 } = await db.query('select issue_id from issues_trash order by 1')
  check('ștergerea proiectului reușește și îi golește coșul', JSON.stringify(t2.map((r) => r.issue_id)) === '["APO-02"]', JSON.stringify(t2))
})

await scenario('două tichete legate, șterse deodată', async () => {
  const u = await user(); await project('hz', 'HZ'); await member(u, 'hz')
  await issue('HZ-01', 'hz'); await issue('HZ-02', 'hz')
  await db.query(`insert into dependencies values ('HZ-02','HZ-01')`)
  await del(u, 'HZ-01', 'HZ-02')
  const t1 = await trashOf('HZ-01'); const t2 = await trashOf('HZ-02')
  check('fiecare își ține muchia', t1?.deps.length === 1 && t2?.deps.length === 1, JSON.stringify([t1?.deps, t2?.deps]))
  await restore(u, t1.id)
  const { rows: d0 } = await db.query('select 1 from dependencies')
  check('primul restaurat: muchia așteaptă', d0.length === 0, JSON.stringify(d0))
  await restore(u, t2.id)
  const { rows: d1 } = await db.query('select issue_id, depends_on_id from dependencies')
  check('al doilea restaurat: muchia revine', d1.length === 1 && d1[0].issue_id === 'HZ-02' && d1[0].depends_on_id === 'HZ-01', JSON.stringify(d1))
})

await scenario('fără ciclu cu ce s-a legat între timp', async () => {
  const u = await user(); await project('hz', 'HZ'); await member(u, 'hz')
  for (const id of ['HZ-01', 'HZ-02', 'HZ-03']) await issue(id, 'hz')
  // HZ-01 depinde de HZ-02; HZ-03 depinde de HZ-01.
  await db.query(`insert into dependencies values ('HZ-01','HZ-02'), ('HZ-03','HZ-01')`)
  await del(u, 'HZ-01')
  await db.query(`insert into dependencies values ('HZ-02','HZ-03')`)
  await restore(u, (await trashOf('HZ-01')).id)
  const { rows } = await db.query(`select issue_id || '>' || depends_on_id as e from dependencies order by 1`)
  check('muchia care ar închide ciclul e lăsată deoparte', JSON.stringify(rows.map((r) => r.e)) === '["HZ-01>HZ-02","HZ-02>HZ-03"]', JSON.stringify(rows))
})

await scenario('val, temă, memento, coloană nouă', async () => {
  const u = await user(); await project('hz', 'HZ', 'HZ', 3); await member(u, 'hz')
  await db.query(`insert into waves (project_id, number, name) values ('hz',0,'Notițe'), ('hz',2,'II'), ('hz',3,'III')`)
  await db.query(`insert into themes values ('hz','ui','UI','#123456')`)
  await issue('HZ-01', 'hz', { wave: 2, theme: 'ui' })
  await db.query(`update issues set remind_at = now() + interval '1 minute', due_at = now() + interval '1 hour' where id = 'HZ-01'`)
  await issue('HZ-02', 'hz', { wave: 0 })
  await del(u, 'HZ-01', 'HZ-02')
  await db.query(`delete from waves where number = 2; delete from themes where key = 'ui'`)
  await db.query(`update issues_trash set issue = jsonb_set(issue, '{remind_at}', to_jsonb(now() - interval '1 day')) where issue_id = 'HZ-01'`)
  await db.query(`alter table issues add column trash_probe text not null default 'implicit'`)
  const r = await restore(u, (await trashOf('HZ-01')).id)
  await restore(u, (await trashOf('HZ-02')).id)
  const { rows: [a] } = await db.query(`select wave, theme, reminder_sent_at, trash_probe from issues where id = 'HZ-01'`)
  check('valul șters → valul activ, tema ștearsă → fără temă', !r.error && a?.wave === 3 && a.theme === null, `${err(r)} ${JSON.stringify(a)}`)
  check('mementoul trecut nu sună la restaurare', !!a && a.reminder_sent_at !== null, JSON.stringify(a))
  check('o coloană nouă primește default-ul', a?.trash_probe === 'implicit', JSON.stringify(a))
  const { rows: [b] } = await db.query(`select wave from issues where id = 'HZ-02'`)
  check('Notițele (valul 0) rămân', b?.wave === 0, JSON.stringify(b))
})

await scenario('„Șterge definitiv" și expirarea', async () => {
  const u = await user(); await project('hz', 'HZ'); await member(u, 'hz')
  await issue('HZ-01', 'hz'); await issue('HZ-02', 'hz'); await issue('HZ-03', 'hz')
  await db.query(`insert into attachments (issue_id, project_id, path, filename, size, content_type) values ('HZ-01','hz','hz/HZ-01/a.jpg','a.jpg',1,'image/jpeg'), ('HZ-02','hz','hz/HZ-02/b.jpg','b.jpg',1,'image/jpeg')`)
  await del(u, 'HZ-01', 'HZ-02', 'HZ-03')
  const p = await rpcAs(u, 'select public.purge_trash($1)', [(await trashOf('HZ-01')).id])
  const { rows: q1 } = await db.query('select path from storage_purge')
  check('definitiv: rândul iese, calea intră în coada octeților', !p.error && !(await trashOf('HZ-01')) && q1.length === 1 && q1[0].path === 'hz/HZ-01/a.jpg', `${err(p)} ${JSON.stringify(q1)}`)
  const forbidden = await rpcAs(u, 'select public.purge_expired_trash()')
  check('expirarea nu se cheamă din aplicație', !!forbidden.error && forbidden.error.code === '42501', err(forbidden))
  const peek = await rpcAs(u, 'select path from storage_purge')
  check('coada octeților nu se citește din aplicație', !!peek.error, err(peek))
  await db.query(`update issues_trash set deleted_at = now() - interval '31 days' where issue_id = 'HZ-02'`)
  await db.query(`update issues_trash set deleted_at = now() - interval '29 days' where issue_id = 'HZ-03'`)
  const { rows: [{ n }] } = await db.query('select public.purge_expired_trash() as n')
  const { rows: left } = await db.query('select issue_id from issues_trash')
  const { rows: q2 } = await db.query('select path from storage_purge order by path')
  check('după 30 de zile iese, înainte rămâne', n === 1 && left.length === 1 && left[0].issue_id === 'HZ-03' && q2.length === 2, `n=${n} ${JSON.stringify(left)} ${JSON.stringify(q2)}`)
})

await scenario('cheia de serviciu: fără autor', async () => {
  await project('hz', 'HZ'); await issue('HZ-01', 'hz')
  await db.query(`delete from issues where id = 'HZ-01'`)
  const t = await trashOf('HZ-01')
  check('ștergerea fără sesiune ajunge în coș cu deleted_by null', !!t && t.deleted_by === null, JSON.stringify(t && t.deleted_by))
})

await db.end()
console.log(failed ? `\n${failed} eșecuri, ${passed} trecute.` : `\n${passed} verificări trecute.`)
process.exitCode = failed ? 1 : 0
