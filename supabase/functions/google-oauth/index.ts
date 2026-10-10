// supabase/functions/google-oauth/index.ts
//
// Legarea unui cont Google Calendar — OAuth pe SERVER (codul se schimbă aici,
// nu în pagină), ca refresh token-ul să nu treacă niciodată prin browser și să
// poată fi folosit de cron cu aplicația închisă.
//
//   POST {action:'status'}                    → { configured }  (fără sesiune)
//   POST {action:'start', returnTo}  + JWT    → { url }  spre ecranul Google
//   GET  ?code&state  (Google ne trimite aici) → 302 înapoi în aplicație
//   POST {action:'disconnect', accountId} + JWT → revocă la Google și șterge
//
// SE DEPLOAZĂ FĂRĂ VERIFICARE DE JWT: callback-ul vine de la browser, purtat de
// Google, fără sesiunea Supabase. Autorizarea e făcută aici: `start` și
// `disconnect` verifică JWT-ul cu `auth.getUser`, callback-ul verifică
// `state`-ul semnat (`_shared/oauthState.ts`).
//   supabase functions deploy google-oauth --no-verify-jwt
//
// Secrete: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (de la om, vezi
// docs/google-calendar-setup.md), CALENDAR_TOKEN_KEY, CALENDAR_STATE_SECRET,
// APP_ORIGINS (deja setat pentru reminder-action).
//
// De ce redirect și nu o pagină HTML de „gata": Supabase servește răspunsurile
// `text/html` ale funcțiilor ca `text/plain`. Așa că întoarcerea e un 302 către
// aplicație, cu `?calendar=connected|error`, iar aplicația spune restul.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mintState, pickReturnOrigin, readState } from '../_shared/oauthState.ts'
import { emailFromIdToken, grantedCalendar, GOOGLE_SCOPES } from '../_shared/calendarGoogle.ts'
import { open, seal } from '../_shared/secretBox.ts'

/** „Până la ~3" (serviciu + personal + încă unul) — cu marjă, dar nu fără plafon. */
const MAX_ACCOUNTS = 5

const env = (k: string) => Deno.env.get(k) ?? ''

const allowedOrigins = () => env('APP_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean)

// `*`, ca la admin-users: autorizarea e JWT-ul din antet, nu originea.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const callbackUrl = () => `${env('SUPABASE_URL')}/functions/v1/google-oauth`

const configured = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('CALENDAR_TOKEN_KEY') && env('CALENDAR_STATE_SECRET'))

const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
})

const back = (origin: string, params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `${origin}/?${new URLSearchParams(params)}` } })

Deno.serve(async (req) => {
  const allowed = allowedOrigins()
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method === 'GET') return callback(new URL(req.url))
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: { action?: string; returnTo?: string; accountId?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  // Fără sesiune: Integrări întreabă asta ca să spună onest „neconfigurat”
  // înainte ca omul să apese ceva care n-are cum să meargă.
  if (body.action === 'status') return json({ configured: configured() })

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const db = admin()
  const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } }
  const user = who?.user
  if (!user) return json({ error: 'unauthorized' }, 401)

  if (body.action === 'start') {
    if (!configured()) return json({ error: 'not-configured' }, 503)
    const { count } = await db.from('calendar_accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    if ((count ?? 0) >= MAX_ACCOUNTS) return json({ error: 'too-many-accounts' }, 409)
    const returnTo = pickReturnOrigin(body.returnTo, allowed)
    if (!returnTo) return json({ error: 'APP_ORIGINS missing' }, 500)
    const state = await mintState(env('CALENDAR_STATE_SECRET'), user.id, returnTo, Date.now())
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: callbackUrl(),
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      // `offline` + `consent`: fără ele Google dă refresh token doar la PRIMA
      // autorizare, iar o reconectare ar ieși fără el — un cont care merge o oră.
      access_type: 'offline',
      // `select_account`: mai multe conturi (serviciu + personal) — fără el,
      // Google ar alege tăcut contul deja logat în browser.
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
      state,
    }).toString()
    return json({ url: url.toString() })
  }

  if (body.action === 'disconnect') {
    if (!body.accountId) return json({ error: 'accountId missing' }, 400)
    const { data: acc } = await db.from('calendar_accounts').select('id').eq('id', body.accountId).eq('user_id', user.id).maybeSingle()
    if (!acc) return json({ error: 'not found' }, 404)
    // Revocarea la Google e politețe, nu condiție: un token pe care nu-l mai
    // putem decripta (cheie rotită) sau o rețea căzută nu țin contul legat.
    const { data: tok } = await db.from('calendar_tokens').select('refresh_token_enc').eq('account_id', acc.id).maybeSingle()
    if (tok && env('CALENDAR_TOKEN_KEY')) {
      try {
        const refresh = await open(env('CALENDAR_TOKEN_KEY'), tok.refresh_token_enc)
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
      } catch (e) {
        console.warn(`revocarea a eșuat pentru ${acc.id}: ${String(e)}`)
      }
    }
    const { error } = await db.from('calendar_accounts').delete().eq('id', acc.id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
})

async function callback(url: URL): Promise<Response> {
  const allowed = allowedOrigins()
  const fallback = allowed[0] ?? env('SUPABASE_URL')
  const state = await readState(env('CALENDAR_STATE_SECRET'), url.searchParams.get('state') ?? '', Date.now())
  // Fără `state` valid nu știm nici cui, nici unde — întoarcem pe prima origine.
  if (!state) return back(fallback, { calendar: 'error', reason: 'state' })
  const origin = state.r

  // Omul a apăsat „Anulează" pe ecranul Google.
  if (url.searchParams.get('error')) return back(origin, { calendar: 'error', reason: 'denied' })
  const code = url.searchParams.get('code')
  if (!code) return back(origin, { calendar: 'error', reason: 'code' })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: callbackUrl(), grant_type: 'authorization_code',
    }),
  })
  const tok = await res.json().catch(() => ({})) as { refresh_token?: string; id_token?: string; scope?: string; error?: string }
  if (!res.ok) {
    console.error(`schimbul codului a eșuat: ${res.status} ${tok.error ?? ''}`)
    return back(origin, { calendar: 'error', reason: 'token' })
  }
  if (!grantedCalendar(tok.scope)) return back(origin, { calendar: 'error', reason: 'scope' })
  const email = emailFromIdToken(tok.id_token)
  if (!email || !tok.refresh_token) return back(origin, { calendar: 'error', reason: 'token' })

  const db = admin()
  const { data: acc, error } = await db.from('calendar_accounts')
    .upsert({ user_id: state.u, email, status: 'ok', last_error: null }, { onConflict: 'user_id,email' })
    .select('id').single()
  if (error || !acc) {
    console.error(`contul nu s-a salvat: ${error?.message}`)
    return back(origin, { calendar: 'error', reason: 'save' })
  }
  const sealed = await seal(env('CALENDAR_TOKEN_KEY'), tok.refresh_token)
  const { error: tErr } = await db.from('calendar_tokens').upsert({ account_id: acc.id, refresh_token_enc: sealed, updated_at: new Date().toISOString() })
  if (tErr) return back(origin, { calendar: 'error', reason: 'save' })

  // Prima sincronizare ACUM, nu peste un sfert de oră: omul se întoarce în
  // aplicație ca să-și vadă calendarul. Așteptată (are câteva secunde), ca
  // lista calendarelor să fie acolo când se deschide Integrări.
  try {
    await fetch(`${env('SUPABASE_URL')}/functions/v1/calendar-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ accountId: acc.id }),
    })
  } catch (e) {
    console.warn(`prima sincronizare a eșuat: ${String(e)}`)
  }
  return back(origin, { calendar: 'connected', email })
}
