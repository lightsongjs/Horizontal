# PWA + Cloudflare Pages — update playbook

> **Citește întâi `LightSongAppTemplate/releases-and-builds.md`.** Acolo e versiunea
> completă și corectată a rețetei, plus cele două lucruri care lipseau de aici: cum
> **verifici** un release (test automat + marker unic în bundle) și stratul 3 — migrații și
> edge functions, care nu trec prin `git push`.
>
> **Rețeta din secțiunea 1b de mai jos era ruptă** și a fost înlocuită. Arăta corect la
> citire, dar măsurat: un tab lăsat deschis **nu prelua niciodată** buildul nou, fiindcă
> `updateSW(true)` activează service workerul dar nu reîncarcă pagina — exact ce promite
> textul de mai jos că face („activate it and reload"). Detaliile și celelalte două defecte:
> `src/pwa.ts` din acest repo, plus `npm run test:upgrade`.
>
> Ce a rămas valabil aici, integral: **Piece 2** (headerele Cloudflare — piesa pe care lumea
> o uită) și **Scenario B** (tranziția pentru aplicații care au deja useri instalați).

Reusable recipe so installed PWAs always pick up new deploys. Copy this into
every new app hosted on Cloudflare Pages. Set it up **from the first line of
code** — retrofitting an app that already has installed users needs a
transition (see Scenario B).

The problem it prevents: a user installs the PWA, you ship a new build, but
their installed app keeps running the old build for hours/days (or forever).

There are **two pieces, and both must be correct**. If either is missing,
updates silently fail.

---

## Piece 1 — App side (service worker logic)

### 1a. `vite.config.ts` — VitePWA options

```ts
VitePWA({
  // 'prompt', NOT 'autoUpdate': a new build installs into the *waiting*
  // state instead of hijacking the page mid-session. We apply it ourselves.
  registerType: 'prompt',
  workbox: {
    // NO skipWaiting here — the new SW must wait so we control when it
    // activates. clientsClaim lets it control the page on reload;
    // cleanupOutdatedCaches purges old precaches.
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
  // ...manifest, icons, etc.
})
```

### 1b. `src/pwa.ts` — register + check on focus/open, apply at a safe moment

```ts
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export function registerPWA(): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const applyIfWaiting = () => { if (registration.waiting) updateSW(true) }
      const checkForUpdate = () => { registration.update().catch(() => {}) }

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        applyIfWaiting() // apply a build found in a previous session
        checkForUpdate() // and look for a newer one
      }

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
      setInterval(checkForUpdate, CHECK_INTERVAL_MS)

      applyIfWaiting() // a build may already be waiting at cold start
    },
  })
}
```

Call it once, after mounting the app:

```ts
// src/main.tsx
import { registerPWA } from './pwa'
// ...createRoot(...).render(...)
registerPWA()
```

Add the virtual-module types (`src/vite-env.d.ts`):

```ts
/// <reference types="vite-plugin-pwa/client" />
```

**Why apply on focus/open (not instantly):** reloading the moment a new build
is detected can interrupt a user mid-edit and lose unsaved changes. A waiting
worker persists across the app being backgrounded, so the update is applied on
the very next open at the latest — seamless and safe.

---

## Piece 2 — Cloudflare side (`public/_headers`)

**This is the piece people forget, and without it nothing above works** —
Cloudflare will serve a cached `sw.js` and the browser never sees the new
build.

```
# public/_headers
/sw.js
  Cache-Control: no-cache
/registerSW.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/
  Cache-Control: no-cache

# Hashed build assets are content-addressed — cache forever.
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`no-cache` = "always revalidate before using" (not "never store"), so the
service worker and app shell are re-checked on every load → a new build is
detected immediately. Hashed `/assets/*` get a new filename per build, so they
are safe to cache forever.

---

## The two scenarios

### Scenario A — new app, no users yet (greenfield)

Ship Piece 1 + Piece 2 from day one. Every install gets the good behavior
immediately. **No transition needed** — this is just "how it works."

### Scenario B — app already installed on users' devices

Their phones run whatever SW you shipped before, so they need a one-time
**transition** to move onto the new update logic:

1. Ship the change (Piece 1 + Piece 2). Their **current** SW must pick up the
   new `sw.js` once.
2. The catch: if the old hosting cached `sw.js` (no `_headers`), the browser
   keeps serving the old one and never detects the new build. Fixing the
   headers helps future checks; the browser also force-revalidates a SW at
   most every 24h. Worst case for a truly stuck client: reinstall.
3. Once the new SW (with the focus-check logic) is installed and active, **all
   future deploys** use the new behavior.

So it's **one transition deploy** where the old SW swaps itself for the new
one; from the **next** deploy onward the new logic governs. If the old SW was
`autoUpdate`, that transition happens automatically (one self-reload).

---

## Checklist for a new Cloudflare-hosted PWA

- [ ] `vite-plugin-pwa` installed
- [ ] `registerType: 'prompt'`, no `skipWaiting`, `cleanupOutdatedCaches: true`
- [ ] `src/pwa.ts` added and `registerPWA()` called from `main.tsx`
- [ ] `/// <reference types="vite-plugin-pwa/client" />` in `vite-env.d.ts`
- [ ] `public/_headers` with `no-cache` on sw/shell + `immutable` on `/assets/*`
- [ ] `npm run build` produces `dist/sw.js` and copies `dist/_headers`
