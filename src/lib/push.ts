// Abonarea la web push. Singura cale prin care un memento sună cu aplicația
// ÎNCHISĂ — vezi tabelul din docs/superpowers/brainstorm/2026-08-24-mod-todo.md:
// Notification Triggers e abandonat, Periodic Background Sync e doar Chrome cu
// minim 12 ore. Rămâne push-ul.

import { supabase } from './supabase'

export type PushState =
  /** Browserul nu are Push API (sau pe iOS: nu e adăugat pe ecranul de start). */
  | 'unsupported'
  /** Nu există cont: abonamentul se leagă de un user, deci nu are unde să stea. */
  | 'no-account'
  /** Permisiunea a fost refuzată. Nu se mai poate cere din cod — doar din setările browserului. */
  | 'denied'
  | 'off'
  | 'on'

/** Cheia publică VAPID. Fără ea, abonarea nu are cu ce semna. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/**
 * Pe iOS, Web Push există DOAR pentru un PWA adăugat pe ecranul de start
 * (16.4+). Într-un Safari obișnuit, `PushManager` lipsește cu totul, deci
 * verificarea de mai jos e suficientă — dar mesajul pe care îl arătăm
 * utilizatorului trebuie să spună de ce, iar `isIOS` alege textul.
 */
export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Base64 URL-safe → octeți, forma cerută de `applicationServerKey`.
 *
 * Tamponul se alocă explicit (`new ArrayBuffer`) pentru ca tipul rezultat să fie
 * `Uint8Array<ArrayBuffer>`: `Uint8Array.from` produce `ArrayBufferLike`, pe
 * care `subscribe()` nu-l acceptă (ar putea fi un SharedArrayBuffer).
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function readPushState(): Promise<PushState> {
  if (!supported() || !VAPID_PUBLIC_KEY) return 'unsupported'
  if (!supabase) return 'no-account'
  const { data } = await supabase.auth.getSession()
  if (!data.session) return 'no-account'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/**
 * Cere permisiunea și înregistrează abonamentul.
 *
 * TREBUIE chemată din gestul utilizatorului (click). Nu e o preferință de stil:
 * pe iOS `requestPermission()` în afara unui gest eșuează, iar Chrome
 * penalizează cererile nesolicitate. De asta nu există nicio variantă „cere la
 * pornire" în acest fișier.
 */
export async function enablePush(): Promise<PushState> {
  if (!supported() || !VAPID_PUBLIC_KEY) return 'unsupported'
  if (!supabase) return 'no-account'
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return 'no-account'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const reg = await navigator.serviceWorker.ready
  // Un abonament existent se refolosește: `subscribe` cu aceeași cheie l-ar
  // întoarce pe el oricum, dar cu o cheie schimbată ar arunca — iar atunci
  // vrem să pornim de la zero, nu să eșuăm.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      // Obligatoriu `true`: promitem că fiecare push produce o notificare
      // vizibilă. `src/sw.ts` respectă promisiunea chiar și pentru un payload
      // stricat, altfel browserul retrage permisiunea.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      ua: navigator.userAgent.slice(0, 300),
    },
    // Endpoint-ul e cheia naturală: același dispozitiv reabonat întoarce
    // același endpoint, iar un al doilea rând ar produce notificări duble.
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    // Rândul se șterge ÎNAINTE de dezabonare: dacă ordinea e inversă și
    // ștergerea eșuează, serverul continuă să trimită către un endpoint mort.
    if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  return 'off'
}

/** Textul de sub comutator: de ce nu se poate, când nu se poate. */
export function pushHint(state: PushState): string {
  switch (state) {
    case 'unsupported':
      return isIOS() && !isStandalone()
        ? 'Pe iPhone, notificările merg doar după ce adaugi aplicația pe ecranul de start.'
        : 'Browserul acesta nu suportă notificări push.'
    case 'no-account':
      return 'Notificările au nevoie de un cont — abonamentul se leagă de utilizator.'
    case 'denied':
      return 'Ai refuzat notificările. Se pot reactiva doar din setările browserului.'
    case 'on':
      return 'Mementourile sună și cu aplicația închisă.'
    case 'off':
      return 'Primești un memento la ora sarcinii.'
  }
}
