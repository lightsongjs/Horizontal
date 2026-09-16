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
    // `NO_COLOR` nu e cosmetic: cu culori, vite scrie „Local:" ca
    // `\e[1mLocal\e[22m:`, iar potrivirea de mai jos nu mai vede niciodată
    // portul gata — testul cădea cu „vite nu a pornit în 60s" deși pornise.
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      VITE_DATA_SOURCE: 'local',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite nu a pornit în 60s')), 60_000)
  vite.stdout.on('data', (d) => {
    // Și, ca plasă peste `NO_COLOR`: portul din URL e cel care contează.
    if (d.toString().includes(`localhost:${PORT}`)) { clearTimeout(t); resolve() }
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

  // ── Reîncărcarea nu are voie să golească ecranul ────────────────────────
  // `refresh()` ridica `loading`, iar `loading` înlocuia tot `<main>` cu „Se
  // încarcă…”. Vizualizarea se demonta, `SplitView` ieșea din arbore, cleanup-ul
  // lui `registerSplitHost` ducea `dockedIssueId` la null și tichetul docat
  // clipea ca MODAL peste listă — la fiecare revenire în tab. Un `waitForTimeout`
  // n-ar prinde asta (poate dura un singur cadru), de-aia observatorul se pune
  // ÎNAINTE de click și raportează dacă modalul a existat vreodată.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(800)
  check('tichet docat, pregătit de reîncărcare', !(await modalOpen()), 'fără modal')

  await page.evaluate(() => {
    window.__flash = { modal: false, blank: false }
    const look = () => {
      // Se urmărește DISPARIȚIA panoului, nu apariția modalului: `.sheet` e
      // mereu în DOM (o face `.on` vizibilă), iar pe backendul local cele două
      // randări intermediare se pot comprima destul cât `.on` să nu apuce să se
      // pună. Cauza, însă, se vede întreagă: dacă `.split-pane` a lipsit măcar
      // o randare, `registerSplitHost` s-a desfăcut — și cu latența reală a lui
      // Supabase exact acolo sare modalul.
      if (!document.querySelector('.split-pane')) window.__flash.modal = true
      const main = document.querySelector('main')
      if (main && main.textContent.includes('Se încarcă')) window.__flash.blank = true
    }
    window.__flashObserver = new MutationObserver(look)
    window.__flashObserver.observe(document.body, { childList: true, subtree: true })
    look()
  })
  await page.locator('.header-refresh-btn').click()
  await page.waitForTimeout(1500)
  const flash = await page.evaluate(() => {
    window.__flashObserver.disconnect()
    return window.__flash
  })
  check('reîncărcarea nu golește ecranul', !flash.blank, flash.blank ? 'a apărut „Se încarcă…" peste listă' : 'lista a rămas pe ecran')
  check('reîncărcarea nu scoate tichetul din panou', !flash.modal, flash.modal ? 'panoul lateral a dispărut — de aici clipește modalul' : 'a rămas docat')

  // ── C într-o listă inteligentă ──────────────────────────────────────────
  // „Azi"/„Mâine" n-au proiect activ (se alege abia când deschizi o sarcină),
  // iar C era condiționat de `project` — deci nu făcea nimic. Acolo „creează"
  // înseamnă quick add, cu selectorul lui de proiect: fără Inbox, fiecare
  // sarcină are un proiect.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const azi = page.locator('.tabbar button, .sidebar-smart-item, .sidebar button').filter({ hasText: /^Azi/ }).first()
  await azi.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(800)
  const onSmart = await page.locator('.qa-input').count()
  check('am ajuns pe „Azi"', onSmart > 0, onSmart > 0 ? 'quick add prezent' : 'nu am găsit lista')
  if (onSmart > 0) {
    await page.locator('h1').first().click().catch(() => {})
    await page.waitForTimeout(200)
    await page.keyboard.press('c')
    await page.waitForTimeout(600)
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('qa-input') ?? false)
    check('C focusează quick add pe „Azi"', focused, focused ? 'cursorul e în câmp' : 'nu s-a întâmplat nimic')
  }

  // ── O sarcină deschisă din „Azi" nu te mută pe boardul proiectului ──────
  // Un URL de tichet (/EX-06) nu spune pe ce ecran era deschis cardul. Ramura
  // de tichet din efectul de boot presupunea „proiect" și nu citea deloc
  // `LAST_VIEW_KEY`, deci o repornire cu cardul deschis ateriza pe boardul
  // proiectului, iar ștergerea ducea mai departe, pe ultimul proiect folosit.
  //
  // Repornirea nu e ipotetică: `src/pwa.ts` aplică un build nou la revenirea în
  // tab, iar `updateSW(true)` reîncarcă pagina — exact peste un card deschis.
  //
  // Filă NOUĂ, deliberat: istoricul de până aici e plin de tichete vizitate de
  // testele de mai sus, iar `history.back()` de la închiderea unei foi ar
  // ateriza pe unul dintre ele. Scenariul ăsta e despre o sesiune obișnuită —
  // intri pe „Azi", deschizi o sarcină, se reîncarcă — deci pornește curat.
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await fresh.goto(BASE, { waitUntil: 'networkidle' })
  await fresh.waitForTimeout(700)
  await fresh.locator('.tabbar button, .sidebar-smart-item, .sidebar button')
    .filter({ hasText: /^Azi/ }).locator('visible=true').first()
    .click()
  await fresh.waitForTimeout(800)
  const qa = fresh.locator('.qa-input').first()
  await qa.fill('Sarcină de probă pentru repornire')
  await fresh.keyboard.press('Enter')
  await fresh.waitForTimeout(1200)
  const taskRows = await fresh.locator('.task-row').count()
  check('quick add a creat sarcina', taskRows > 0, taskRows > 0 ? `${taskRows} în listă` : 'lista e goală')
  if (taskRows > 0) {
    await fresh.locator('.task-row').first().click()
    await fresh.waitForTimeout(1200)
    const ticketUrl = new URL(fresh.url()).pathname
    check('cardul deschis ține URL de tichet', /^\/[A-Z]+-\d+$/.test(ticketUrl), `URL=${ticketUrl}`)

    await fresh.reload({ waitUntil: 'networkidle' })
    await fresh.waitForTimeout(1600)
    const stillOnList = (await fresh.locator('.qa-input').count()) > 0
    check(
      'repornirea cu cardul deschis rămâne pe „Azi"',
      stillOnList,
      stillOnList ? 'lista e pe ecran' : `a sărit pe „${await fresh.locator('h1').first().textContent()}"`,
    )

    const del = fresh.locator('.sh-delete').first()
    await del.click()
    await fresh.waitForTimeout(300)
    await del.click()
    await fresh.waitForTimeout(1800)
    const afterDelete = (await fresh.locator('.qa-input').count()) > 0
    check(
      'ștergerea sarcinii rămâne pe „Azi"',
      afterDelete,
      afterDelete ? 'lista e pe ecran' : `a sărit pe „${await fresh.locator('h1').first().textContent()}"`,
    )
    const urlAfter = new URL(fresh.url()).pathname
    check('URL-ul nu minte după ștergere', urlAfter === '/', `URL=${urlAfter}`)
  }

  await fresh.close()

  // ── Ștergerea nu redeschide tichetul vizitat înainte ────────────────────
  // La închiderea unei foi se dădea `history.back()`, ca să se desfacă
  // intrarea împinsă la deschidere. Dar `back()` merge orbește: presupune că
  // intrarea din spate e ecranul pe care erai. Dacă în spate stă alt tichet,
  // `popstate` își face datoria — vede un URL de tichet și îl deschide. Ștergi
  // o sarcină din „Azi" și îți sare în panou un tichet din alt proiect.
  const stale = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await stale.goto(BASE, { waitUntil: 'networkidle' })
  await stale.waitForTimeout(700)
  await stale.locator('.proj').first().click()
  await stale.waitForTimeout(900)
  await stale.locator('.tab', { hasText: /^List/ }).first().click()
  await stale.waitForTimeout(500)
  await stale.locator('.list-row').first().click()
  await stale.waitForTimeout(900)
  const oldTicket = new URL(stale.url()).pathname
  check('un tichet vechi e deschis', /^\/[A-Z]+-\d+$/.test(oldTicket), `URL=${oldTicket}`)

  await stale.locator('.tabbar button, .sidebar-smart-item, .sidebar button')
    .filter({ hasText: /^Azi/ }).locator('visible=true').first()
    .click()
  await stale.waitForTimeout(800)
  await stale.locator('.qa-input').first().fill('test')
  await stale.keyboard.press('Enter')
  await stale.waitForTimeout(1200)
  await stale.locator('.task-row').first().click()
  await stale.waitForTimeout(1200)
  const staleDel = stale.locator('.sh-delete').first()
  await staleDel.click()
  await stale.waitForTimeout(300)
  await staleDel.click()
  await stale.waitForTimeout(1800)
  const reopened = await stale.locator('.split-pane input').first().inputValue().catch(() => null)
  check(
    'ștergerea nu redeschide tichetul vechi',
    reopened === null,
    reopened === null ? 'panoul e gol' : `a sărit „${reopened}" în panou`,
  )
  const staleUrl = new URL(stale.url()).pathname
  check('URL-ul nu rămâne pe tichetul vechi', staleUrl !== oldTicket, `URL=${staleUrl}`)
  await stale.close()

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
