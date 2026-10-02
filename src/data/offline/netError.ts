// Ce înseamnă „n-am rețea", separat de „serverul a zis nu".
//
// Distincția decide soarta unei scrieri: una de rețea se pune la coadă și se
// reîncearcă; una de server (RLS, constrângere) se respinge și se anunță.
// Confundate, un bug de cod (`TypeError: Cannot read…`) ar sta în coadă la
// infinit — de-aia `TypeError` NU e suficient, contează mesajul.

export class OfflineError extends Error {
  constructor(message = 'Necesită rețea — ești offline.') {
    super(message)
    this.name = 'OfflineError'
  }
}

// Mesajele cu care Chromium, Firefox, Safari și Node (undici) raportează un
// fetch care n-a ajuns nicăieri. PostgREST le împachetează ca
// `{ message: 'TypeError: Failed to fetch' }`, deci se caută în text.
const NET = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i

export function isNetworkError(e: unknown): boolean {
  if (e instanceof OfflineError) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (typeof e !== 'object' || e === null) return false
  const o = e as { name?: unknown; message?: unknown }
  if (o.name === 'AuthRetryableFetchError') return true
  return typeof o.message === 'string' && NET.test(o.message)
}

// Coduri cu care PostgREST spune „nu știu cine ești" sau „nu ai voie": JWT
// expirat/invalid, acces anonim refuzat, politică RLS încălcată.
const AUTH_CODES = new Set(['PGRST301', 'PGRST302', '42501'])

/**
 * A treia categorie, între rețea și refuz: o scriere care a plecat fără o
 * sesiune valabilă. supabase-js cade singur pe cheia anonimă când n-are
 * sesiune, iar atunci o creare lovește RLS — iar `.single()` raportează
 * rândul pe care inserarea nu l-a putut întoarce ca PGRST116. Tratate ca
 * refuz, golirea ar fi aruncat toată coada; tratate ca rețea, ar fi aprins
 * „offline" cu rețeaua prezentă. Golirea se oprește și păstrează elementul,
 * până vine o sesiune.
 *
 * PGRST116 contează doar la creare: la o actualizare înseamnă că tichetul
 * chiar nu mai există (șters pe alt dispozitiv) — acela e refuz adevărat.
 */
export function isAuthError(e: unknown, kind: string): boolean {
  if (typeof e !== 'object' || e === null) return false
  const o = e as { status?: unknown; statusCode?: unknown; code?: unknown }
  const status = typeof o.status === 'number' ? o.status : Number(o.statusCode)
  if (status === 401 || status === 403) return true
  if (typeof o.code !== 'string') return false
  if (AUTH_CODES.has(o.code)) return true
  return kind === 'createIssue' && o.code === 'PGRST116'
}

/** Doar pentru CITIRI: o rețea care atârnă e, pentru om, o rețea care lipsește.
 *  Nu se pune pe scrieri — o scriere abandonată la timeout poate ajunge totuși
 *  la server, iar reîncercarea ar dubla-o. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new OfflineError()), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}
