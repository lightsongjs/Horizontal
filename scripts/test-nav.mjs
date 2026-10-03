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
import { touchApi } from './lib-touch.mjs'

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
  // O pornire proaspătă aterizează pe „Azi" (vezi `SESSION_KEY` din App.tsx),
  // deci lista de proiecte se cere explicit înainte de tot restul testului.
  const bootScreen = await page.locator('.sidebar-nav-item.on').first().textContent()
  check('pornirea aterizează pe „Azi"', /Azi/.test(bootScreen ?? ''), `ecran=${(bootScreen ?? '').trim()}`)
  await page.locator('.sidebar-nav-item', { hasText: 'Toate proiectele' }).first().click()
  await page.waitForTimeout(600)
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
  const firstVal = await page.locator('.sheet.on .sh-title-input').first().inputValue().catch(() => null)
  check('C deschide un tichet nou peste panou', newFormOpen, newFormOpen ? 'formular deschis' : 'nu s-a întâmplat nimic')
  check('formularul e GOL (tichet nou, nu cel docat)', firstVal === '', `titlu="${firstVal ?? '(niciun input)'}"`)

  // ── …dar nu aruncă în tăcere ce ai scris ────────────────────────────────
  // Selectorul e `.sh-title-input`, nu `input`: titlul e un `<textarea>` (se
  // rupe pe rânduri). Un `input` generic ar fi prins alt câmp din formular
  // și ar fi raportat pierderea modificărilor care de fapt nu s-a întâmplat.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(700)
  const docked = page.locator('.sh-title-input').first()
  const was = await docked.inputValue().catch(() => '')
  await docked.fill(`${was} MODIFICAT`)
  await page.waitForTimeout(500)
  await page.locator('.tabs').click()
  await page.waitForTimeout(150)
  await page.keyboard.press('c')
  await page.waitForTimeout(700)
  const stillThere = await page.locator('.sh-title-input').first().inputValue().catch(() => '')
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
  const hdrVal = await page.locator('.sheet.on .sh-title-input').first().inputValue().catch(() => null)
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

  // ── Proiectul sarcinii se deschide din sidebar la PRIMUL click ──────────
  // O sarcină deschisă din „Azi" încarcă proiectul ei în store, sub listă. O
  // repornire peste card face ca închiderea să NU treacă prin `back()` →
  // `popstate` → `selectProject(null)` (în spate nu e nimic al nostru), deci
  // proiectul rămâne încărcat. Un click pe ACELAȘI proiect în sidebar chema
  // `selectProject(null)` și `selectProject(id)` în același tick, iar garda
  // „reselectare fără efect" citea `projectId` din clojură — încă proiectul,
  // deci al doilea apel era ignorat și rămâneai pe „Toate proiectele".
  const same = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await same.goto(BASE, { waitUntil: 'networkidle' })
  await same.waitForTimeout(700)
  await same.locator('.tabbar button, .sidebar-smart-item, .sidebar button')
    .filter({ hasText: /^Azi/ }).locator('visible=true').first()
    .click()
  await same.waitForTimeout(800)
  await same.locator('.qa-input').first().fill('Sarcină pentru click în sidebar')
  await same.keyboard.press('Enter')
  await same.waitForTimeout(1200)
  await same.locator('.task-row').first().click()
  await same.waitForTimeout(1200)
  await same.reload({ waitUntil: 'networkidle' })
  await same.waitForTimeout(1600)
  // Panoul docat nu e modal, deci Escape nu-l închide: butonul, ca un om.
  await same.locator('.sh-close').first().click()
  await same.waitForTimeout(800)
  const closedUrl = new URL(same.url()).pathname
  check('închiderea cardului lasă URL-ul pe listă', closedUrl === '/', `URL=${closedUrl}`)
  const loadedProj = same.locator('.sidebar-proj-item.on .sidebar-proj-btn').first()
  const loadedName = (await loadedProj.locator('.sidebar-proj-name').textContent().catch(() => null))?.trim() ?? null
  check('proiectul sarcinii e încărcat sub listă', loadedName !== null, `proiect=${loadedName}`)
  if (loadedName) {
    await loadedProj.click()
    await same.waitForTimeout(900)
    const sameUrl = new URL(same.url()).pathname
    const sameH1 = (await same.locator('h1').first().textContent().catch(() => ''))?.trim()
    check(
      'primul click în sidebar deschide proiectul sarcinii',
      sameUrl.startsWith('/project/'),
      `URL=${sameUrl} h1="${sameH1}"`,
    )
  }
  await same.close()

  // ── Ștergerea nu redeschide tichetul vizitat înainte ────────────────────
  // La închiderea unei foi se dădea `history.back()`, ca să se desfacă
  // intrarea împinsă la deschidere. Dar `back()` merge orbește: presupune că
  // intrarea din spate e ecranul pe care erai. Dacă în spate stă alt tichet,
  // `popstate` își face datoria — vede un URL de tichet și îl deschide. Ștergi
  // o sarcină din „Azi" și îți sare în panou un tichet din alt proiect.
  const stale = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await stale.goto(BASE, { waitUntil: 'networkidle' })
  await stale.waitForTimeout(700)
  // Idem: pornirea e pe „Azi", deci lista de proiecte se cere.
  await stale.locator('.sidebar-nav-item', { hasText: 'Toate proiectele' }).first().click()
  await stale.waitForTimeout(600)
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
  const reopened = await stale.locator('.split-pane .sh-title-input').first().inputValue().catch(() => null)
  check(
    'ștergerea nu redeschide tichetul vechi',
    reopened === null,
    reopened === null ? 'panoul e gol' : `a sărit „${reopened}" în panou`,
  )
  const staleUrl = new URL(stale.url()).pathname
  check('URL-ul nu rămâne pe tichetul vechi', staleUrl !== oldTicket, `URL=${staleUrl}`)
  await stale.close()

  // ── „Ale mele" supraviețuiește unei reporniri, ca „Azi" ──────────────────
  // Al patrulea tab NU e un `SmartListKind` (vezi `Screen` din App.tsx), deci
  // are propriul drum prin `parseLastView`/`LAST_VIEW_KEY` — ăsta e testul care
  // verifică drumul ăla, nu doar clickul. Viewport de telefon, deliberat: bara
  // de jos (`.tabbar`) e ascunsă peste 899px, iar `data-tab` trăiește acolo.
  // Filă curată: istoricul celorlalte teste ar falsifica un `back()`.
  const inbox = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await inbox.goto(BASE, { waitUntil: 'networkidle' })
  await inbox.waitForTimeout(700)
  await inbox.click('[data-tab="inbox"]')
  await inbox.waitForTimeout(500)
  const inboxTabOn = (await inbox.locator('.tabbar button.on').textContent()) ?? ''
  check('„Ale mele" se activează la click', /Ale mele/.test(inboxTabOn), `tab activ="${inboxTabOn}"`)

  await inbox.reload({ waitUntil: 'networkidle' })
  await inbox.waitForTimeout(1200)
  const inboxTabAfterReload = (await inbox.locator('.tabbar button.on').textContent()) ?? ''
  check(
    '„Ale mele" supraviețuiește unei reporniri',
    /Ale mele/.test(inboxTabAfterReload),
    `tab activ="${inboxTabAfterReload}"`,
  )
  await inbox.close()

  // ── O pasă din panoul lateral nu mută foaia pe alt ecran ────────────────
  // Firul (`Thread.tsx`) poate paza un tichet chiar din formularul docat. O
  // pasă e o scriere, nu o navigare: „către Nimănui" (handoff cu `to: null`,
  // „iau tichetul înapoi la creator") e suficient ca să numere ca pasă — nu
  // are nevoie de niciun assignee seedat. Tab-ul și URL-ul trebuie să rămână
  // neschimbate după ea.
  const pass = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await pass.goto(BASE, { waitUntil: 'networkidle' })
  await pass.waitForTimeout(700)
  await pass.locator('.sidebar-nav-item', { hasText: 'Toate proiectele' }).first().click()
  await pass.waitForTimeout(600)
  await pass.locator('.proj').first().click()
  await pass.waitForTimeout(900)
  await pass.locator('.tab', { hasText: /^List/ }).first().click()
  await pass.waitForTimeout(500)
  await pass.locator('.list-row').first().click()
  await pass.waitForTimeout(900)
  const screenBeforePass = await pass.locator('h1').first().textContent().catch(() => null)
  const urlBeforePass = new URL(pass.url()).pathname

  await pass.locator('.thread-to-btn').click()
  await pass.waitForTimeout(200)
  await pass.locator('.dep-dd-item', { hasText: 'Nimănui' }).click()
  await pass.waitForTimeout(200)
  await pass.locator('.thread-send-btn').click()
  await pass.waitForTimeout(900)

  const screenAfterPass = await pass.locator('h1').first().textContent().catch(() => null)
  const urlAfterPass = new URL(pass.url()).pathname
  check(
    'pasa din panoul lateral nu schimbă ecranul',
    screenAfterPass === screenBeforePass,
    `înainte="${screenBeforePass}" după="${screenAfterPass}"`,
  )
  check(
    'pasa din panoul lateral nu schimbă URL-ul',
    urlAfterPass === urlBeforePass,
    `înainte=${urlBeforePass} după=${urlAfterPass}`,
  )
  await pass.close()

  // ── Foaia rapidă de pe telefon (FAB) ────────────────────────────────────
  // Sub 900px FAB-ul deschide NUMAI foaia rapidă, cu focusul dat chiar în
  // handlerul atingerii (altfel telefonul nu ridică tastatura). Enter creează
  // sarcina și închide foaia; Back o închide fără să părăsească ecranul; o
  // închidere pe fundal nu lasă în istoric o intrare moartă. Într-un proiect,
  // tichetul nu primește scadența implicită a listei. Filă curată, ca un
  // `back()` să nu aterizeze pe tichetele testelor de mai sus.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.goto(BASE, { waitUntil: 'networkidle' })
  await phone.waitForTimeout(800)
  const sheetOpen = () => phone.locator('.quick-sheet').count().then((n) => n > 0)
  const onAzi = async () => /Azi/.test((await phone.locator('.tabbar button.on').textContent().catch(() => '')) ?? '')
  check('telefon: fără rând de captură în listă', (await phone.locator('.smart-list .qa').count()) === 0, 'captura e foaia din FAB')

  await phone.locator('.fab').click()
  await phone.waitForTimeout(400)
  const focusInTitle = await phone.evaluate(() => !!document.activeElement?.closest('.quick-sheet') && document.activeElement.classList.contains('qa-input'))
  check('FAB pe „Azi" deschide foaia rapidă', await sheetOpen(), (await sheetOpen()) ? 'foaie deschisă' : 'nu s-a deschis nimic')
  check('focusul e în titlul foii', focusInTitle, focusInTitle ? 'cursorul e în titlu' : `activ=${await phone.evaluate(() => document.activeElement?.className)}`)
  const marked = await phone.evaluate(() => history.state?.hzSheet === 'quick')
  check('foaia are intrare în istoric', marked, `state=${JSON.stringify(await phone.evaluate(() => history.state))}`)

  await phone.keyboard.type('Sarcină din foaia rapidă')
  await phone.keyboard.press('Enter')
  await phone.waitForTimeout(1200)
  const rowsAfter = await phone.locator('.task-row').allInnerTexts()
  check('Enter creează sarcina în „Azi"', rowsAfter.some((r) => r.includes('Sarcină din foaia rapidă')), `${rowsAfter.length} rânduri`)
  check('după trimitere foaia se închide', !(await sheetOpen()), (await sheetOpen()) ? 'a rămas deschisă' : 'închisă')
  check('după trimitere rămâi pe „Azi"', await onAzi(), `URL=${new URL(phone.url()).pathname}`)
  const toastTxt = (await phone.locator('.toast').textContent().catch(() => '')) ?? ''
  check('confirmarea vine în Toast', /Adăugat/.test(toastTxt), `toast="${toastTxt.trim()}"`)
  check('trimiterea desface intrarea foii', !(await phone.evaluate(() => history.state?.hzSheet)), `state=${JSON.stringify(await phone.evaluate(() => history.state))}`)

  await phone.locator('.fab').click()
  await phone.waitForTimeout(400)
  await phone.keyboard.type('nu se salvează')
  await phone.goBack()
  await phone.waitForTimeout(600)
  check('Back închide foaia', !(await sheetOpen()), (await sheetOpen()) ? 'a rămas deschisă' : 'închisă')
  check('Back lasă ecranul pe „Azi"', (await onAzi()) && new URL(phone.url()).pathname === '/', `URL=${new URL(phone.url()).pathname}`)
  const notSaved = !(await phone.locator('.task-row').allInnerTexts()).some((r) => r.includes('nu se salvează'))
  check('Back nu salvează', notSaved, notSaved ? 'nimic nou' : 'a creat sarcina')

  await phone.locator('.fab').click()
  await phone.waitForTimeout(400)
  const lenOpen = await phone.evaluate(() => history.length)
  await phone.mouse.click(195, 60) // fundalul estompat, deasupra foii
  await phone.waitForTimeout(600)
  check('atingerea fundalului închide foaia', !(await sheetOpen()), (await sheetOpen()) ? 'a rămas deschisă' : 'închisă')
  const afterBg = await phone.evaluate(() => ({ marked: history.state?.hzSheet ?? null, path: location.pathname }))
  check('închiderea pe fundal nu lasă intrare moartă', afterBg.marked === null && afterBg.path === '/', `${JSON.stringify(afterBg)}, history.length=${lenOpen}`)
  check('…și rămâi pe „Azi"', await onAzi(), 'ecranul nu s-a schimbat')

  // Proiect: tichet fără scadență.
  await phone.locator('.tabbar button', { hasText: 'Proiecte' }).click()
  await phone.waitForTimeout(600)
  await phone.locator('.proj').first().click()
  await phone.waitForTimeout(900)
  await phone.locator('.fab').click()
  await phone.waitForTimeout(400)
  check('FAB într-un proiect deschide foaia rapidă', await sheetOpen(), 'foaie')
  const dueTxt = (await phone.locator('.qs-due').textContent().catch(() => '')) ?? ''
  check('în proiect jetonul spune „Fără dată"', /Fără dată/.test(dueTxt), `jeton="${dueTxt.trim()}"`)
  await phone.keyboard.type('Tichet din foaia rapidă')
  await phone.keyboard.press('Enter')
  await phone.waitForTimeout(1200)
  check('foaia din proiect se închide după trimitere', !(await sheetOpen()), 'închisă')
  await phone.locator('.tab', { hasText: /^List/ }).first().click().catch(() => {})
  await phone.waitForTimeout(600)
  const row = phone.locator('.list-row', { hasText: 'Tichet din foaia rapidă' }).first()
  const rowFound = (await row.count()) > 0
  check('tichetul din foaie apare în „Listă"', rowFound, rowFound ? 'găsit' : 'lipsește')
  if (rowFound) {
    const dueChips = await row.locator('.due-chip').count()
    check('tichetul de proiect n-are scadență', dueChips === 0, dueChips ? 'are jeton de scadență' : 'fără scadență')
  }
  await phone.close()

  // ── Foaia de tichet de pe telefon (un tichet existent) ──────────────────
  // Sub 900px, atingerea unei sarcini deschide aceeași foaie ca adăugarea
  // rapidă, nu formularul complet — fără focus (deschizi ca să citești).
  // N-are buton de salvare: descrierea pleacă după pauză, iar reîncărcarea o
  // dovedește. Back o închide și te lasă pe „Azi"; „…" deschide formularul
  // complet pe ACELAȘI tichet, iar Back îl închide tot pe „Azi". Filă curată.
  const tel = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await tel.goto(BASE, { waitUntil: 'networkidle' })
  await tel.waitForTimeout(800)
  const editOpen = () => tel.locator('.edit-sheet').count().then((n) => n > 0)
  const telOnAzi = async () => /Azi/.test((await tel.locator('.tabbar button.on').textContent().catch(() => '')) ?? '')
  await tel.locator('.fab').click()
  await tel.waitForTimeout(400)
  await tel.keyboard.type('Sarcină pentru foaia de tichet')
  await tel.keyboard.press('Enter')
  await tel.waitForTimeout(1000)
  const openTask = async () => {
    await tel.locator('.task-row', { hasText: 'Sarcină pentru foaia de tichet' }).first().click()
    await tel.waitForTimeout(900)
  }
  await openTask()
  check('telefon: atingerea sarcinii deschide foaia de tichet', await editOpen(), (await editOpen()) ? 'foaie deschisă' : 'nu s-a deschis')
  check('…nu formularul complet', (await tel.locator('.sheet.on').count()) === 0, 'fără `.sheet.on`')
  const editFocus = await tel.evaluate(() => !!document.activeElement?.closest('.edit-sheet'))
  check('foaia de tichet nu ia focusul (fără tastatură)', !editFocus, editFocus ? `activ=${await tel.evaluate(() => document.activeElement?.className)}` : 'focusul e în afara foii')
  const editUrl = new URL(tel.url()).pathname
  check('foaia de tichet ține URL de tichet', /^\/[A-Z]+-\d+$/.test(editUrl), `URL=${editUrl}`)

  await tel.goBack()
  await tel.waitForTimeout(600)
  check('Back închide foaia de tichet', !(await editOpen()), (await editOpen()) ? 'a rămas deschisă' : 'închisă')
  check('Back lasă ecranul pe „Azi"', (await telOnAzi()) && new URL(tel.url()).pathname === '/', `URL=${new URL(tel.url()).pathname}`)

  await openTask()
  await tel.locator('.edit-sheet .qa-desc').fill('Descriere salvată singură')
  await tel.waitForTimeout(1300) // peste pauza de 800ms
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  // Reîncărcată peste foaie, aplicația o redeschide din URL (deep link) — tot
  // foaia de tichet, nu formularul.
  const reDesc = await tel.locator('.edit-sheet .qa-desc').inputValue().catch(() => null)
  check('descrierea s-a salvat după pauză (verificat prin reîncărcare)', reDesc === 'Descriere salvată singură', JSON.stringify(reDesc))
  check('deep link pe telefon → foaia de tichet', await editOpen(), (await editOpen()) ? 'foaie' : 'altceva')
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(600)
  check('Esc închide foaia și rămâi pe „Azi"', !(await editOpen()) && (await telOnAzi()), `URL=${new URL(tel.url()).pathname}`)

  await openTask()
  const titleBefore = await tel.locator('.edit-sheet .es-title').inputValue()
  await tel.locator('.edit-sheet .qs-more').click()
  await tel.waitForTimeout(900)
  const fullTitle = await tel.locator('.sheet.on .sh-title-input').first().inputValue().catch(() => null)
  check('„…" deschide formularul complet pe același tichet', fullTitle === titleBefore, `titlu="${fullTitle}"`)
  check('…și foaia scurtă dispare', !(await editOpen()), 'închisă')
  check('„…" nu schimbă URL-ul tichetului', new URL(tel.url()).pathname !== '/', `URL=${new URL(tel.url()).pathname}`)
  await tel.goBack()
  await tel.waitForTimeout(700)
  check('Back închide formularul complet', (await tel.locator('.sheet.on').count()) === 0, 'închis')
  check('…și rămâi pe „Azi"', (await telOnAzi()) && new URL(tel.url()).pathname === '/', `URL=${new URL(tel.url()).pathname}`)

  // ── Data din titlul foii de tichet ──────────────────────────────────────
  // Sarcina are scadență (azi, toată ziua, din „Azi"). „… la 17" scris în
  // titlu se evidențiază, iar jetonul arată dinainte rezultatul; abia blurul
  // aplică: titlul pierde fragmentul, scadența rămâne AZI, cu ora 17:00 —
  // fără rostogolirea „ora a trecut → mâine" a adăugării rapide. O atingere
  // pe fragment îl refuză: textul rămâne în titlu, scadența nu se mișcă.
  const TITLE = 'Sarcină pentru foaia de tichet'
  const dueText = () => tel.locator('.edit-sheet .qs-due').textContent()
  const typeAtEnd = async (txt) => {
    await tel.locator('.edit-sheet .es-title').focus()
    await tel.evaluate(() => { const el = document.querySelector('.edit-sheet .es-title'); el.setSelectionRange(el.value.length, el.value.length) })
    await tel.keyboard.type(txt)
  }
  await openTask()
  const dayBefore = (await dueText())?.trim()
  await typeAtEnd(' la 17')
  await tel.waitForTimeout(300)
  const mark = await tel.locator('.edit-sheet .es-title-mirror mark').first().textContent().catch(() => null)
  check('titlu: „la 17" evidențiat în foaia de tichet', mark === 'la 17', `mark=${JSON.stringify(mark)}`)
  const pend = await tel.locator('.edit-sheet .qs-due.pending').count()
  check('jetonul arată dinainte 17:00', pend === 1 && /17:00/.test((await dueText()) ?? ''), `jeton="${await dueText()}"`)
  await tel.waitForTimeout(1300) // peste pauza de 800ms: titlul NU pleacă cât e evidențiată data
  check('…și pauza nu aplică data', (await tel.locator('.edit-sheet .es-title').inputValue()).endsWith('la 17'), 'titlul încă are „la 17"')
  await tel.locator('.edit-sheet .qa-desc').focus() // blur pe titlu
  await tel.waitForTimeout(600)
  const tAfter = await tel.locator('.edit-sheet .es-title').inputValue()
  check('după blur titlul e fără fragment', tAfter === TITLE, JSON.stringify(tAfter))
  const dAfter = (await dueText()) ?? ''
  check('…și scadența: aceeași zi, la 17:00', dAfter.includes('17:00') && dAfter.replace('17:00', '').trim() === dayBefore, `înainte="${dayBefore}", după="${dAfter}"`)
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  check('…salvat (verificat prin reîncărcare)', (await tel.locator('.edit-sheet .es-title').inputValue().catch(() => null)) === TITLE && ((await dueText()) ?? '').includes('17:00'), `jeton="${await dueText()}"`)
  check('…la redeschidere nimic evidențiat', (await tel.locator('.edit-sheet .es-title-mirror mark').count()) === 0, 'fără marcaj')

  await typeAtEnd(' la 18')
  await tel.waitForTimeout(300)
  const box = await tel.locator('.edit-sheet .es-title-mirror mark').first().boundingBox()
  if (box) {
    await tel.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await tel.waitForTimeout(300)
  }
  check('atingerea pe „la 18" îl refuză', !!box && (await tel.locator('.edit-sheet .es-title-mirror mark').count()) === 0, box ? 'fără marcaj' : 'n-a apărut marcajul')
  await tel.locator('.edit-sheet .qa-desc').focus()
  await tel.waitForTimeout(600)
  const tRej = await tel.locator('.edit-sheet .es-title').inputValue()
  check('…textul rămâne în titlu', tRej.trim() === `${TITLE} la 18`, JSON.stringify(tRej))
  check('…și scadența nu s-a mișcat', ((await dueText()) ?? '').includes('17:00'), `jeton="${await dueText()}"`)
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(400)
  await tel.close()

  // ── Gesturile de pe telefon: glisare, apăsare lungă, selecție ─────────
  // Atingeri reale (CDP, vezi `lib-touch.mjs`), pe un context cu ecran tactil:
  // `click()` ar ocoli exact ce se testează — blocarea direcției, pragurile,
  // anularea atingerii după mișcare. Filă curată, ca un `back()` să nu
  // aterizeze pe tichetele testelor de mai sus.
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const touch = await tctx.newPage()
  await touch.goto(BASE, { waitUntil: 'networkidle' })
  await touch.waitForTimeout(800)
  const T = await touchApi(touch)
  const names = ['Gest unu', 'Gest doi', 'Gest trei']
  for (const t of names) {
    await touch.locator('.fab').click()
    await touch.waitForTimeout(300)
    await touch.keyboard.type(t)
    await touch.keyboard.press('Enter')
    await touch.waitForTimeout(700)
  }
  // Toastul „Adăugat" nu are voie să încurce citirea toastului de anulare.
  await touch.waitForTimeout(2800)
  const titles = async () => (await touch.locator('.task-row .list-title').allInnerTexts()).filter((t) => t.startsWith('Gest'))
  const rowOf = (name) => touch.locator('.swipe', { hasText: name })
  const selecting = () => touch.locator('.sel-head').count().then((n) => n > 0)
  const touchOnAzi = async () => /Azi/.test((await touch.locator('.tabbar button.on').textContent().catch(() => '')) ?? '')
  check('telefon: trei sarcini de gest în „Azi"', (await titles()).length === 3, JSON.stringify(await titles()))

  // Derularea verticală nu e o glisare.
  {
    const c = await T.center(rowOf('Gest unu'))
    await T.drag(c.x, c.y, c.x + 12, c.y + 90)
    await touch.waitForTimeout(300)
    const cls = await rowOf('Gest unu').getAttribute('class')
    const style = await rowOf('Gest unu').locator('.task-row').getAttribute('style')
    check('mișcarea verticală nu glisează rândul', !/show-/.test(cls ?? '') && !style, `class="${cls}" style="${style}"`)
    check('…și nu deschide foaia', (await touch.locator('.edit-sheet').count()) === 0, 'fără foaie')
  }

  // Glisare scurtă spre stânga: banda rămâne deschisă cu trei butoane.
  {
    const c = await T.center(rowOf('Gest unu'))
    await T.drag(c.x + 40, c.y, c.x - 90, c.y)
    await touch.waitForTimeout(350)
    const open = /show-right/.test((await rowOf('Gest unu').getAttribute('class')) ?? '')
    const btns = await rowOf('Gest unu').locator('.swipe-right .swipe-btn').count()
    check('glisarea scurtă spre stânga deschide banda', open && btns === 3, `deschisă=${open}, butoane=${btns}`)
    check('banda nu deschide foaia', (await touch.locator('.edit-sheet').count()) === 0, 'fără foaie')
    // Un alt rând glisat închide primul: unul singur deschis.
    const c2 = await T.center(rowOf('Gest doi'))
    await T.drag(c2.x - 40, c2.y, c2.x + 10, c2.y)
    await touch.waitForTimeout(350)
    const firstClosed = !/show-/.test((await rowOf('Gest unu').getAttribute('class')) ?? '')
    check('o atingere în altă parte închide rândul deschis', firstClosed, firstClosed ? 'închis' : 'a rămas deschis')
  }

  // Glisare completă spre dreapta: „Mâine", cu anulare.
  {
    const c = await T.center(rowOf('Gest trei'))
    await T.drag(c.box.x + 40, c.y, c.box.x + 40 + c.box.width * 0.7, c.y)
    await touch.waitForTimeout(700)
    const gone = !(await titles()).includes('Gest trei')
    const toastTxt = ((await touch.locator('.toast').textContent()) ?? '').trim()
    check('glisarea completă spre dreapta mută pe mâine', gone, gone ? 'a plecat din „Azi"' : 'a rămas în „Azi"')
    check('toastul spune „Mutat pe mâine"', /Mutat pe mâine/.test(toastTxt), `toast="${toastTxt}"`)
    await touch.locator('.toast-act').click()
    await touch.waitForTimeout(700)
    check('„Anulează" o aduce înapoi', (await titles()).includes('Gest trei'), JSON.stringify(await titles()))
  }

  // Apăsarea lungă intră în selecție; Back iese și lasă ecranul pe „Azi".
  {
    const c = await T.center(rowOf('Gest doi'))
    await T.longPress(c.x, c.y)
    await touch.waitForTimeout(400)
    const head = ((await touch.locator('.sel-head').textContent().catch(() => '')) ?? '').trim()
    check('apăsarea lungă intră în selecție', /1\s*selectat/.test(head), `antet="${head}"`)
    check('…cu rândul apăsat ales', (await rowOf('Gest doi').locator('.task-row.selected').count()) === 1, 'ales')
    check('…bara de selecție ține locul barei de tab-uri', (await touch.locator('.sel-bar').count()) === 1 && (await touch.locator('.tabbar:not(.sel-bar)').count()) === 0, 'înlocuită')
    check('…și FAB-ul e ascuns', (await touch.locator('.fab').count()) === 0, 'ascuns')
    check('…și nu s-a deschis foaia', (await touch.locator('.edit-sheet').count()) === 0, 'fără foaie')
    await touch.goBack()
    await touch.waitForTimeout(600)
    check('Back iese din selecție', !(await selecting()), (await selecting()) ? 'a rămas în selecție' : 'ieșit')
    check('…și rămâi pe „Azi"', (await touchOnAzi()) && new URL(touch.url()).pathname === '/', `URL=${new URL(touch.url()).pathname}`)
  }

  // Capul grupului alege tot grupul; „Dată → Mâine" în bloc, cu anulare.
  {
    const c = await T.center(rowOf('Gest unu'))
    await T.longPress(c.x, c.y)
    await touch.waitForTimeout(400)
    const group = touch.locator('.list-group-head', { hasText: 'Azi' }).first()
    const g = await T.center(group)
    await T.tap(g.x, g.y)
    await touch.waitForTimeout(300)
    const inGroup = await touch.locator('.list-group', { has: group }).locator('.task-row').count()
    const head = ((await touch.locator('.sel-num').textContent()) ?? '').trim()
    check('capul grupului alege tot grupul', Number(head) === inGroup && inGroup >= 3, `selectate=${head}, în grup=${inGroup}`)
    await touch.locator('.sel-bar button', { hasText: 'Dată' }).click()
    await touch.waitForTimeout(400)
    check('„Dată" deschide foaia de dată', (await touch.locator('.date-sheet').count()) === 1, 'foaie')
    await touch.locator('.date-sheet .ds-opt', { hasText: 'Mâine' }).click()
    await touch.waitForTimeout(800)
    const left = await titles()
    check('„Mâine" în bloc mută sarcinile din „Azi"', left.length === 0, JSON.stringify(left))
    check('…și iese singur din selecție', !(await selecting()), 'ieșit')
    const toastTxt = ((await touch.locator('.toast').textContent()) ?? '').trim()
    check('toastul numără sarcinile mutate', /mutate pe mâine/.test(toastTxt), `toast="${toastTxt}"`)
    const st = await touch.evaluate(() => history.state?.hzSheet ?? null)
    check('ieșirea desface intrările din istoric', st === null && new URL(touch.url()).pathname === '/', `hzSheet=${st}`)
    await touch.locator('.toast-act').click()
    await touch.waitForTimeout(800)
    check('„Anulează" le aduce pe toate înapoi', (await titles()).length === 3, JSON.stringify(await titles()))
  }
  await tctx.close()

  // ── Tab-urile de sus pe telefon: fără săgeată, Back spre „Azi" ─────────
  // „Azi", „7 zile", „Ale mele" și „Proiecte" sunt tab-uri de sus, nu pagini
  // una sub alta: nicio săgeată în antet. Săgeata trăiește doar ÎN proiect și
  // duce la „Proiecte". Back-ul (gestul Android) urmează convenția barei de
  // jos: de pe orice tab → „Azi", de pe „Azi" → afară din aplicație. Filă
  // curată: pornirea trebuie să fie chiar prima, iar `about:blank` din spate
  // e „afară".
  {
    const nav = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await nav.goto(BASE, { waitUntil: 'networkidle' })
    await nav.waitForTimeout(800)
    const active = async () => ((await nav.locator('.tabbar button.on').textContent().catch(() => '')) ?? '').trim()
    const arrow = () => nav.locator('header .back').isVisible().catch(() => false)
    const tab = async (t) => { await nav.click(`[data-tab="${t}"]`); await nav.waitForTimeout(500) }
    const back = async () => { await nav.goBack().catch(() => null); await nav.waitForTimeout(600) }
    const path = () => new URL(nav.url()).pathname

    check('telefon: pornirea aterizează pe „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)
    check('…fără săgeată pe „Azi"', !(await arrow()), 'antet')
    for (const [t, label] of [['week', '7 zile'], ['inbox', 'Ale mele'], ['projects', 'Proiecte']]) {
      await tab(t)
      check(`fără săgeată pe „${label}"`, (await active()).includes(label) && !(await arrow()), `tab activ="${await active()}"`)
    }

    // Comutarea nu adună intrări: după trei tab-uri, un singur Back e „Azi".
    await back()
    check('Back de pe „Proiecte" (după trei tab-uri) → „Azi"', /Azi/.test(await active()) && path() === '/', `tab activ="${await active()}" URL=${path()}`)

    await tab('week')
    await back()
    check('Back de pe „7 zile" → „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)

    // Proiect: săgeata duce la „Proiecte", iar Back de acolo la „Azi".
    await tab('projects')
    await nav.locator('.proj').first().click()
    await nav.waitForTimeout(800)
    check('în proiect există săgeata', await arrow(), path())
    await nav.locator('header .back').click()
    await nav.waitForTimeout(600)
    check('săgeata din proiect → „Proiecte"', (await nav.locator('.proj').count()) > 0 && path() === '/' && !(await arrow()), `URL=${path()}`)
    await back()
    check('…și Back de acolo → „Azi", nu înapoi în proiect', /Azi/.test(await active()) && path() === '/', `tab activ="${await active()}" URL=${path()}`)

    // Back din proiect (gestul) → „Proiecte".
    await tab('projects')
    await nav.locator('.proj').first().click()
    await nav.waitForTimeout(800)
    await back()
    check('Back din proiect → „Proiecte"', (await nav.locator('.proj').count()) > 0 && path() === '/', `URL=${path()}`)
    await back()
    check('…apoi → „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)

    // Reîncărcarea pe „7 zile" (pwa.ts aplică un build nou exact așa) rămâne
    // pe „7 zile", iar Back tot pe „Azi" duce.
    await tab('week')
    await nav.reload({ waitUntil: 'networkidle' })
    await nav.waitForTimeout(1200)
    check('reîncărcarea pe „7 zile" rămâne pe „7 zile"', (await active()).includes('7 zile'), `tab activ="${await active()}"`)
    await back()
    check('…și Back după ea → „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)

    // De pe „Azi", Back iese: nu mai e nimic al aplicației în spate.
    const depth = await nav.evaluate(() => history.state?.hzDepth ?? 0)
    check('„Azi" e rădăcina istoricului', depth === 0, `hzDepth=${depth}`)
    await back()
    check('Back de pe „Azi" iese din aplicație', !nav.url().startsWith(BASE), `URL=${nav.url()}`)
    await nav.close()
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
