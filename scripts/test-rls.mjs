// scripts/test-rls.mjs — verify RLS isolation with live accounts.
// Prereqs: reader@test.local + writer@test.local exist; p-test has them as
// read/write members; p-secret has no members. Passwords in .env.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config()

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY

async function as(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return c
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } else console.log('ok:', msg)
}

const reader = await as('reader@test.local', process.env.TEST_READER_PW)
const writer = await as('writer@test.local', process.env.TEST_WRITER_PW)

const rProjects = (await reader.from('projects').select('id')).data ?? []
assert(rProjects.some((p) => p.id === 'p-test'), 'reader sees P-TEST')
assert(!rProjects.some((p) => p.id === 'p-secret'), 'reader cannot see P-SECRET')

const rIns = await reader.from('issues').insert({ id: 'x-reader-1', project_id: 'p-test', title: 'nope', wave: 1 })
assert(rIns.error !== null, 'reader blocked from inserting issue')

const wIns = await writer.from('issues').insert({ id: 'x-writer-1', project_id: 'p-test', title: 'ok', wave: 1 })
assert(wIns.error === null, 'writer can insert issue into P-TEST')

const wSecret = await writer.from('issues').insert({ id: 'x-writer-2', project_id: 'p-secret', title: 'nope', wave: 1 })
assert(wSecret.error !== null, 'writer blocked from P-SECRET')

console.log('done')
