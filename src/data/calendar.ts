// Google Calendar — citirile și cele câteva comenzi ale clientului.
//
// De ce în afara `Repository`: calendarul NU e o entitate a aplicației (nu se
// creează, nu se editează, nu are mod local), ci o oglindă doar-de-citit pe
// care o scriu funcțiile edge. Ar fi cerut trei implementări (Supabase, local,
// offline) pentru două `select`-uri. Cache-ul offline e același IndexedDB ca
// restul (`horizontal-offline`), deci `sync.clear()` de la deconectare îl
// golește odată cu tot ce e al contului.
//
// Offline: listele arată evenimentele din ultima citire (ca proiectele);
// comenzile (conectează, deconectează, comutator) spun onest că cer rețea.

import { supabase } from '../lib/supabase'
import type { CalendarAccount, CalendarEvent, CalendarInfo } from '../lib/calendarEvents'
import { openKv, type Kv } from './offline/kv'
import { OfflineError, isNetworkError, withTimeout } from './offline/netError'

const K = { events: 'cal:events', accounts: 'cal:accounts' }
const READ_TIMEOUT_MS = 10_000

/** Calendarul există doar pe Supabase; în modul local nu e nimic de legat. */
export const calendarAvailable = import.meta.env.VITE_DATA_SOURCE === 'supabase' && !!supabase

let kvPromise: Promise<Kv | null> | null = null
const kv = () => (kvPromise ??= typeof indexedDB === 'undefined' ? Promise.resolve(null) : openKv().catch(() => null))

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : null)

export function rowToEvent(r: Row): CalendarEvent {
  return {
    id: String(r.id),
    calendarId: String(r.calendar_id),
    title: str(r.title) ?? '',
    allDay: r.all_day === true,
    startAt: str(r.start_at),
    endAt: str(r.end_at),
    startDate: str(r.start_date),
    endDate: str(r.end_date),
    location: str(r.location),
    meetUrl: str(r.meet_url),
    htmlLink: str(r.html_link),
    response: str(r.response),
  }
}

export function rowsToAccounts(accounts: Row[], calendars: Row[]): CalendarAccount[] {
  const byAccount = new Map<string, CalendarInfo[]>()
  for (const c of calendars) {
    const info: CalendarInfo = {
      id: String(c.id), accountId: String(c.account_id), name: str(c.name) ?? '',
      color: str(c.color), enabled: c.enabled === true, isPrimary: c.is_primary === true,
    }
    const list = byAccount.get(info.accountId) ?? []
    list.push(info)
    byAccount.set(info.accountId, list)
  }
  return accounts.map((a) => ({
    id: String(a.id),
    email: str(a.email) ?? '',
    status: a.status === 'reconnect' ? 'reconnect' : 'ok',
    lastSyncedAt: str(a.last_synced_at),
    lastError: str(a.last_error),
    // Principalul întâi, apoi alfabetic — ca în Google.
    calendars: (byAccount.get(String(a.id)) ?? []).sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.name.localeCompare(y.name)),
  }))
}

/** O citire de rețea cu plasă: la lipsă de rețea, ultima copie; altfel eroarea. */
async function read<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const store = await kv()
  try {
    const v = await withTimeout(fetch(), READ_TIMEOUT_MS)
    await store?.set(key, v).catch(() => {})
    return v
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const cached = store ? await store.get<T>(key).catch(() => undefined) : undefined
    if (cached === undefined) throw new OfflineError()
    return cached
  }
}

const need = () => {
  if (!supabase) throw new Error('Calendarul cere Supabase.')
  return supabase
}

/** Primul cadru, fără rețea. `null` = nimic în cache. */
export async function cachedCalendar(): Promise<{ events: CalendarEvent[]; accounts: CalendarAccount[] } | null> {
  const store = await kv()
  if (!store) return null
  const [events, accounts] = await Promise.all([store.get<CalendarEvent[]>(K.events), store.get<CalendarAccount[]>(K.accounts)])
    .catch(() => [undefined, undefined] as const)
  if (!events || !accounts) return null
  return { events, accounts }
}

export function listCalendarEvents(): Promise<CalendarEvent[]> {
  return read(K.events, async () => {
    const { data, error } = await need().from('calendar_events')
      .select('id, calendar_id, title, all_day, start_at, end_at, start_date, end_date, location, meet_url, html_link, response')
    if (error) throw error
    return (data ?? []).map(rowToEvent)
  })
}

export function listCalendarAccounts(): Promise<CalendarAccount[]> {
  return read(K.accounts, async () => {
    const db = need()
    const [a, c] = await Promise.all([
      db.from('calendar_accounts').select('id, email, status, last_synced_at, last_error').order('created_at'),
      db.from('calendar_calendars').select('id, account_id, name, color, enabled, is_primary'),
    ])
    if (a.error) throw a.error
    if (c.error) throw c.error
    return rowsToAccounts(a.data ?? [], c.data ?? [])
  })
}

/** Corpul unei erori de funcție edge (`functions.invoke` ascunde motivul în `context`). */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await need().functions.invoke(fn, { body })
  if (error) {
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      const j = await ctx.json().catch(() => null) as { error?: string } | null
      if (j?.error) throw new Error(j.error)
    }
    throw error
  }
  return data as T
}

/** E configurat clientul OAuth pe server? Integrări îl întreabă înainte de a oferi butonul. */
export async function calendarConfigured(): Promise<boolean> {
  const r = await invoke<{ configured?: boolean }>('google-oauth', { action: 'status' })
  return r.configured === true
}

/** Adresa ecranului Google „Autorizează"; întoarcerea e pe originea curentă. */
export async function googleConnectUrl(): Promise<string> {
  const r = await invoke<{ url?: string }>('google-oauth', { action: 'start', returnTo: location.origin })
  if (!r.url) throw new Error('Răspuns fără adresă.')
  return r.url
}

export async function disconnectCalendarAccount(accountId: string): Promise<void> {
  await invoke('google-oauth', { action: 'disconnect', accountId })
  const store = await kv()
  const cur = store ? await store.get<CalendarAccount[]>(K.accounts).catch(() => undefined) : undefined
  if (store && cur) await store.set(K.accounts, cur.filter((a) => a.id !== accountId)).catch(() => {})
}

export async function setCalendarEnabled(calendarId: string, enabled: boolean): Promise<void> {
  const { error } = await need().from('calendar_calendars').update({ enabled }).eq('id', calendarId)
  if (error) throw error
}

/**
 * Cere o rundă de sincronizare pentru conturile omului. Serverul o refuză tăcut
 * dacă a mai fost una în ultimul minut (`force` o forțează — după pornirea unui
 * calendar, când omul așteaptă să-l vadă).
 */
export async function syncCalendars(force = false): Promise<void> {
  await invoke('calendar-sync', force ? { force: true } : {})
}

/** Ce mesaj primește omul pentru un `reason` întors de callback-ul OAuth. */
export function connectErrorText(reason: string | null): string {
  switch (reason) {
    case 'denied': return 'Ai anulat autorizarea la Google.'
    case 'scope': return 'Google n-a dat acces la calendar — bifează „Vezi calendarele” pe ecranul de autorizare.'
    case 'state': return 'Legătura a expirat. Încearcă din nou din Setări.'
    default: return 'Conectarea la Google n-a reușit. Încearcă din nou.'
  }
}

/** Ce mesaj primește omul pentru o eroare din `start`. */
export function startErrorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (e instanceof OfflineError || isNetworkError(e)) return 'Necesită rețea — ești offline.'
  if (m === 'not-configured') return 'Integrarea nu e configurată pe server încă.'
  if (m === 'too-many-accounts') return 'Ai atins numărul maxim de conturi legate.'
  return m
}
