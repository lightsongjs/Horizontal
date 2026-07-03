import { registerSW } from 'virtual:pwa-register'

// How often an app that stays open keeps polling for a fresh deploy.
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Registers the service worker and keeps installed PWAs up to date.
 *
 * Strategy (chosen: "auto on open/focus"):
 *  - Poll for a new build periodically and every time the app returns to the
 *    foreground (`visibilitychange` / `focus`). This is what fixes stale
 *    installs — an installed PWA otherwise only checks rarely.
 *  - A detected build installs into the *waiting* state (registerType:
 *    'prompt', no skipWaiting) instead of taking over immediately.
 *  - We apply the waiting build — activate it and reload — only when the app
 *    (re)gains focus, i.e. a safe moment, never mid-interaction. Because a
 *    waiting worker persists across the app being backgrounded, the update is
 *    applied on the very next open at the latest.
 */
export function registerPWA(): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      // Activate + reload if a new build is already installed and waiting.
      const applyIfWaiting = () => {
        if (registration.waiting) updateSW(true)
      }
      const checkForUpdate = () => {
        registration.update().catch(() => {})
      }

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        applyIfWaiting() // apply a build found on a previous session
        checkForUpdate() // and look for a newer one
      }

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
      setInterval(checkForUpdate, CHECK_INTERVAL_MS)

      // A build may already be waiting at cold start (found during a previous
      // run). Fresh launch is a safe moment — apply it right away.
      applyIfWaiting()
    },
  })
}
