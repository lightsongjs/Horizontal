// supabase/functions/calendar-sync/index.ts
//
// Aduce calendarele și evenimentele conturilor Google legate, în fereastra
// −1 zi / +8 zile (`syncWindow`). Două feluri de apelanți:
//   - pg_cron, la 15 minute, cu cheia de serviciu → toate conturile
//     (sau doar `{accountId}`, după o conectare — vezi google-oauth);
//   - clientul, la revenirea în aplicație și la pornirea unui calendar, cu
//     JWT-ul omului → doar conturile LUI, și nu mai des de o dată pe minut.
//
// De ce fereastră completă la fiecare rulare și nu `syncToken`: Google nu
// acceptă `syncToken` împreună cu `timeMin`/`timeMax`, iar fereastra noastră
// alunecă în fiecare zi. Cu token ar trebui să ținem TOT calendarul (ani de
// recurențe expandate) ca să decupăm noi ultima săptămână. Fereastra are câteva
// zeci de evenimente — o pagină de API, sub o secundă.
//
// Upsert, nu șterge-și-pune: marcajele mementourilor (`pre_sent_at`,
// `start_sent_at`) trebuie să supraviețuiască unei rulări în care nimic nu s-a
// schimbat. Ce nu mai vine de la Google se șterge.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  calendarName, defaultEnabled, mapEvent, syncWindow,
  type GoogleCalendarEntry, type GoogleEvent,
} from '../_shared/calendarGoogle.ts'
import { open } from '../_shared/secretBox.ts'

/** Un client care revine în tab de trei ori într-un minut nu e un motiv de trei runde la Google. */
const USER_THROTTLE_MS = 60_000

const env = (k: string) => Deno.env.get(k) ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })

interface Account { id: string; user_id: string; email: string; last_synced_at: string | null }

class Revoked extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!env('GOOGLE_CLIENT_ID') || !env('GOOGLE_CLIENT_SECRET') || !env('CALENDAR_TOKEN_KEY')) {
    // Neconfigurat nu e o eroare a cronului: nu e nimic de sincronizat încă.
    return json({ configured: false, accounts: 0 })
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const body = await req.json().catch(() => ({})) as { accountId?: string; force?: boolean }
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''

  let q = db.from('calendar_accounts').select('id, user_id, email, last_synced_at')
  let fromUser = false
  if (bearer !== env('SUPABASE_SERVICE_ROLE_KEY')) {
    const { data } = await db.auth.getUser(bearer)
    if (!data?.user) return json({ error: 'unauthorized' }, 401)
    q = q.eq('user_id', data.user.id)
    fromUser = true
  }
  if (body.accountId) q = q.eq('id', body.accountId)
  const { data: accounts, error } = await q
  if (error) return json({ error: error.message }, 500)

  const now = Date.now()
  const results: Record<string, string> = {}
  for (const acc of (accounts ?? []) as Account[]) {
    if (fromUser && !body.force && acc.last_synced_at && now - Date.parse(acc.last_synced_at) < USER_THROTTLE_MS) {
      results[acc.email] = 'throttled'
      continue
    }
    try {
      const n = await syncAccount(db, acc, now)
      await db.from('calendar_accounts').update({ status: 'ok', last_error: null, last_synced_at: new Date().toISOString() }).eq('id', acc.id)
      results[acc.email] = `ok:${n}`
    } catch (e) {
      if (e instanceof Revoked) {
        await db.from('calendar_accounts').update({ status: 'reconnect', last_error: e.message }).eq('id', acc.id)
        results[acc.email] = 'reconnect'
      } else {
        // O eroare trecătoare (Google 5xx, rețea) nu marchează contul de
        // reconectat: rulează din nou peste un sfert de oră.
        console.error(`sincronizarea ${acc.email}: ${String(e)}`)
        await db.from('calendar_accounts').update({ last_error: String(e).slice(0, 300) }).eq('id', acc.id)
        results[acc.email] = 'error'
      }
    }
  }

  // Ce a ieșit din fereastră pleacă — tabelul ține o săptămână, nu un istoric.
  const cutoff = new Date(now - 2 * 86_400_000)
  await db.from('calendar_events').delete().eq('all_day', false).lt('end_at', cutoff.toISOString())
  await db.from('calendar_events').delete().eq('all_day', true).lt('end_date', cutoff.toISOString().slice(0, 10))

  return json({ accounts: accounts?.length ?? 0, results })
})

async function accessToken(db: SupabaseClient, accountId: string): Promise<string> {
  const { data: tok } = await db.from('calendar_tokens').select('refresh_token_enc').eq('account_id', accountId).maybeSingle()
  if (!tok) throw new Revoked('lipsește tokenul')
  const refresh = await open(env('CALENDAR_TOKEN_KEY'), tok.refresh_token_enc)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })
  const body = await res.json().catch(() => ({})) as { access_token?: string; error?: string }
  // `invalid_grant` = tokenul e mort (revocat din contul Google, parolă
  // schimbată, neatins 6 luni, sau aplicația GCP încă „Testing" — 7 zile).
  // Doar asta cere reconectare; orice altceva e trecător.
  if (body.error === 'invalid_grant') throw new Revoked('invalid_grant')
  if (!res.ok || !body.access_token) throw new Error(`token ${res.status} ${body.error ?? ''}`)
  return body.access_token
}

async function google<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const url = `https://www.googleapis.com/calendar/v3/${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Revoked('401')
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return await res.json() as T
}

async function syncAccount(db: SupabaseClient, acc: Account, now: number): Promise<number> {
  const token = await accessToken(db, acc.id)

  // ── calendarele ──
  const entries: GoogleCalendarEntry[] = []
  let pageToken: string | undefined
  do {
    const page = await google<{ items?: GoogleCalendarEntry[]; nextPageToken?: string }>(token, 'users/me/calendarList', {
      maxResults: '250', ...(pageToken ? { pageToken } : {}),
    })
    entries.push(...(page.items ?? []).filter((c) => !c.deleted))
    pageToken = page.nextPageToken
  } while (pageToken)

  const { data: known } = await db.from('calendar_calendars').select('id, google_id, enabled').eq('account_id', acc.id)
  const byGoogle = new Map((known ?? []).map((c) => [c.google_id as string, c]))
  // Calendarele noi primesc `enabled` implicit; cele știute își păstrează
  // alegerea omului — upsert-ul NU trimite `enabled` pentru ele.
  const fresh = entries.filter((c) => !byGoogle.has(c.id))
  const kept = entries.filter((c) => byGoogle.has(c.id))
  const meta = (c: GoogleCalendarEntry) => ({
    account_id: acc.id, user_id: acc.user_id, google_id: c.id,
    name: calendarName(c), color: c.backgroundColor ?? null, is_primary: !!c.primary,
  })
  if (fresh.length) {
    const { error } = await db.from('calendar_calendars').insert(fresh.map((c) => ({ ...meta(c), enabled: defaultEnabled(c) })))
    if (error) throw new Error(error.message)
  }
  if (kept.length) {
    const { error } = await db.from('calendar_calendars').upsert(kept.map(meta), { onConflict: 'account_id,google_id' })
    if (error) throw new Error(error.message)
  }
  const gone = (known ?? []).filter((c) => !entries.some((e) => e.id === c.google_id)).map((c) => c.id as string)
  if (gone.length) await db.from('calendar_calendars').delete().in('id', gone)

  // ── evenimentele calendarelor pornite ──
  const { data: cals } = await db.from('calendar_calendars').select('id, google_id').eq('account_id', acc.id).eq('enabled', true)
  const { timeMin, timeMax } = syncWindow(now)
  let total = 0
  for (const cal of cals ?? []) {
    const rows = []
    let pt: string | undefined
    do {
      const page = await google<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        token, `calendars/${encodeURIComponent(cal.google_id as string)}/events`,
        { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pt ? { pageToken: pt } : {}) },
      )
      for (const e of page.items ?? []) {
        const r = mapEvent(e)
        if (r) rows.push({ ...r, user_id: acc.user_id, calendar_id: cal.id, updated_at: new Date().toISOString() })
      }
      pt = page.nextPageToken
    } while (pt)

    if (rows.length) {
      const { error } = await db.from('calendar_events').upsert(rows, { onConflict: 'calendar_id,google_id' })
      if (error) throw new Error(error.message)
    }
    // Ce nu mai e în fereastra Google (șters, mutat în afara ei) pleacă.
    const ids = new Set(rows.map((r) => r.google_id))
    const { data: have } = await db.from('calendar_events').select('id, google_id').eq('calendar_id', cal.id)
    const stale = (have ?? []).filter((h) => !ids.has(h.google_id as string)).map((h) => h.id as string)
    if (stale.length) await db.from('calendar_events').delete().in('id', stale)
    total += rows.length
  }
  return total
}
