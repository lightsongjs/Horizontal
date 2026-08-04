import { registerSW } from 'virtual:pwa-register'

// How often an app that stays open keeps polling for a fresh deploy.
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
// How long after the app returns to the foreground we still treat "a build just became
// ready" as a safe moment to reload. Checking + installing takes a moment; if it lands
// inside this window the user has only just arrived, so reloading costs them nothing.
// If it takes longer (slow network) we wait for the next return — better one more visit
// on the old build than a reload on top of someone who started typing.
const APPLY_WINDOW_MS = 15 * 1000

/**
 * Registers the service worker and keeps installed PWAs up to date.
 *
 * Strategy ("auto on open/focus"): poll for a new build periodically and whenever the app
 * returns to the foreground; a detected build installs into the *waiting* state
 * (registerType: 'prompt', no skipWaiting) instead of taking over mid-session; we apply it
 * only at a safe moment.
 *
 * The previous version of this file — and the recipe in docs/pwa-cloudflare-playbook.md,
 * which had been copied into other apps — looked right but was measured broken on the one
 * path that matters: a client that already has the old service worker installed. Three
 * separate defects, all invisible when reading the code (see the mateSimo project, ticket
 * MS-123, and `npm run test:upgrade` here):
 *
 *  1. IT NEVER RELOADED. `updateSW(true)` activates the waiting worker but does not
 *     reload the page, so the old document stayed on screen: the user had the new build in
 *     cache and the old one in front of them — the state that only a manual refresh fixes.
 *     A tab left open never updated at all. (A fresh *navigation* did pick up the new
 *     build once the worker was active, which is why this looked like "it applies on the
 *     second open".)
 *  2. TOO LATE. `applyIfWaiting()` ran *before* the check, so the first return to the
 *     foreground only discovered the build. And `registration.update()` resolves BEFORE
 *     the new worker finishes installing, so simply awaiting it is not enough either: the
 *     only correct signal is the incoming worker reaching the `installed` state.
 *  3. OTHER TABS WERE LEFT BEHIND. Whoever applies the update consumes
 *     `registration.waiting`, so every other open tab has nothing left to apply — measured:
 *     it stays on the old version indefinitely.
 *
 * Deliberately kept: the periodic check only LOOKS, it never applies. Otherwise a deploy
 * could reload the page on top of unsaved work.
 */
export function registerPWA(): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      let applying = false // we activated it, so reloading is justified
      let reloading = false // `controllerchange` can fire more than once
      let applyUntil = 0 // window opened by returning to the foreground
      let staleDocument = false // another tab activated the build; our document is old

      const reload = () => {
        if (reloading) return
        reloading = true
        window.location.reload()
      }

      // Did this page start out controlled by a service worker? If not, the first
      // takeover is the normal install event, not a sign that our screen is stale.
      // Without this check, every new visitor gets one pointless reload.
      const hadController = !!navigator.serviceWorker.controller

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (applying) return reload()
        if (!hadController) return // first install, not a new build
        // Another tab applied the update, so `registration.waiting` is already empty and
        // `applyIfWaiting()` would never have anything to do here. Don't reload now: this
        // tab is in the background and an invisible reload would throw away what the user
        // typed in it. Reload when they come back to it.
        staleDocument = true
      })

      const applyIfWaiting = () => {
        if (!registration.waiting) return
        if (Date.now() > applyUntil) return // outside the window: wait for the next return
        applying = true
        updateSW(true)
      }

      // The moment the new build is ready to use. Without this listener, a build that
      // finishes installing a second after the user returned would sit unused until the
      // return after that.
      registration.addEventListener('updatefound', () => {
        const incoming = registration.installing
        if (!incoming) return
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed') applyIfWaiting()
        })
      })

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        if (staleDocument) return reload() // build is live, only our screen is old
        applyUntil = Date.now() + APPLY_WINDOW_MS
        applyIfWaiting() // a build found in a previous session
        registration.update().catch(() => {}) // a new one is caught by `updatefound`
      }

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
      // Check only, never apply — see the note above about unsaved work.
      setInterval(() => registration.update().catch(() => {}), CHECK_INTERVAL_MS)

      onForeground() // a build may already be waiting at cold start
    },
  })
}
