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
import { planNotification, type ReminderPayload } from './lib/pushPayload'

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
  const options: SwNotificationOptions = {
    body: plan.body,
    tag: plan.tag,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: plan.url, id: payload.id },
    actions: plan.actions,
    // Un memento care dispare singur e un memento ratat.
    requireInteraction: true,
  }
  event.waitUntil(self.registration.showNotification(plan.title, options))
})

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification.data ?? {}) as { url?: string; id?: string }
  event.notification.close()

  // Acțiunile se rezolvă FĂRĂ să deschidă aplicația — asta le face utile. Dacă
  // nu există nicio filă deschisă, cererea pleacă direct către API.
  if (event.action === 'done' || event.action === 'snooze') {
    event.waitUntil(resolveAction(event.action, data.id))
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
 * acces. Deci singurul executant legitim e PAGINA.
 *
 * Cu o filă deschisă, acțiunea se rezolvă fără ca userul să vadă nimic. Fără
 * filă, deschidem tichetul: e o atingere în loc de zero, dar e onest — mai bine
 * decât o acțiune care pare făcută și nu s-a întâmplat.
 */
async function resolveAction(action: 'done' | 'snooze', id?: string): Promise<void> {
  if (!id) return
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length > 0) {
    for (const c of clients) c.postMessage({ type: 'reminder-action', action, id })
    return
  }
  await self.clients.openWindow(`/${id}`)
}
