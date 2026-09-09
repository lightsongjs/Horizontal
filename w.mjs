import pg from 'pg'; import { config } from 'dotenv'; config()
const c=new pg.Client({host:process.env.PG_HOST,port:Number(process.env.PG_PORT),database:process.env.PG_DATABASE,user:process.env.PG_USER,password:process.env.PG_PASSWORD,ssl:{rejectUnauthorized:false}})
await c.connect()
for (let i=0;i<14;i++){
  const r=(await c.query(`select reminder_sent_at from issues where id='KATA-117'`)).rows[0]
  if (r?.reminder_sent_at){
    const h=(await c.query(`select status_code, content, created from net._http_response order by created desc limit 1`)).rows[0]
    console.log('trimis la', r.reminder_sent_at.toISOString())
    console.log('functia a raspuns:', h.status_code, h.content)
    break
  }
  await new Promise(r=>setTimeout(r,25000))
}
await c.end()
