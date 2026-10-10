// supabase/functions/_shared/calendarGoogle.ts
//
// Traducerea din API-ul Google Calendar în rândurile noastre — pur, testat pe
// fixtures (`calendarGoogle.test.ts`). `calendar-sync` face rețeaua; aici se
// decide CE se păstrează și în ce formă.

/** Fereastra sincronizată: de ieri până peste opt zile („7 zile" + marjă de fus). */
export const SYNC_PAST_DAYS = 1
export const SYNC_FUTURE_DAYS = 8

export function syncWindow(nowMs: number): { timeMin: string; timeMax: string } {
  const day = 86_400_000
  return {
    timeMin: new Date(nowMs - SYNC_PAST_DAYS * day).toISOString(),
    timeMax: new Date(nowMs + SYNC_FUTURE_DAYS * day).toISOString(),
  }
}

/** Forma (parțială) a unui `CalendarListEntry`. */
export interface GoogleCalendarEntry {
  id: string
  summary?: string
  summaryOverride?: string
  backgroundColor?: string
  primary?: boolean
  selected?: boolean
  hidden?: boolean
  deleted?: boolean
}

/**
 * Calendarele generate de Google, nu scrise de om: sărbătorile, zilele de
 * naștere ale contactelor, numerele de săptămână. Pornesc OPRITE — altfel
 * prima conectare ar umple „Azi" cu zile de naștere ale unor oameni pe care nu
 * i-ai mai văzut de zece ani. Rămân în listă, deci se pot porni dintr-o atingere.
 */
const GENERATED = /#(holiday|contacts|weeknum|other)@group\.v\.calendar\.google\.com$/

export function defaultEnabled(c: GoogleCalendarEntry): boolean {
  if (GENERATED.test(c.id)) return false
  // Ascuns sau debifat chiar în Google: omul a spus deja că nu vrea să-l vadă.
  if (c.hidden || c.selected === false) return false
  return true
}

export function calendarName(c: GoogleCalendarEntry): string {
  return (c.summaryOverride || c.summary || c.id).trim()
}

/** Forma (parțială) a unui `Event`. */
export interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  hangoutLink?: string
  eventType?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

export interface EventRow {
  google_id: string
  title: string
  all_day: boolean
  start_at: string | null
  end_at: string | null
  start_date: string | null
  end_date: string | null
  location: string | null
  meet_url: string | null
  html_link: string | null
  response: string | null
}

/** Un link de videoconferință scris de mână în loc sau în descriere. */
const VIDEO_URL = /https:\/\/(?:[\w-]+\.)*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com)\/[^\s"'<>)]*/i

export function meetUrl(e: GoogleEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri)
  if (video?.uri) return video.uri
  for (const text of [e.location, e.description]) {
    const m = text ? VIDEO_URL.exec(text) : null
    // Punctuația de final e a propoziției, nu a linkului („…/j/987?pwd=x.").
    if (m) return m[0].replace(/[.,;:!?]+$/, '')
  }
  return null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Un eveniment Google → rândul nostru, sau `null` dacă nu se arată deloc:
 * anulat (o instanță ștearsă dintr-o serie vine ca `cancelled`), „locul de
 * muncă" (`workingLocation` — o etichetă a zilei, nu ceva ce se întâmplă), sau
 * fără un capăt citibil.
 */
export function mapEvent(e: GoogleEvent): EventRow | null {
  if (!e.id || e.status === 'cancelled') return null
  if (e.eventType === 'workingLocation') return null
  const self = e.attendees?.find((a) => a.self)
  const base = {
    google_id: e.id,
    title: (e.summary ?? '').trim(),
    location: e.location?.trim() || null,
    meet_url: meetUrl(e),
    html_link: e.htmlLink ?? null,
    response: self?.responseStatus ?? null,
  }
  if (e.start?.date && e.end?.date) {
    if (!DATE.test(e.start.date) || !DATE.test(e.end.date)) return null
    return { ...base, all_day: true, start_at: null, end_at: null, start_date: e.start.date, end_date: e.end.date }
  }
  const s = e.start?.dateTime ? Date.parse(e.start.dateTime) : NaN
  const en = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN
  if (!Number.isFinite(s) || !Number.isFinite(en)) return null
  return {
    ...base, all_day: false,
    start_at: new Date(s).toISOString(), end_at: new Date(Math.max(s, en)).toISOString(),
    start_date: null, end_date: null,
  }
}

/** Ce scope-uri cerem. `calendar.readonly` dă și lista de calendare, și evenimentele. */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly']

/**
 * Consimțământul Google e granular: omul poate debifa accesul la calendar pe
 * ecranul „Autorizează" și totuși apasă „Continuă". Atunci nu există nimic de
 * sincronizat, iar un cont conectat care nu arată nimic ar minți.
 */
export function grantedCalendar(scope: string | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes('https://www.googleapis.com/auth/calendar.readonly')
}

/** Emailul din `id_token`. Tokenul vine direct de la Google, pe TLS, ca răspuns la codul nostru — nu e nevoie de verificarea semnăturii. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const part = idToken?.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    const email = (JSON.parse(json) as { email?: unknown }).email
    return typeof email === 'string' && email.includes('@') ? email.toLowerCase() : null
  } catch {
    return null
  }
}
