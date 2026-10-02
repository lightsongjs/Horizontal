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
