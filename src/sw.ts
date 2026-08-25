/// <reference lib="webworker" />
// Service worker-ul aplicației. Scris de mână (strategia `injectManifest`) și
// NU generat, pentru un singur motiv: `push` și `notificationclick`. Un memento
// trebuie să sune cu aplicația închisă, iar singurul cod care rulează atunci e
// acesta.
//
// ATENȚIE — contractul de update. `src/pwa.ts` conține o strategie câștigată cu
// greu (trei defecte măsurate, vezi comentariul de acolo) și acoperită de
// `npm run test:upgrade`. Ea depinde de DOUĂ lucruri de aici:
//
//   1. NU se cheamă `skipWaiting()` la instalare. Un build nou trebuie să stea
//      în starea `waiting` până când pagina decide că e un moment sigur.
//      `src/pwa.ts` îl activează prin `updateSW(true)`, care trimite mesajul
//      `SKIP_WAITING` — de asta îl ascultăm mai jos.
//   2. `clientsClaim()` — workerul activat preia pagina la reload.
//
// Dacă schimbi ceva aici, rulează `npm run test:upgrade`.

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import {
  CHIME_READY_CACHE,
  CHIME_READY_KEY,
  planNotification,
  type ActionRequest,
  type ReminderPayload,
} from './lib/pushPayload'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

/**
 * `lib.dom` descrie `NotificationOptions` pentru pagină, unde `actions`,
 * `badge` și `requireInteraction` nu există. Într-un service worker există —
 * de asta le declarăm, în loc să turnăm un `as any` peste tot obiectul și să
 * pierdem verificarea și pe restul câmpurilor.
 */
type SwNotificationOptions = NotificationOptions & {
  actions?: { action: string; title: string }[]
  badge?: string
  requireInteraction?: boolean
  renotify?: boolean
}

// ── precache (echivalentul a ce genera `generateSW`) ────────────────────────
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

// Fără asta, `updateSW(true)` din `src/pwa.ts` n-are cui să vorbească și un
// build nou rămâne în `waiting` pentru totdeauna.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

// ── mementouri ─────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  // Un push fără date sau cu JSON stricat nu are voie să treacă în silență:
  // utilizatorul a cerut un memento, deci primește ceva. Iar pe unele platforme
  // un `push` care nu arată nicio notificare duce la retragerea permisiunii.
  let payload: ReminderPayload
  try {
    payload = event.data?.json() as ReminderPayload
    if (!payload?.id) throw new Error('payload fără id')
  } catch {
    event.waitUntil(
      self.registration.showNotification('Horizontal', {
        body: 'Ai un memento. Deschide aplicația.',
        tag: 'reminder-fallback',
      }),
    )
    return
  }

  const plan = planNotification(payload)
  event.waitUntil(show(plan, payload.id))
})

/**
 * A anunțat pagina că poate cânta?
 *
 * Se CITEȘTE, nu se întreabă: cât timp promisiunea din `waitUntil` e în
 * așteptare, workerul nu primește evenimente `message`, deci orice
 * întrebare-și-răspuns aici se blochează. Detaliile și ce s-a încercat înainte
 * sunt la constantele din `lib/pushPayload.ts`.
 */
async function pageAnnouncedChime(): Promise<boolean> {
  try {
    const c = await caches.open(CHIME_READY_CACHE)
    return (await c.match(CHIME_READY_KEY)) !== undefined
  } catch {
    return false
  }
}

/**
 * Arată notificarea și, dacă aplicația e în față ȘI poate cânta, îi dă ei
 * sunetul.
 *
 * De ce `silent` doar atunci: sunetul unei notificări e al sistemului și nu se
 * poate înlocui (`Notification.sound` n-a fost implementat de nimeni). Singurul
 * mod de a avea un sunet propriu e ca PAGINA să-l cânte — dar atunci sunetul
 * sistemului ar veni peste el. Deci ori unul, ori altul.
 *
 * Regula, învățată prin regresie: **nu se tace pe presupunere.** O primă
 * versiune făcea `silent` de îndată ce exista o filă vizibilă. Dacă pagina nu
 * avea contextul audio deblocat — un refresh fără niciun click e de ajuns — nu
 * se auzea NIMIC, iar defectul se vedea exact o dată, la ora mementoului. Acum
 * liniștea se cumpără doar cu un anunț explicit al paginii.
 */
async function show(plan: ReturnType<typeof planNotification>, id: string): Promise<void> {
  // `includeUncontrolled`, ca și în restul fișierului: imediat după un build nou
  // fila încă nu e revendicată de workerul activat, dar e pe ecran.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const visible = clients.filter((c) => c.visibilityState === 'visible')

  // Ambele condiții, și fiecare acoperă altceva: anunțul spune că EXISTĂ o
  // pagină cu audio deblocat, fila vizibilă spune că mai e cineva acolo. Un
  // anunț rămas de la o filă închisă nu poate produce liniște, fiindcă atunci
  // nu există nicio filă vizibilă.
  const sing = visible.length > 0 && await pageAnnouncedChime()

  const options: SwNotificationOptions = {
    body: plan.body,
    tag: plan.tag,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // `request` merge în `data` fiindcă tokenul ajunge la noi la `push`, iar
    // butonul se apasă mai târziu, în alt eveniment: `data` e singura punte.
    data: { url: plan.url, id, request: plan.request },
    actions: plan.actions,
    // Un memento care dispare singur e un memento ratat. Pe desktop asta ține
    // notificarea pe ecran; pe **Android e ignorat în silență** (totul intră în
    // tavă, indiferent). Se pune oricum: nu costă nimic și e corect unde e
    // respectat. Doar nu te baza pe el ca garanție.
    requireInteraction: true,
    // Cu `tag` = id-ul tichetului, o reapariție ÎNLOCUIEȘTE notificarea
    // precedentă — iar o înlocuire e MUTĂ dacă nu ceri altfel. Fără asta, un
    // memento amânat care revine peste cinci minute putea ajunge fără sunet și
    // fără vibrație, adică invizibil exact când conta.
    renotify: true,
    silent: sing,
  }
  await self.registration.showNotification(plan.title, options)

  // DUPĂ notificare, nu înainte: dacă `showNotification` aruncă, nu vrem un
  // sunet fără nimic pe ecran — userul ar auzi ceva și n-ar găsi ce.
  //
  // Către TOATE filele vizibile, deși anunțul e unul singur și nu spune care
  // filă l-a scris. Cu două file, alternativa ar fi să ghicim — iar dacă
  // ghicim greșit iese liniște. Un unison în cazul rar cu două file deschise e
  // paguba mai mică; fiecare pagină cântă numai dacă poate.
  if (sing) for (const c of visible) c.postMessage({ type: 'reminder-arrived', id })
}

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification.data ?? {}) as {
    url?: string
    id?: string
    request?: ActionRequest | null
  }
  event.notification.close()

  // Acțiunile se rezolvă FĂRĂ să deschidă aplicația — asta le face utile. Dacă
  // nu există nicio filă deschisă, cererea pleacă direct către API.
  if (event.action === 'done' || event.action === 'snooze') {
    event.waitUntil(resolveAction(event.action, data.id, data.request))
    return
  }

  // Click pe corp → deep link-ul tichetului. `src/lib/deepLink.ts` și mașinăria
  // de URL din App.tsx fac restul; aici nu există logică de rutare.
  const url = data.url ?? '/'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // O filă deja deschisă e refolosită: a doua fereastră cu aceeași aplicație
      // ar rupe starea (formulare nesalvate) și e ce nimeni nu vrea de la un click.
      for (const c of clients) {
        if ('focus' in c) {
          await c.focus()
          if ('navigate' in c) await c.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

/**
 * `Gata` / `Amână` din notificare.
 *
 * NU trece prin `functions/api` — acela cere `X-API-Key`, iar un service worker
 * livrat browserului nu poate ține un secret; cheia ar fi publică în bundle.
 * Sesiunea Supabase a userului stă în `localStorage`, la care un worker nu are
 * acces. Mult timp asta a însemnat că singurul executant e PAGINA, iar fără
 * nicio filă butonul doar deschidea tichetul.
 *
 * Ce a deblocat cazul „aplicația e închisă": un token HMAC de scurtă durată,
 * trimis în payload-ul de push. Payload-ul e criptat pentru abonament (RFC
 * 8291), deci tokenul e o dovadă pe care numai acest dispozitiv o poate citi —
 * un secret pe care workerul îl PRIMEȘTE, nu unul pe care îl ține. Cu el,
 * `supabase/functions/reminder-action` acceptă scrierea fără sesiune.
 *
 * Ordinea de preferință, și de ce: pagina întâi (își reîmprospătează și
 * ecranul), apoi cererea semnată, apoi deschiderea tichetului.
 */
async function resolveAction(
  action: 'done' | 'snooze',
  id?: string,
  request?: ActionRequest | null,
): Promise<void> {
  if (!id) return

  // Cu o filă deschisă, PAGINA rămâne executantul preferat — nu din
  // constrângere, ci fiindcă ea își actualizează și interfața pe loc. O cerere
  // de aici ar reuși, dar ar lăsa ecranul arătând starea veche.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length > 0) {
    for (const c of clients) c.postMessage({ type: 'reminder-action', action, id })
    return
  }

  // Fără nicio filă: cererea semnată. Tokenul a venit criptat în payload-ul de
  // push (RFC 8291), deci e o dovadă pe care numai acest dispozitiv o are — vezi
  // `supabase/functions/_shared/reminderToken.ts`.
  if (request) {
    try {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, action, token: request.token }),
      })
      if (res.ok) return
      console.error(`reminder-action a răspuns ${res.status} pentru ${id}`)
    } catch (e) {
      // Offline, sau token expirat: se cade pe deschiderea tichetului. Regula e
      // aceeași ca la sunet — mai bine o atingere în plus decât o acțiune care
      // pare făcută și nu s-a întâmplat.
      console.error(`reminder-action a eșuat pentru ${id}: ${String(e)}`)
    }
  }

  await self.clients.openWindow(`/${id}`)
}
