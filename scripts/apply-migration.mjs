// Aplică un fișier .sql pe baza de date. Rulează: npm run migrate <cale.sql>
//
// De ce `pg` și nu supabase-js: politicile RLS și DDL-ul nu se pot trimite prin
// API-ul REST. De ce parametri separați și nu connectionString: parola conține
// `@`, care sparge URL-ul.
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { config } from 'dotenv'

config()

const file = process.argv[2]
if (!file) {
  console.error('Lipsește fișierul: npm run migrate supabase/migration-attachments.sql')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')
const client = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  // Un singur query cu tot fișierul: `pg` îl trimite ca simple query, deci
  // instrucțiunile rulează într-o singură tranzacție implicită și, la o eroare
  // la mijloc, nu rămâne o migrare pe jumătate aplicată.
  await client.query(sql)
  console.log(`Migrare aplicată: ${file}`)
} catch (e) {
  console.error(`Migrarea a eșuat: ${e.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
