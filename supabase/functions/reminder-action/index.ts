// supabase/functions/reminder-action/index.ts
//
// „Gata" / „Amână" apăsate în notificare, CU APLICAȚIA ÎNCHISĂ.
//
// De ce există. Butoanele notificării se rezolvau doar prin pagină: workerul
// trimitea un mesaj, pagina făcea mutația (vezi comentariul din `src/sw.ts`).
// Fără nicio filă deschisă — cazul obișnuit pe telefon, la 9 dimineața — nu se
// putea face nimic, așa că workerul deschidea tichetul. O atingere în loc de
// zero, adică exact ce butonul promitea să evite.
//
// Ce a schimbat asta: `send-reminders` pune în payload un token HMAC, iar
// payload-ul de push e criptat pentru abonamentul destinatarului (RFC 8291).
// Deci workerul primește o dovadă pe care numai el o are, și poate scrie fără
// sesiune și fără să țină un secret în bundle.
//
// SE DEPLOAZĂ FĂRĂ VERIFICARE DE JWT — tokenul ESTE autorizarea:
//   supabase functions deploy reminder-action --no-verify-jwt
//   supabase secrets set REMINDER_ACTION_SECRET=$(openssl rand -hex 32)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyToken } from '../_shared/reminderToken.ts'

/** Cât amână „Amână". Trebuie să spună la fel ca `SNOOZE_MINUTES` din `src/lib/pushPayload.ts`. */
const SNOOZE_MINUTES = 5

// Workerul e servit de pe originea aplicației, nu de pe cea a funcției: fără
// CORS, `fetch`-ul din `notificationclick` eșuează și butonul tace.
const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
})

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  })

Deno.serve(async (req) => {
  // Lista albă de origini vine din configurare. `*` ar merge (nu citim cookie-uri
  // și nu ne bazăm pe originea cererii pentru autorizare — tokenul face asta),
  // dar o listă restrânge zgomotul și eventualele abuzuri din alte pagini.
  const allowed = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const reqOrigin = req.headers.get('Origin') ?? ''
  const origin = allowed.includes(reqOrigin) ? reqOrigin : (allowed[0] ?? '*')

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const secret = Deno.env.get('REMINDER_ACTION_SECRET')
  if (!secret) return json({ error: 'REMINDER_ACTION_SECRET missing' }, 500, origin)

  let body: { id?: string; action?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400, origin)
  }
  const { id, action, token } = body
  if (!id || !token || (action !== 'done' && action !== 'snooze')) {
    return json({ error: 'invalid request' }, 400, origin)
  }

  const verdict = await verifyToken(secret, id, token, Date.now())
  // Un singur mesaj pentru toate motivele de eșec: „expirat" vs „semnătură
  // greșită" spus unui apelant neautorizat e informație pe gratis. Motivul se
  // vede în jurnal, unde e util.
  if (!verdict.ok) {
    console.warn(`token respins pentru ${id}: ${verdict.reason}`)
    return json({ error: 'unauthorized' }, 401, origin)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Amânarea mută MEMENTOUL, nu scadența: sarcina rămâne când era, doar sună din
  // nou. Trigger-ul `issues_reset_reminder_sent` (migration-push.sql) golește
  // `reminder_sent_at` fiindcă `remind_at` s-a schimbat — de asta reintră în
  // coadă, fără să facem noi nimic explicit.
  const patch = action === 'done'
    ? { done: true }
    : { remind_at: new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString() }

  const { error } = await db.from('issues').update(patch).eq('id', id)
  if (error) return json({ error: error.message }, 500, origin)

  return json({ ok: true, action }, 200, origin)
})
