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
  // ── Scurtăturile globale trebuie să meargă cu un formular DOCAT ──────────
  // Panoul lateral nu e un modal: `ui.tsx` o spune explicit, iar `hooks.ts`
  // gating-ul listei o respectă (`modalOpen`, nu `sheet.kind`). Scurtăturile
  // globale din `App.tsx` gatingau pe prezența unei foi, deci cu un tichet
  // deschis în panou tasta C nu făcea nimic.
  await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(800)
  check('tichet docat, pregătit pentru C', !(await modalOpen()), 'fără modal')

  await page.locator('.tabs').click()
  await page.waitForTimeout(150)
  await page.keyboard.press('c')
  await page.waitForTimeout(800)
  const newFormOpen = await modalOpen()
  const firstVal = await page.locator('.sheet.on input').first().inputValue().catch(() => null)
  check('C deschide un tichet nou peste panou', newFormOpen, newFormOpen ? 'formular deschis' : 'nu s-a întâmplat nimic')
  check('formularul e GOL (tichet nou, nu cel docat)', firstVal === '', `titlu="${firstVal ?? '(niciun input)'}"`)

  // ── …dar nu aruncă în tăcere ce ai scris ────────────────────────────────
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(700)
  const docked = page.locator('.split-right input, input').first()
  const was = await docked.inputValue().catch(() => '')
  await docked.fill(`${was} MODIFICAT`)
  await page.waitForTimeout(500)
  await page.locator('.tabs').click()
  await page.waitForTimeout(150)
  await page.keyboard.press('c')
  await page.waitForTimeout(700)
  const stillThere = await page.locator('input').first().inputValue().catch(() => '')
  check(
    'C nu aruncă modificările nesalvate',
    stillThere.includes('MODIFICAT'),
    stillThere.includes('MODIFICAT') ? 'formularul murdar e încă pe ecran' : `s-a pierdut: "${stillThere}"`,
  )

  // ── „+ Tichet" din header, cu un tichet docat ───────────────────────────
  // Același drum, fără tastatură: un formular de ticket NOU n-are id, deci
  // `ticketId` devine null. Efectul de URL citea asta ca „s-a închis tot" și
  // dădea `history.back()`, iar `popstate` închidea formularul abia deschis.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(700)
  await page.locator('.header-new-btn').click()
  await page.waitForTimeout(900)
  const hdrOpen = await modalOpen()
  const hdrVal = await page.locator('.sheet.on input').first().inputValue().catch(() => null)
  check('„+ Tichet" merge cu un tichet docat', hdrOpen, hdrOpen ? 'formular deschis' : 'totul s-a închis')
  check('„+ Tichet" deschide un formular GOL', hdrVal === '', `titlu="${hdrVal ?? '(niciun input)'}"`)

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
