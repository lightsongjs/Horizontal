// Drumul de upgrade al unui client care are DEJA service worker-ul vechi instalat.
//
// De ce există: o aplicație PWA cu precache servește din memoria browserului chiar și
// online. Verificările obișnuite de deploy rulează în browsere curate, deci probează
// vizitatorul NOU — care primește oricum ultimul build. Drumul care produce reclamația
// „eu nu văd modificarea, de ce trebuie să dau refresh?" e celălalt. Prima rulare a acestui
// test, pe rețeta din docs/pwa-cloudflare-playbook.md, a găsit-o ruptă în trei locuri.
//
// Cum: nu depinde de un deploy real. Servește `dist` cu ACELEAȘI headere ca
// `public/_headers`, face build-uri succesive peste el și măsoară ce vede pagina.
//
// Rulare:  npm run test:upgrade
//
// Fișierul e scris să fie PORTABIL între aplicații: citește titlul de bază din
// `index.html` și nu presupune nimic despre rutarea aplicației. Ține-l identic în toate
// proiectele — dacă diverge, se pierde exact bugul pe care a fost scris să-l prindă.
//
// NU e în suita implicită: face patru build-uri și modifică temporar `index.html` (titlul e
// markerul de versiune). Fișierul e restaurat în `finally`; dacă întrerupi procesul cu
// forța, verifică `git status index.html`.
//
// Limită asumată: revenirea pe tab e simulată prin dispatch de `focus` +
// `visibilitychange` — exact evenimentele pe care ascultă `src/pwa.ts`. Deci contractul
// nostru e acoperit; ce NU e acoperit e dacă browserul le emite în vreo situație exotică.
import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

// `playwright` în unele proiecte, `@playwright/test` în altele.
const { chromium } = await import('playwright').catch(() => import('@playwright/test'))

const DIST = 'dist'
const INDEX_SRC = 'index.html'
const PORT = Number(process.env.UPGRADE_TEST_PORT || 4271)
// Trebuie să fie ACELAȘI număr ca `APPLY_WINDOW_MS` din src/pwa.ts. Dacă îl schimbi
// acolo, schimbă-l și aici, altfel controlul negativ de la pasul 3 devine dependent de
// viteza mașinii.
const APPLY_WINDOW_MS = 15 * 1000
const original = readFileSync(INDEX_SRC, 'utf8')
const BASE_TITLE = original.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
if (!BASE_TITLE) throw new Error(`${INDEX_SRC} nu are <title> — markerul de versiune se pune acolo`)
const failures = []

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
// Aceleași reguli ca public/_headers: shell-ul se revalidează, assets-urile sunt immutable.
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]
  let file = join(DIST, normalize(url === '/' ? '/index.html' : url))
  if (!existsSync(file) || !extname(file)) file = join(DIST, 'index.html') // fallback SPA
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
  res.setHeader(
    'Cache-Control',
    url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  )
  res.end(readFileSync(file))
})

function buildWithTitle(marker) {
  writeFileSync(
    INDEX_SRC,
    original.replace(/<title>[^<]*<\/title>/, `<title>${BASE_TITLE} ${marker}</title>`),
  )
  execSync('npm run build', { stdio: 'pipe' })
}

/**
 * Așteaptă ca pagina să se așeze. Fără asta, o aplicație care redirectează pe client (ex.
 * `/` → `/login`) e citită în timpul redirectului — Playwright raportează titlul
 * „Loading http://…" — iar evenimentul de focus pleacă spre un document care e pe punctul
 * de a fi înlocuit. De aici rezultate diferite de la o rulare la alta, deci și verde din
 * noroc. Nu presupunem nicio rută: așteptăm până când URL-ul nu se mai schimbă.
 */
async function settle(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 })
  let previous = null
  for (let i = 0; i < 20; i++) {
    const current = page.url()
    if (current === previous) break
    previous = current
    await page.waitForTimeout(400)
  }
  await page.waitForFunction(
    (base) => document.title.startsWith(base),
    BASE_TITLE,
    { timeout: 30000 },
  )
}

// `catch` deliberat: dacă mecanismul funcționează, reîncărcarea poate porni chiar în timpul
// evaluării, iar Playwright aruncă „Execution context was destroyed". Navigarea E
// rezultatul așteptat, nu o eroare — verdictul îl dau aserțiile de după, pe titlu.
const returnToTab = (page) =>
  page
    .evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    .catch(() => {})

const showsVersion = (page, marker) =>
  page.waitForFunction((m) => document.title.endsWith(m), marker, { timeout: 15000 })

try {
  console.log('1) build v1 + prima încărcare (clientul „vechi")')
  buildWithTitle('V1')
  await new Promise((r) => server.listen(PORT, r))

  const browser = await chromium.launch()
  // Context explicit: pasul 5 mai deschide un tab în ACELAȘI context (același service
  // worker). `browser.newPage()` ar crea un context implicit, care refuză al doilea tab.
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await settle(page)
  const first = await page.title()
  if (!first.endsWith('V1')) failures.push(`prima încărcare a servit „${first}", nu v1`)
  else console.log('   ✔ v1 servit, service worker instalat')

  console.log('2) build v2 (deploy simulat), apoi revenire pe tab')
  buildWithTitle('V2')
  let applied = 0
  for (let round = 1; round <= 3; round++) {
    await returnToTab(page)
    try {
      await showsVersion(page, 'V2')
      applied = round
      break
    } catch {
      console.log(`   revenirea ${round}: încă „${await page.title()}"`)
    }
  }
  // Contractul: O revenire e de ajuns. Două înseamnă că prima doar detectează — cine intră,
  // se uită și pleacă rămâne pe versiunea veche.
  if (applied === 1) console.log('   ✔ a trecut pe v2 la PRIMA revenire')
  else
    failures.push(
      applied === 0
        ? 'nu a trecut pe v2 deloc (ar cere refresh manual)'
        : `a trecut pe v2 abia la revenirea ${applied}`,
    )

  // Contractul din src/pwa.ts: aplicăm un build care devine gata în FEREASTRA de câteva
  // secunde de după revenirea pe tab. Deci controlul negativ trebuie făcut în afara
  // ferestrei — altfel rezultatul depinde de cât durează buildul pe mașina care rulează
  // testul (măsurat: pe un proiect mic pica, pe unul mare trecea, din pur noroc).
  console.log(`   (aștept ${APPLY_WINDOW_MS / 1000}s, cât fereastra de aplicare)`)
  await page.waitForTimeout(APPLY_WINDOW_MS + 1000)

  console.log('3) build v3 + verificare de tip „interval orar", FĂRĂ revenire pe tab')
  buildWithTitle('V3')
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    await r?.update().catch(() => {})
  })
  await page.waitForTimeout(4000)
  // Control negativ care NU e vacuu: buildul v3 există ȘI e instalat, deci dacă aplicarea
  // n-ar fi legată de revenirea pe tab, pagina s-ar reîncărca aici — peste cineva care
  // tocmai scrie.
  const waiting = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    return !!r?.waiting
  })
  if (!waiting) failures.push('v3 nu a ajuns în „waiting" — controlul negativ ar trece degeaba')
  if ((await page.title()).endsWith('V3')) failures.push('pagina s-a reîncărcat fără revenire pe tab')
  else console.log('   ✔ pagina a rămas pe v2, cu v3 pregătit')

  console.log('4) acum omul revine pe tab')
  await returnToTab(page)
  try {
    await showsVersion(page, 'V3')
    console.log('   ✔ a trecut pe v3')
  } catch {
    failures.push(`buildul amânat nu s-a aplicat la revenire (a rămas „${await page.title()}")`)
  }

  // ── Al doilea tab ──────────────────────────────────────────────────────────────────
  // Cine aplică buildul „consumă" workerul din `waiting`, deci celelalte taburi nu mai au
  // ce aplica și rămân pe versiunea veche cât stau deschise. Măsurat, înainte de fix: la
  // nesfârșit.
  console.log('5) al doilea tab: A aplică buildul, B trebuie să iasă și el de pe cel vechi')
  const second = await ctx.newPage()
  await second.goto(`http://localhost:${PORT}/`)
  await settle(second)
  buildWithTitle('V4')
  await page.bringToFront()
  await returnToTab(page)
  try {
    await showsVersion(page, 'V4')
  } catch {
    // Fără asta, pasul 5 ar raporta succes fără să fi pus nimic la încercare.
    failures.push('tabul A nu a preluat v4, deci cazul cu două taburi n-a fost pus la încercare')
  }
  await second.bringToFront()
  await returnToTab(second)
  try {
    await showsVersion(second, 'V4')
    console.log('   ✔ tabul B a trecut și el pe v4, la prima revenire')
  } catch {
    failures.push(`al doilea tab a rămas pe „${await second.title()}" (ar cere refresh manual)`)
  }

  await browser.close()
} finally {
  writeFileSync(INDEX_SRC, original)
  server.close()
}

if (failures.length) {
  console.error('\n✖ DRUMUL DE UPGRADE E RUPT:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\n✔ Drumul de upgrade e întreg: o revenire pe tab aduce buildul nou, fără refresh manual.')
