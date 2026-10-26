import type { CapacitorConfig } from '@capacitor/cli'

// Cutia încarcă site-ul PUBLICAT, nu un bundle: un push pe master ajunge pe
// telefon prin service worker, fără APK nou (ca pe Linux). `HORIZONTAL_URL`
// doar pentru probă locală (ex. `http://localhost:4173` cu `adb reverse`).
const url = process.env.HORIZONTAL_URL ?? 'https://horizontal-dyx.pages.dev'

const config: CapacitorConfig = {
  appId: 'ro.horizontal.app',
  appName: 'Horizontal',
  // Cerut de Capacitor chiar cu `server.url`; e doar pagina de rezervă.
  webDir: 'www',
  server: { url, cleartext: url.startsWith('http://') },
  android: {
    // Depanare prin `adb forward` + CDP (mobile/scripts/cdp.mjs). Pe un APK
    // instalat prin sideload cere oricum USB debugging autorizat.
    webContentsDebuggingEnabled: true,
    // Bridge-ul Capacitor scrie în logcat datele fiecărui apel de plugin pe un
    // build debuggable — inclusiv parola din `signIn`. Logcat-ul e citibil de
    // oricine are `adb`; nu-l vrem plin de parole.
    loggingBehavior: 'none',
  },
}
export default config
