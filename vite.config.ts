import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
        theme_color: '#0EA5E9',
        background_color: '#EEF2F7',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
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
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: true, port: 5173 },
}))
