// Decizia „notificarea tace sau nu" — drumul pe care s-a produs o regresie reală.
//
// De ce există: o primă versiune făcea notificarea `silent` de îndată ce exista o
// filă vizibilă, presupunând că pagina poate cânta. Când nu putea — un refresh
// fără niciun click e de ajuns, politica de autoplay lasă contextul audio
// nedeblocat — nu se auzea NIMIC. Regresia a înlocuit un sunet garantat (al
// sistemului) cu unul posibil, și s-a văzut exact o dată, la ora mementoului.
//
// Ce se măsoară: `src/sw.ts` citește anunțul lăsat de pagină în `Cache` și abia
// un anunț prezent cumpără liniștea. Fila primește `reminder-arrived` EXACT când
// notificarea a plecat mută — aceeași condiție, `sing` — deci prezența acelui
// mesaj e observabilă din pagină și e proba deciziei.
//
// De ce NU se măsoară un dialog întrebare-răspuns: nu poate exista. Cât timp
// promisiunea dată lui `waitUntil` din `push` e în așteptare, workerul nu
// primește evenimente `message` — dovedit aici, cu pagina care răspundea și un
// termen ridicat la trei secunde. De asta pagina anunță din timp.
//
// Rulare:  npm run test:chime
//
// Cum se produce cazul negativ, fiindcă e neevident: NU prin politica de
// autoplay a browserului (`--autoplay-policy=user-gesture-required` s-a dovedit
// fără efect în Chromium headless — un `AudioContext` proaspăt pornește
// `running` oricum). Ci prin invariantul nostru: `chimeReady()` cere
// `ctx !== null`, iar contextul se creează DOAR în `unlockChime()`, adică doar
// din gestul utilizatorului. O pagină în care nimeni n-a apăsat nimic nu poate
// cânta, indiferent ce permite browserul.
//
// CE NU E ACOPERIT, ca să nu pară că e: ramura „nicio filă vizibilă". În
// Chromium headless toate paginile raportează `visible`, iar cu pagina închisă
// nu mai există de unde observa. Acea ramură rămâne verificată manual.
import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const { chromium } = await import('playwright').catch(() => import('@playwright/test'))

// Build PROPRIU, în alt director: `dist` e artefactul de deploy, iar buildul de
// aici e deliberat stricat pentru scopul testului (fără chei Supabase), ca
// `Shell` să se monteze fără autentificare — altfel se randează `<Login />`,
// ascultătorul de mesaje din `App.tsx` nu există, nimeni nu răspunde la sondaj,
// iar testul ar trece pentru motivul greșit. Prima versiune a acestui fișier a
// făcut exact greșeala asta.
const OUT = 'dist-chime-test'
const PORT = Number(process.env.CHIME_TEST_PORT || 4272)
const ORIGIN = `http://localhost:${PORT}`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]
  let file = join(OUT, normalize(url === '/' ? '/index.html' : url))
  if (!existsSync(file) || !extname(file)) file = join(OUT, 'index.html')
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.end(readFileSync(file))
})

let failures = 0
const ok = (m) => console.log(`   ✔ ${m}`)
const bad = (m) => { failures++; console.log(`   ✘ ${m}`) }

console.log(`build de test în ${OUT}/ (fără chei Supabase, ca să nu ceară login)…`)
execSync(`npx vite build --outDir ${OUT}`, {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_DATA_SOURCE: 'local' },
})

await new Promise((r) => server.listen(PORT, r))
const browser = await chromium.launch()
const ctx = await browser.newContext()
// PE ORIGINE, explicit. `newContext({ permissions })` nu e de ajuns: fără
// origine, `showNotification` aruncă „No notification permission has been
// granted for this origin", iar cum `postMessage` către pagină vine DUPĂ el, nu
// se mai execută — și testul raportează „nu s-a cântat" pentru toate cazurile,
// inclusiv cele negative, care astfel trec degeaba. A pierdut o oră.
await ctx.grantPermissions(['notifications'], { origin: ORIGIN })

try {
  const page = await ctx.newPage()
  await page.goto(ORIGIN)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })

  // Fără asta, tot ce urmează măsoară un ecran de login. Verificarea e explicită
  // fiindcă e exact modul în care testul poate minți.
  const body = await page.evaluate(() => document.body.innerText)
  if (/Autentifică-te/.test(body)) throw new Error('se randează <Login /> — Shell nu e montat, testul n-ar măsura nimic')
  ok('aplicația e montată (nu ecranul de login), deci ascultătorul din App.tsx există')

  // Spionul: un al DOILEA ascultător, care doar notează. Cel din `App.tsx`
  // rămâne cel care RĂSPUNDE — altfel n-am testa codul aplicației, ci spionul.
  await page.evaluate(() => {
    window.__seen = { arrived: 0 }
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'reminder-arrived') window.__seen.arrived++
    })
  })

  const cdp = await ctx.newCDPSession(page)
  let registrationId = null
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    for (const r of e.registrations ?? []) {
      if (r.scopeURL.startsWith(ORIGIN) && !r.isDeleted) registrationId = r.registrationId
    }
  })
  await cdp.send('ServiceWorker.enable')
  for (let i = 0; i < 50 && !registrationId; i++) await page.waitForTimeout(100)
  if (!registrationId) throw new Error('nu am obținut registrationId — CDP ServiceWorker.enable a eșuat')

  const push = async (id) => {
    const before = await page.evaluate(() => ({ ...window.__seen }))
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: ORIGIN,
      registrationId,
      data: JSON.stringify({ id, title: 'Test', dueAt: null, allDay: true, projectName: 'P' }),
    })
    await page.waitForTimeout(900)
    const after = await page.evaluate(() => ({ ...window.__seen }))
    return { probe: after.probe - before.probe, arrived: after.arrived - before.arrived }
  }

  console.log('1) filă vizibilă, dar NIMENI n-a apăsat nimic — sunetul trebuie să rămână al sistemului')
  const cold = await push('EX-COLD')
  if (cold.arrived === 0) ok('pagina NU a fost pusă să cânte, deci notificarea a sunat normal')
  else bad('pagina pusă să cânte fără audio deblocat — exact regresia: notificare mută, zero sunet')

  console.log('2) după un click în pagină (deblochează audio) — sunetul trebuie să fie al nostru')
  await page.mouse.click(5, 5)
  await page.waitForTimeout(300)   // anunțul se scrie în Cache, e asincron
  const warm = await push('EX-WARM')
  if (warm.arrived > 0) ok('pagina a primit sunetul, deci notificarea a plecat mută')
  else bad('audio e deblocat, dar pagina nu a fost pusă să cânte — clopoțelul nu se aude niciodată')

  console.log('3) reîncărcare fără niciun click — anunțul vechi NU are voie să supraviețuiască')
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })
  await page.evaluate(() => {
    window.__seen = { arrived: 0 }
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'reminder-arrived') window.__seen.arrived++
    })
  })
  const reloaded = await push('EX-RELOAD')
  if (reloaded.arrived === 0) ok('anunțul a fost șters la pornire — notificarea sună, cum trebuie')
  else bad('anunțul a supraviețuit reîncărcării: notificare mută pe o pagină care nu poate cânta')
} finally {
  await browser.close()
  server.close()
  rmSync(OUT, { recursive: true, force: true })
}

console.log()
if (failures) {
  console.log(`✘ ${failures} verificări au picat: decizia „tace sau nu" e ruptă.`)
  process.exit(1)
}
console.log('✔ Notificarea tace NUMAI când pagina a confirmat că poate cânta.')
