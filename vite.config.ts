/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

/**
 * Commitul scurt al buildului, pentru tooltipul vârstei buildului (sub
 * numele omului). Cloudflare Pages dă `CF_PAGES_COMMIT_SHA`; altfel git.
 * Fără niciunul (arhivă fără `.git`, git lipsă) rămâne gol — nu pică buildul.
 */
function buildCommit(): string {
  const cf = process.env.CF_PAGES_COMMIT_SHA
  if (cf) return cf.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

export default defineConfig(({ command: _command }) => ({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a new build installs into the waiting
      // state instead of activating mid-session. src/pwa.ts decides when to
      // apply it (on app open / focus), avoiding reloads while a user edits.
      registerType: 'prompt',
      // `injectManifest`, nu `generateSW`: avem nevoie de `push` și
      // `notificationclick`, adică de cod propriu în worker. `src/sw.ts`
      // reproduce exact ce genera workbox (precache + clientsClaim +
      // cleanupOutdatedCaches + ascultătorul de SKIP_WAITING) — contractul de
      // care depinde strategia din src/pwa.ts. Acoperit de `npm run test:upgrade`.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Horizontal',
        short_name: 'Horizontal',
        description: 'Project planning with dependency layers and waves',
        theme_color: '#1A237E',
        background_color: '#F7F9FC',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      // Ce s-a pierdut trecând de la `generateSW` la `injectManifest`, și de ce
      // nu contează:
      //
      //  • `clientsClaim` / `cleanupOutdatedCaches` / absența lui skipWaiting —
      //    scrise explicit în `src/sw.ts`, fiindcă de ele depinde strategia de
      //    update din `src/pwa.ts`.
      //  • regulile de `runtimeCaching` pentru fonturile Google — nu mai sunt
      //    generate. Fonturile continuă să funcționeze: erau prinse la prima
      //    cerere, nu precache-uite, iar browserul le ține oricum în HTTP cache.
      //  • regula `NetworkOnly` pe URL-urile semnate din Supabase Storage era
      //    documentație în cod: nicio regulă nu se potrivea pe *.supabase.co,
      //    deci nu se cachea nimic. Fără reguli de runtime, nici nu se poate.
      //
      // Blocul `workbox: { ... }` a fost ȘTERS în loc de comentat: cu
      // `injectManifest` nu se aplică, iar configurație moartă care arată vie e
      // mai rea decât o notă.
    }),
  ],
  // Înghețate în bundle la build (în dev: la pornirea serverului; în vitest:
  // la pornirea rulării). Le citește numai `BuildAge.tsx` — NU `src/sw.ts`:
  // workerul trebuie să rămână același între buildurile fără schimbări în el
  // (contractul din `npm run test:upgrade`).
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  server: { host: true, port: 5173 },
  // `.claude/**` = worktree-urile agenților (copii întregi ale repo-ului): fără
  // excludere, `npm test` le-ar rula testele de două ori, din altă versiune.
  test: { exclude: [...configDefaults.exclude, '.claude/**', '.worktrees/**'] },
}))
