// Evaluează o expresie în WebView-ul aplicației, pe dispozitivul conectat prin adb.
// Folosire: node mobile/scripts/cdp.mjs 'window.Capacitor?.getPlatform()'
// Cu mai multe dispozitive adb (telefon + emulator) setează ANDROID_SERIAL; fără el adb refuză să aleagă.
// Cere `webContentsDebuggingEnabled` (capacitor.config.ts) și aplicația pornită.
//
// CDP direct pe WebSocket, nu Playwright: `connectOverCDP` cere de la țintă
// `Browser.setDownloadBehavior`, iar WebView-ul Android răspunde „Browser
// context management is not supported" și conexiunea cade înainte de orice pagină.
import { execFileSync } from 'node:child_process'

const serial = process.env.ANDROID_SERIAL
const sh = (...a) => execFileSync('adb', serial ? ['-s', serial, ...a] : a, { encoding: 'utf8' }).trim()
const pid = sh('shell', 'pidof', 'ro.horizontal.app')
if (!pid) throw new Error('aplicația nu rulează (adb shell monkey -p ro.horizontal.app 1)')
sh('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`)

const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http')) ?? targets.find((t) => t.type === 'page')
if (!page) throw new Error('nicio pagină în WebView')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket CDP')) })
const reply = await new Promise((res, rej) => {
  // Fără termen, o pagină blocată ar atârna scriptul la nesfârșit.
  const t = setTimeout(() => rej(new Error('CDP: niciun răspuns în 15s')), 15000)
  ws.onclose = () => rej(new Error('CDP: conexiune închisă înainte de răspuns'))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { clearTimeout(t); ws.onclose = null; res(d) } }
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    // awaitPromise: expresiile cu promisiuni (nativePromise, serviceWorker.ready) se așteaptă.
    params: { expression: process.argv[2], awaitPromise: true, returnByValue: true },
  }))
})
ws.close()
if (reply.error || reply.result?.exceptionDetails) {
  console.error(JSON.stringify(reply.error ?? reply.result.exceptionDetails))
  process.exit(1)
}
console.log(JSON.stringify(reply.result.result.value, null, 2))
