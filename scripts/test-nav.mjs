// Foaia deschisă nu are voie să urmeze userul în alt tab: `npm run test:nav`
//
// Regresia pe care o prinde: pe ecran lat, „Listă" găzduiește panoul lateral
// (`SplitView`), deci un tichet deschis stă DOCAT — arată ca o parte a paginii,
// nu ca o foaie deschisă. „Cards", „Hartă" și „Teme" nu găzduiesc panoul. La
// comutarea tabului, `dockedIssueId` devine null în timp ce stiva de foi e încă
// plină, iar `SheetHost` deschide un MODAL peste noul tab: un tichet care sare
// în față fără să-l fi cerut nimeni, și care apoi acoperă bara de taburi.
//
// De ce un browser real: starea asta trăiește în interacțiunea dintre un media
// query, `registerSplitHost` și stiva de foi. Nu există în jsdom, iar cele 403
// de unit-teste trec liniștite peste ea.
//
// Serverul de dev îl pornește scriptul, pe backendul local (fără Supabase, deci
// fără login) — la fel ca `design/preview.html`: aplicația reală, fără cont.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = 5211
const BASE = `http://localhost:${PORT}`
const failures = []

function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} — ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}

const vite = spawn(
  'npx',
  ['vite', '--port', String(PORT), '--strictPort'],
  {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, VITE_DATA_SOURCE: 'local', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite nu a pornit în 60s')), 60_000)
  vite.stdout.on('data', (d) => {
    if (d.toString().includes('Local:')) { clearTimeout(t); resolve() }
  })
  vite.on('exit', (c) => { clearTimeout(t); reject(new Error(`vite a ieșit cu ${c}`)) })
})

let browser
try {
  await ready
  browser = await chromium.launch()
  // Lat, ca „Listă" să găzduiască panoul lateral — aici trăiește regresia.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.locator('.proj').first().click()
  await page.waitForTimeout(800)
  await page.locator('.tab', { hasText: /^List/ }).first().click()
  await page.waitForTimeout(500)

  const rows = await page.locator('.list-row').count()
  if (!rows) throw new Error('proiectul demo nu are tichete — nu pot testa')

  await page.locator('.list-row').first().click()
  await page.waitForTimeout(800)

  const modalOpen = () => page.locator('.sheet.on').count().then((n) => n > 0)
  check('tichetul stă docat pe „Listă"', !(await modalOpen()), 'fără modal, cum trebuie')

  for (const tab of ['Cards', 'Hartă', 'Teme']) {
    const btn = page.locator('.tab', { hasText: new RegExp(`^${tab}`) }).first()
    const reachable = await btn.isVisible().catch(() => false)
    if (!reachable) {
      check(`tabul „${tab}" e accesibil`, false, 'acoperit de o foaie — modalul blochează bara')
      break
    }
    await btn.click({ timeout: 5000 })
    await page.waitForTimeout(700)
    check(`niciun modal după „${tab}"`, !(await modalOpen()), (await modalOpen()) ? 'a sărit un tichet în față' : 'curat')
    // Revine pe „Listă" pentru următoarea iterație.
    await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    if (await modalOpen()) break
    await page.locator('.list-row').first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await page.close()
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

if (failures.length) {
  console.error(`\n${failures.length} încălcări:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nFoaia nu urmează userul între taburi.')
