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

// `NAV_PORT`: două copii de lucru (worktree-uri) pot rula testul în paralel.
const PORT = Number(process.env.NAV_PORT ?? 5211)
const BASE = `http://localhost:${PORT}`
const failures = []

// Descrierea e un editor CodeMirror (contenteditable), nu un textarea:
// textul real (cu sintaxa ascunsă) se citește prin `hzValue`.
async function descOf(page, scope) {
  const ed = page.locator(`${scope} .md-editor`)
  await ed.waitFor({ timeout: 5000 })
  return ed.evaluate((el) => el.hzValue())
}
async function typeDesc(page, scope, text) {
  const c = page.locator(`${scope} .md-editor .cm-content`)
  await c.waitFor({ timeout: 5000 })
  await c.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(text)
}

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
  // deci proiectul se deschide explicit din bara laterală.
  const bootScreen = await page.locator('.sidebar-nav-item.on').first().textContent()
  check('pornirea aterizează pe „Azi"', /Azi/.test(bootScreen ?? ''), `ecran=${(bootScreen ?? '').trim()}`)
  // Lista „Toate proiectele" a ieșit (2026-10-15): nici rândul din bara
  // laterală, nici un drum care să mai aterizeze pe ea. Un proiect necunoscut
  // din URL cade pe „Azi", rădăcina.
  const allRow = await page.locator('.sidebar-nav-item', { hasText: 'Toate proiectele' }).count()
  check('bara laterală n-are „Toate proiectele"', allRow === 0, `rânduri=${allRow}`)
  {
    const lost = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await lost.goto(`${BASE}/project/nu-exista`, { waitUntil: 'networkidle' })
    await lost.waitForTimeout(900)
    const on = (await lost.locator('.sidebar-nav-item.on').first().textContent().catch(() => ''))?.trim()
    check('un proiect necunoscut din URL aterizează pe „Azi"', /Azi/.test(on ?? ''), `ecran=${on} URL=${new URL(lost.url()).pathname}`)
    await lost.close()
  }
  await page.locator('.sidebar-proj-btn').filter({ hasNotText: /Inbox/ }).first().click()
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

  // ── Editorul de descriere din panoul docat: Ctrl+B și Ctrl+Enter ────────
  await page.locator('.split-pane .md-editor').first().waitFor({ timeout: 5000 })
  await page.locator('.split-pane .md-editor .cm-content').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  // Caseta goală e țintă de click pe toată înălțimea, nu doar pe rândul de text.
  await page.locator('.tabs').click()
  const descBox = await page.locator(".split-pane .desc-fixed").boundingBox()
  await page.mouse.click(descBox.x + 40, descBox.y + descBox.height - 20)
  await page.waitForTimeout(200)
  check('click jos într-o descriere goală focusează editorul', await page.evaluate(() => !!document.activeElement?.closest('.split-pane .md-editor')), 'focus în editor')
  await page.keyboard.type('a')
  await page.keyboard.press('Control+b')
  await page.keyboard.type('b')
  check('Ctrl+B pune marcajul de aldin în panou', (await descOf(page, '.split-pane')) === 'a**b**', JSON.stringify(await descOf(page, '.split-pane')))
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(1200)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(1000)
  const savedViaPanel = await descOf(page, '.split-pane').catch(() => null)
  check('Ctrl+Enter salvează descrierea din panou', savedViaPanel === 'a**b**', JSON.stringify(savedViaPanel))

  // ── Panoul: descrierea cât textul, rândul de fir sus, citit = văzut ─────
  // Macheta `design/panel-thread`. Un alt tichet decât cel docat, cu o
  // descriere lungă și un comentariu străin nevăzut.
  const dockedId = decodeURIComponent(new URL(page.url()).pathname.slice(1))
  const other = await page.evaluate((docked) => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    const me = db.issues.find((x) => x.id === docked)
    const i = db.issues.find((x) => x.id !== docked && !x.done && x.projectId === me?.projectId)
    i.desc = Array.from({ length: 40 }, (_, k) => `Rândul ${k + 1} al descrierii lungi.`).join('\n')
    const at = new Date(Date.now() - 5 * 60_000).toISOString()
    db.events = [...(db.events ?? []), { id: 'nav-pt1', issueId: i.id, projectId: i.projectId, kind: 'comment', authorId: 'u-altcineva', body: 'Am pus o întrebare în fir.', handoffFrom: null, handoffTo: null, createdAt: at, editedAt: null }]
    if (db.seen) delete db.seen[i.id]
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
    return { id: i.id, title: i.title }
  }, dockedId)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.list-row').filter({ hasText: other.title }).first().click()
  await page.waitForTimeout(1200)
  const ptRow = page.locator('.split-pane .es-thread')
  check('panou: rândul de fir sus, necitit', (await ptRow.count()) === 1 && /unread/.test((await ptRow.getAttribute('class')) ?? ''), `${await ptRow.getAttribute('class').catch(() => 'lipsă')}`)
  const descH = async () => (await page.locator('.split-pane .desc-fixed').boundingBox())?.height ?? 0
  const foldedH = await descH()
  const moreBtn = page.locator('.split-pane .desc-more')
  check('panou: descrierea lungă se pliază sub plafon', foldedH > 0 && foldedH <= 341 && /Arată tot/.test((await moreBtn.textContent().catch(() => '')) ?? ''), `${Math.round(foldedH)}px, buton="${await moreBtn.textContent().catch(() => 'lipsă')}"`)
  await moreBtn.click()
  await page.waitForTimeout(200)
  check('…„Arată tot" o desface, butonul devine „Restrânge"', (await descH()) > foldedH + 100 && /Restrânge/.test((await moreBtn.textContent()) ?? ''), `${Math.round(await descH())}px`)
  await moreBtn.click()
  await page.waitForTimeout(200)
  await ptRow.click()
  await page.waitForTimeout(900)
  const pt = await page.evaluate((id) => {
    const body = document.querySelector('.split-pane .if-body')
    const th = document.querySelector('.split-pane .thread')
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    return { focus: document.activeElement === th, scrolled: (body?.scrollTop ?? 0) > 0, seen: !!db.seen?.[id] }
  }, other.id)
  check('…atingerea rândului derulează la Fir, cu focus pe fir (nu în casetă)', pt.focus && pt.scrolled, JSON.stringify(pt))
  check('…firul văzut e marcat citit', pt.seen, pt.seen ? 'seen scris' : 'nemarcat')
  check('…iar rândul rămâne „nou" cât stă tichetul deschis', /unread/.test((await ptRow.getAttribute('class')) ?? ''), `${await ptRow.getAttribute('class')}`)
  // Înapoi pe tichetul docat de dinainte, ca restul testului să-l găsească.
  await page.locator('.list-row').first().click()
  await page.waitForTimeout(800)

  await page.locator('.tabs').click()
  await page.waitForTimeout(150)
  // Cu modul Vim, crearea e `a` (ca în yazi).
  await page.keyboard.press('a')
  await page.waitForTimeout(800)
  const newFormOpen = await modalOpen()
  const firstVal = await page.locator('.sheet.on .sh-title-input').first().inputValue().catch(() => null)
  check('a deschide un tichet nou peste panou', newFormOpen, newFormOpen ? 'formular deschis' : 'nu s-a întâmplat nimic')
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
  // Cu modul Vim, crearea e `a` (ca în yazi).
  await page.keyboard.press('a')
  await page.waitForTimeout(700)
  const stillThere = await page.locator('.sh-title-input').first().inputValue().catch(() => '')
  check(
    'a nu aruncă modificările nesalvate',
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
    // Cu modul Vim, crearea e `a` (ca în yazi).
    await page.keyboard.press('a')
    await page.waitForTimeout(600)
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('qa-input') ?? false)
    check('a focusează quick add pe „Azi"', focused, focused ? 'cursorul e în câmp' : 'nu s-a întâmplat nimic')
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

  // ── Fixarea din listă, pe desktop: piuneza la hover, click dreapta, F ───
  // Piuneza din coada rândului (`RowPin`) fixează FĂRĂ să deschidă tichetul
  // (stopPropagation pe click, `mousedown` prevenit), meniul de click dreapta
  // o scoate, iar F pe rândul cu focus o pune la loc. Totul se desface la
  // capăt și sarcina se șterge din bază, ca testele de telefon de mai jos să
  // vadă „Azi" ca înainte.
  {
    const dp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await dp.goto(BASE, { waitUntil: 'networkidle' })
    await dp.waitForTimeout(700)
    await dp.locator('.tabbar button, .sidebar-smart-item, .sidebar button')
      .filter({ hasText: /^Azi/ }).locator('visible=true').first().click()
    await dp.waitForTimeout(800)
    const title = 'Sarcină de fixat de pe desktop'
    await dp.locator('.qa-input').first().fill(title)
    await dp.keyboard.press('Enter')
    await dp.waitForTimeout(1200)
    const row = () => dp.locator('.task-row', { hasText: title }).first()
    const firstGroup = () => dp.evaluate(() => {
      const g = document.querySelector('.smart-list .list-group')
      return g ? { label: g.querySelector('.list-group-label')?.textContent, rows: [...g.querySelectorAll('.list-title')].map((t) => t.textContent) } : null
    })
    const pinnedInDb = () => dp.evaluate((t) => !!JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.title === t)?.pinnedAt, title)
    await row().hover()
    await dp.waitForTimeout(250)
    const pinOp = await row().locator('.row-pin').evaluate((el) => getComputedStyle(el).opacity)
    check('desktop: piuneza apare la hover pe rând', pinOp === '1', `opacity=${pinOp}`)
    await row().locator('.row-pin').click()
    await dp.waitForTimeout(700)
    const url = new URL(dp.url()).pathname
    const docked = await dp.locator('.split-pane:not([hidden]) .sh-header').count()
    check('…click pe ea NU deschide tichetul', url === '/' && docked === 0 && (await dp.locator('.sheet.on').count()) === 0, `URL=${url}, panou=${docked}`)
    const g1 = await firstGroup()
    check('…și sarcina urcă în „Fixate"', (await pinnedInDb()) && g1?.label === 'Fixate' && g1.rows.includes(title), JSON.stringify(g1))
    check('…cu piuneza plină pe rând', (await row().locator('.row-pin.on').count()) === 1, 'pornită')

    await row().click({ button: 'right' })
    await dp.waitForTimeout(300)
    const menu = dp.locator('.ctx-menu [role="menuitem"]', { hasText: 'Scoate de sus' })
    check('click dreapta: meniul rândului oferă „Scoate de sus"', (await menu.count()) === 1, `${await menu.count()} intrări`)
    await menu.click()
    await dp.waitForTimeout(700)
    check('…și scoate fixarea', !(await pinnedInDb()) && (await firstGroup())?.label !== 'Fixate', JSON.stringify(await firstGroup()))

    await row().focus()
    // `F` mare: cu modul Vim, `f` e filtrul listei.
    await dp.keyboard.press('Shift+F')
    await dp.waitForTimeout(700)
    check('F pe rândul cu focus îl fixează', await pinnedInDb(), 'pinnedAt pus')
    await row().focus()
    // `F` mare: cu modul Vim, `f` e filtrul listei.
    await dp.keyboard.press('Shift+F')
    await dp.waitForTimeout(700)
    check('…a doua oară îl scoate', !(await pinnedInDb()), 'pinnedAt null')

    await dp.evaluate((t) => {
      const db = JSON.parse(localStorage.getItem('horizontal:v2'))
      db.issues = db.issues.filter((i) => i.title !== t)
      localStorage.setItem('horizontal:v2', JSON.stringify(db))
    }, title)
    await dp.close()
  }

  // ── Proiectul sarcinii se deschide din sidebar la PRIMUL click ──────────
  // O sarcină deschisă din „Azi" încarcă proiectul ei în store, sub listă. O
  // repornire peste card face ca închiderea să NU treacă prin `back()` →
  // `popstate` → `selectProject(null)` (în spate nu e nimic al nostru), deci
  // proiectul rămâne încărcat. Un click pe ACELAȘI proiect în sidebar chema
  // `selectProject(null)` și `selectProject(id)` în același tick, iar garda
  // „reselectare fără efect" citea `projectId` din clojură — încă proiectul,
  // deci al doilea apel era ignorat și rămâneai pe lista de proiecte (scoasă
  // între timp, 2026-10-15).
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
  // Idem: pornirea e pe „Azi", deci proiectul se deschide din bara laterală.
  await stale.locator('.sidebar-proj-btn').filter({ hasNotText: /Inbox/ }).first().click()
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
  await pass.locator('.sidebar-proj-btn').filter({ hasNotText: /Inbox/ }).first().click()
  await pass.waitForTimeout(900)
  await pass.locator('.tab', { hasText: /^List/ }).first().click()
  await pass.waitForTimeout(500)
  await pass.locator('.list-row').first().click()
  await pass.waitForTimeout(900)
  const screenBeforePass = await pass.locator('h1').first().textContent().catch(() => null)
  const urlBeforePass = new URL(pass.url()).pathname

  // Caseta de comentariu stă strânsă într-un rând; „către…" apare la focus.
  check('caseta de comentariu e strânsă în repaus', (await pass.locator('.thread-compose:not(.open)').count()) === 1 && (await pass.locator('.thread-to-btn').count()) === 0, 'un rând, fără acțiuni')
  await pass.locator('.thread-compose .thread-textarea').click()
  await pass.waitForTimeout(150)
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
  // Proiectele stau în sertar (☰), nu într-un tab.
  await phone.locator('.header-drawer-btn').click()
  await phone.waitForTimeout(400)
  await phone.locator('.dr-projects .dr-row').first().click()
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
  // ROUTIN-09 (2026-10-17): descrierea GOALĂ, întinsă de foaie peste plafon +
  // 4 rânduri, se plia (întinsă), se despliea (plafonată) și iar — iar la
  // primul spațiu din titlu bucla devenea sincronă și pagina îngheța. Pe
  // telefon geometria o dădea tastatura; aici foaia e înălțată cu un stil.
  {
    const style = await tel.addStyleTag({ content: '.edit-sheet { min-height: 820px !important; max-height: none !important }' })
    await tel.waitForTimeout(200)
    const flips = await tel.evaluate(() => new Promise((res) => {
      const box = document.querySelector('.edit-sheet .es-desc')
      let n = 0
      const mo = new MutationObserver(() => n++)
      mo.observe(box, { childList: true, attributes: true, attributeFilter: ['class'] })
      setTimeout(() => { mo.disconnect(); res(n) }, 600)
    }))
    const folded = await tel.locator('.edit-sheet .es-desc .desc-more').count()
    check('descrierea goală, întinsă de foaie, nu oscilează între pliat și întreg', flips === 0 && folded === 0, `${flips} schimbări în 600ms, „Arată tot"=${folded}`)
    await style.evaluate((el) => el.remove())
    await tel.waitForTimeout(200)
  }
  // Mânerul de sus: o tragere scurtă și lentă lasă foaia; una lungă o închide.
  {
    const { drag, center } = await touchApi(tel)
    const g = await center(tel.locator('.edit-sheet .kb-grab'))
    await drag(g.x, g.y, g.x, g.y + 40, { steps: 20, stepMs: 30 })
    await tel.waitForTimeout(400)
    check('mânerul: tragere scurtă și lentă nu închide foaia', await editOpen(), (await editOpen()) ? 'încă deschisă' : 's-a închis')
    await drag(g.x, g.y, g.x, g.y + 200, { steps: 12, stepMs: 16 })
    await tel.waitForTimeout(600)
    check('mânerul: tragerea în jos închide foaia', !(await editOpen()), (await editOpen()) ? 'a rămas deschisă' : 'închisă')
    check('…și te lasă pe „Azi"', await telOnAzi(), 'tabul Azi')
    await openTask()
  }
  const editUrl = new URL(tel.url()).pathname
  check('foaia de tichet ține URL de tichet', /^\/[A-Z]+-\d+$/.test(editUrl), `URL=${editUrl}`)

  await tel.goBack()
  await tel.waitForTimeout(600)
  check('Back închide foaia de tichet', !(await editOpen()), (await editOpen()) ? 'a rămas deschisă' : 'închisă')
  check('Back lasă ecranul pe „Azi"', (await telOnAzi()) && new URL(tel.url()).pathname === '/', `URL=${new URL(tel.url()).pathname}`)

  await openTask()
  await typeDesc(tel, '.edit-sheet', 'Descriere salvată singură')
  await tel.waitForTimeout(1300) // peste pauza de 800ms
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  // Reîncărcată peste foaie, aplicația o redeschide din URL (deep link) — tot
  // foaia de tichet, nu formularul.
  const reDesc = await descOf(tel, '.edit-sheet').catch(() => null)
  check('descrierea s-a salvat după pauză (verificat prin reîncărcare)', reDesc === 'Descriere salvată singură', JSON.stringify(reDesc))

  // ── Căsuțele din descriere: o atingere bifează, fără focus și fără tastatură ──
  await typeDesc(tel, '.edit-sheet', '- [ ] unu')
  await tel.keyboard.press('Enter')
  await tel.keyboard.type('doi')
  check('Enter continuă lista cu o căsuță nouă', (await descOf(tel, '.edit-sheet')) === '- [ ] unu\n- [ ] doi', JSON.stringify(await descOf(tel, '.edit-sheet')))
  await tel.locator('.edit-sheet .md-editor .cm-content').evaluate((el) => el.blur())
  await tel.waitForTimeout(300)
  const vvBefore = await tel.evaluate(() => visualViewport.height)
  const { tap, center } = await touchApi(tel)
  const tb = await center(tel.locator('.edit-sheet .md-task').first())
  await tap(tb.x, tb.y)
  await tel.waitForTimeout(300)
  check('atingerea bifează căsuța', (await descOf(tel, '.edit-sheet')) === '- [x] unu\n- [ ] doi', JSON.stringify(await descOf(tel, '.edit-sheet')))
  check('…fără să ia focusul', !(await tel.evaluate(() => !!document.activeElement?.closest('.md-editor'))), 'focusul în afara editorului')
  check('…și fără să micșoreze ecranul', (await tel.evaluate(() => visualViewport.height)) === vvBefore, 'visualViewport neschimbat')
  check('rândul bifat e tăiat', (await tel.locator('.edit-sheet .md-done').count()) === 1, 'un `.md-done`')

  // ── Compunerea (IME): decorările nu stau în calea unui cuvânt în compunere ──
  const cdp = await tel.context().newCDPSession(tel)
  await tel.locator('.edit-sheet .md-editor .cm-content').click()
  await tel.keyboard.press('Control+End')
  await tel.keyboard.press('Enter')
  await cdp.send('Input.imeSetComposition', { text: 'ș', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'ști', selectionStart: 3, selectionEnd: 3 })
  await cdp.send('Input.insertText', { text: 'știu **tot**' })
  await tel.waitForTimeout(200)
  check('compunerea nu dublează și nu pierde litere', (await descOf(tel, '.edit-sheet')).endsWith('- [ ] știu **tot**'), JSON.stringify(await descOf(tel, '.edit-sheet')))
  check('deep link pe telefon → foaia de tichet', await editOpen(), (await editOpen()) ? 'foaie' : 'altceva')
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(600)
  check('Esc închide foaia și rămâi pe „Azi"', !(await editOpen()) && (await telOnAzi()), `URL=${new URL(tel.url()).pathname}`)

  // ── CRLF: documentul editorului ESTE descrierea, octet cu octet ──
  // Un text venit de pe Windows (API, ticket-kit) are `\r\n`. Deschis fără
  // editare nu se scrie nimic; o bifă schimbă exact un caracter.
  const CRLF = '- [ ] a\r\n- [ ] b'
  const storedDesc = () => tel.evaluate((t) => JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.title === t)?.desc, 'Sarcină pentru foaia de tichet')
  await tel.evaluate(([t, d]) => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    db.issues.find((i) => i.title === t).desc = d
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
  }, ['Sarcină pentru foaia de tichet', CRLF])
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  await openTask()
  check('CRLF: editorul ține textul neatins', (await descOf(tel, '.edit-sheet')) === CRLF, JSON.stringify(await descOf(tel, '.edit-sheet')))
  check('…fără rânduri goale în plus', (await tel.locator('.edit-sheet .cm-line').count()) === 2, `${await tel.locator('.edit-sheet .cm-line').count()} rânduri`)
  await tel.waitForTimeout(1300) // peste pauza de 800ms
  check('…și deschiderea nu scrie nimic', (await storedDesc()) === CRLF, JSON.stringify(await storedDesc()))
  {
    const { tap, center } = await touchApi(tel)
    const tb = await center(tel.locator('.edit-sheet .md-task').first())
    await tap(tb.x, tb.y)
    await tel.waitForTimeout(600)
  }
  check('CRLF: bifa schimbă exact un caracter', (await storedDesc()) === '- [x] a\r\n- [ ] b', JSON.stringify(await storedDesc()))
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(600)

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

  // ── Sarcini fixate (`pinnedAt`) ─────────────────────────────────────────
  // Piuneza de pe rândul ID-ului din foaia de tichet fixează imediat; „Azi"
  // capătă grupul „Fixate" primul, cu sarcina în el (și numai acolo). Fixarea
  // doar ORDONEAZĂ (ca Pin din TickTick): un tichet FĂRĂ scadență fixat nu
  // intră în „Azi", iar o fixată mutată pe mâine iese din „Azi" și urcă în
  // „7 zile". Apoi totul se desface, ca testele de mai jos să vadă „Azi" ca înainte.
  const pinGroup = () => tel.evaluate(() => {
    const g = document.querySelector('.smart-list .list-group')
    return g ? { label: g.querySelector('.list-group-label')?.textContent, rows: [...g.querySelectorAll('.list-title')].map((t) => t.textContent) } : null
  })
  const pinTitle = 'Sarcină pentru foaia de tichet'
  await openTask()
  await tel.locator('.edit-sheet .es-pin').click()
  await tel.waitForTimeout(500)
  const pinnedAt = await tel.evaluate((t) => JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.title === t)?.pinnedAt, pinTitle)
  check('fixare: piuneza din foaie scrie `pinnedAt`', typeof pinnedAt === 'string', JSON.stringify(pinnedAt))
  check('…butonul arată starea', (await tel.locator('.edit-sheet .es-pin.on').count()) === 1, 'pornit')
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(600)
  const pg = await pinGroup()
  check('fixare: „Fixate" e primul grup din „Azi"', pg?.label === 'Fixate' && pg.rows.includes(pinTitle), JSON.stringify(pg))
  check('…și sarcina nu apare a doua oară', (await tel.locator('.smart-list .list-title', { hasText: pinTitle }).count()) === 1, `${await tel.locator('.smart-list .list-title', { hasText: pinTitle }).count()} rânduri`)
  const undated = await tel.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    const i = db.issues.find((x) => !x.done && !x.dueAt)
    i.pinnedAt = new Date().toISOString()
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
    return i.title
  })
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  const pg2 = await pinGroup()
  check('fixare: un tichet fără dată fixat NU intră în „Azi"', pg2?.label === 'Fixate' && !pg2.rows.includes(undated) && pg2.rows.includes(pinTitle)
    && (await tel.locator('.smart-list .list-title', { hasText: undated }).count()) === 0, JSON.stringify(pg2))
  // Mutată pe mâine: iese din „Azi", urcă în „Fixate" din „7 zile".
  await tel.evaluate((t) => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    const i = db.issues.find((x) => x.title === t)
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1)
    i.dueAt = d.toISOString(); i.allDay = true
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
  }, pinTitle)
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  check('fixare: mutată pe mâine, iese din „Azi"', (await tel.locator('.smart-list .list-title', { hasText: pinTitle }).count()) === 0, JSON.stringify(await pinGroup()))
  await tel.locator('.tabbar button').filter({ hasText: /7 zile/ }).first().click()
  await tel.waitForTimeout(800)
  const pg3 = await pinGroup()
  check('…și urcă în „Fixate" din „7 zile", o singură dată', pg3?.label === 'Fixate' && pg3.rows.includes(pinTitle)
    && (await tel.locator('.smart-list .list-title', { hasText: pinTitle }).count()) === 1, JSON.stringify(pg3))
  await tel.evaluate((t) => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    for (const i of db.issues) i.pinnedAt = null
    const i = db.issues.find((x) => x.title === t)
    const d = new Date(); d.setHours(0, 0, 0, 0)
    i.dueAt = d.toISOString(); i.allDay = true
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
  }, pinTitle)
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  await tel.locator('.tabbar button').filter({ hasText: /^Azi/ }).first().click()
  await tel.waitForTimeout(600)
  check('fixare scoasă: grupul dispare', (await pinGroup())?.label !== 'Fixate', JSON.stringify(await pinGroup()))

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
  await tel.locator('.edit-sheet .md-editor .cm-content').focus() // blur pe titlu
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
  await tel.locator('.edit-sheet .md-editor .cm-content').focus()
  await tel.waitForTimeout(600)
  const tRej = await tel.locator('.edit-sheet .es-title').inputValue()
  check('…textul rămâne în titlu', tRej.trim() === `${TITLE} la 18`, JSON.stringify(tRej))
  check('…și scadența nu s-a mișcat', ((await dueText()) ?? '').includes('17:00'), `jeton="${await dueText()}"`)
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(400)

  // ── Rândul de fir din foaia de tichet ──────────────────────────────────
  // Fără evenimente: nimic. Cu un comentariu al altcuiva, nevăzut: rândul
  // necitit, cu textul. Atingerea → formularul complet derulat la Fir, cu
  // „nou", FĂRĂ focus în caseta de răspuns; încărcarea firului îl face citit.
  await openTask()
  check('fir gol: foaia n-are rândul de fir', (await tel.locator('.edit-sheet .es-thread').count()) === 0, 'fără `.es-thread`')
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(500)
  await tel.evaluate((t) => {
    const db = JSON.parse(localStorage.getItem('horizontal:v2'))
    const i = db.issues.find((x) => x.title.startsWith(t))
    const at = (min) => new Date(Date.now() - min * 60_000).toISOString()
    const ev = (id, authorId, body, min) => ({ id, issueId: i.id, projectId: i.projectId, kind: 'comment', authorId, body, handoffFrom: null, handoffTo: null, createdAt: at(min), editedAt: null })
    // Destule cât firul să nu încapă sub formular: derularea chiar se vede.
    const mine = Array.from({ length: 6 }, (_, k) => ev(`nav-m${k}`, 'local', `Notă de-a mea ${k}`, 300 - k))
    db.events = [...(db.events ?? []), ...mine, ev('nav-f1', 'u-altcineva', 'Poți verifica pe staging cu clientul de test?', 120)]
    if (db.seen) delete db.seen[i.id]
    localStorage.setItem('horizontal:v2', JSON.stringify(db))
  }, TITLE)
  await tel.reload({ waitUntil: 'networkidle' })
  await tel.waitForTimeout(1600)
  await openTask()
  const thRow = tel.locator('.edit-sheet .es-thread')
  check('comentariu nevăzut: rândul de fir necitit', (await thRow.count()) === 1 && /unread/.test((await thRow.getAttribute('class')) ?? ''), `${await thRow.getAttribute('class').catch(() => 'lipsă')}`)
  check('…cu textul și numărul', /staging/.test((await thRow.textContent()) ?? '') && /7/.test((await tel.locator('.edit-sheet .es-thread-n').textContent()) ?? ''), JSON.stringify(await thRow.textContent()))
  await tel.locator('.edit-sheet .es-title').focus()
  await tel.waitForTimeout(200)
  check('cu titlul în focus rândul se ascunde', (await thRow.count()) === 0, 'ascuns')
  await tel.locator('.edit-sheet .es-title').evaluate((el) => el.blur())
  await tel.waitForTimeout(300)
  await thRow.click()
  await tel.waitForTimeout(1200)
  check('atingerea deschide formularul complet', (await tel.locator('.sheet.on .thread').count()) === 1 && !(await editOpen()), 'formular cu fir')
  check('…cu „nou" deasupra necititului', (await tel.locator('.sheet.on .thread-new').count()) === 1, `${await tel.locator('.sheet.on .thread-new').count()} separatoare`)
  const seen = await tel.evaluate(() => {
    const el = document.querySelector('.sheet.on .thread-new')
    const r = el?.getBoundingClientRect()
    return { inView: !!r && r.top >= 0 && r.bottom <= innerHeight, focus: document.activeElement?.className ?? '' }
  })
  check('…derulat la fir', seen.inView, seen.inView ? 'separatorul în ecran' : 'în afara ecranului')
  check('…fără focus în caseta de răspuns', !/thread-textarea/.test(seen.focus), `activ="${seen.focus}"`)
  await tel.goBack()
  await tel.waitForTimeout(700)
  check('Back închide formularul, rămâi pe „Azi"', (await tel.locator('.sheet.on').count()) === 0 && (await telOnAzi()), `URL=${new URL(tel.url()).pathname}`)
  await openTask()
  check('firul încărcat l-a făcut citit', /\bread\b/.test((await thRow.getAttribute('class').catch(() => '')) ?? ''), `${await thRow.getAttribute('class').catch(() => 'lipsă')}`)
  await tel.keyboard.press('Escape')
  await tel.waitForTimeout(400)
  await tel.close()

  // ── Gesturile de pe telefon: glisare, apăsare lungă, selecție ─────────
  // Atingeri reale (CDP, vezi `lib-touch.mjs`), pe un context cu ecran tactil:
  // `click()` ar ocoli exact ce se testează — blocarea direcției, pragurile,
  // anularea atingerii după mișcare. Filă curată, ca un `back()` să nu
  // aterizeze pe tichetele testelor de mai sus.
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  // `NAV_CLOCK=2026-10-15T22:30` pornește ceasul paginii de telefon de acolo
  // (curge normal mai departe): verificările legate de ora zilei se pot rula
  // și „seara" fără să aștepți seara.
  if (process.env.NAV_CLOCK) await tctx.clock.install({ time: new Date(process.env.NAV_CLOCK) })
  const touch = await tctx.newPage()
  await touch.goto(BASE, { waitUntil: 'networkidle' })
  await touch.waitForTimeout(800)
  const T = await touchApi(touch)

  // Refuzul unei date prin ATINGERE: indiciul și jetonul pleacă, foaia lipită
  // de jos scade sub deget, iar click-ul de după ridicare cădea pe fundal și
  // închidea foaia („Daily cu șeful" → atingi „Daily" → dispare tot).
  await touch.locator('.fab').click()
  await touch.waitForTimeout(300)
  await touch.keyboard.type('Daily cu șeful')
  await touch.waitForTimeout(300)
  const dailyMark = touch.locator('.kb-sheet mark').first()
  const hadMark = (await dailyMark.count()) > 0
  if (hadMark) { const c = await T.center(dailyMark); await T.tap(c.x, c.y) }
  await touch.waitForTimeout(500)
  const quickVal = await touch.locator('.kb-sheet .qa-input').inputValue().catch(() => null)
  check('atingerea pe „Daily" refuză data și foaia rapidă rămâne deschisă', hadMark && quickVal?.trim() === 'Daily cu șeful' && (await touch.locator('.kb-sheet mark').count()) === 0,
    hadMark ? `valoare=${JSON.stringify(quickVal)}` : 'n-a apărut marcajul')
  await touch.keyboard.press('Escape')
  await touch.waitForTimeout(400)

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
    check('glisarea scurtă spre stânga deschide banda', open && btns === 4, `deschisă=${open}, butoane=${btns}`)
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

  // Banda: Dată, Oră, ⋮. „Dată" și „Oră" sunt inputuri native REALE sub deget
  // (`NativePick`), nu `showPicker()` pe un input ascuns — acela n-a deschis
  // nimic pe telefon. Chromium headless n-are dialogul sistemului, deci se
  // verifică două lucruri separat: (1) atingerea cade pe un `<input type=…>`
  // (`elementFromPoint` în centrul butonului — exact ce primește degetul), fără
  // niciun `showPicker`; (2) `change` pe inputul acela scrie, cu toast și
  // anulare. Anularea selectorului nu trimite `change`, deci nu scrie nimic.
  {
    await touch.evaluate(() => {
      window.__showPicker = 0
      HTMLInputElement.prototype.showPicker = function () { window.__showPicker++ }
    })
    // Fără oră rândul nu mai are `.t-time` deloc (redesignul „Senin”) — atunci ''.
    const timeOf = (name) => rowOf(name).locator('.t-time').allInnerTexts().then((t) => t.join(''))
    const openStrip = async (name) => {
      if (/show-right/.test((await rowOf(name).getAttribute('class')) ?? '')) return
      const c = await T.center(rowOf(name))
      await T.drag(c.x + 40, c.y, c.x - 90, c.y)
      await touch.waitForTimeout(350)
    }
    await openStrip('Gest unu')
    const labels = await rowOf('Gest unu').locator('.swipe-right .swipe-btn').evaluateAll((bs) =>
      bs.map((b) => b.getAttribute('aria-label') ?? b.querySelector('input')?.getAttribute('aria-label')))
    check('banda: Dată, Oră, Șterge, ⋮ — „Oră" e al doilea', JSON.stringify(labels) === JSON.stringify(['Dată', 'Oră', 'Șterge', 'Mai multe']), JSON.stringify(labels))

    const under = (label) => rowOf('Gest unu').locator(`.swipe-btn:has(input[aria-label="${label}"])`).evaluate((btn) => {
      const r = btn.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return el?.tagName === 'INPUT' ? `input:${el.type}` : el?.tagName ?? 'nimic'
    })
    check('sub degetul de pe „Dată" e un input type=date', (await under('Dată')) === 'input:date', await under('Dată'))
    check('sub degetul de pe „Oră" e un input type=time', (await under('Oră')) === 'input:time', await under('Oră'))
    const look = await rowOf('Gest unu').locator('.swipe-right .swipe-btn').evaluateAll((bs) => bs.slice(0, 2).map((b) => getComputedStyle(b).backgroundColor))
    check('Dată și Oră au aceeași greutate (același fundal, fără accent)', look[0] === look[1], JSON.stringify(look))

    // Atingerea reală pe Oră: focus pe input, niciun showPicker, banda rămâne.
    const before = await timeOf('Gest unu')
    let b = await T.center(rowOf('Gest unu').locator('input[aria-label="Oră"]'))
    await T.tap(b.x, b.y)
    await touch.waitForTimeout(400)
    const focused = await touch.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    check('atingerea pe „Oră" ajunge pe input (focus), fără showPicker', focused === 'Oră' && (await touch.evaluate(() => window.__showPicker)) === 0, `focus=${focused}`)
    check('…anularea (fără change) nu schimbă nimic', (await timeOf('Gest unu')) === before && (await touch.locator('.date-sheet').count()) === 0, `ora="${await timeOf('Gest unu')}"`)

    // Ora aleasă: ce trimite selectorul sistemului la OK. „Oră" pune ora pe
    // AZI (sarcina e în „Azi"), iar o oră deja trecută azi o face restantă:
    // rândul arată atunci ziua ratată, nu ora. De-aia ora se alege în
    // viitorul PAGINII, nu fixă — un 21:45 fix pica de la 21:45 încolo. În
    // ultimele minute ale zilei nu mai e viitor; acolo rândul trebuie doar să
    // se fi schimbat (ziua ratată în locul golului).
    const pick = await touch.evaluate(() => {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      const mins = d.getHours() * 60 + d.getMinutes()
      const at = mins < 21 * 60 + 40 ? 21 * 60 + 45 : 23 * 60 + 59
      return { v: `${p(Math.floor(at / 60))}:${p(at % 60)}`, future: mins + 2 <= at }
    })
    const choose = (label, v) => rowOf('Gest unu').locator(`input[aria-label="${label}"]`).evaluate((el, val) => {
      el.value = val
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, v)
    await choose('Oră', pick.v)
    await touch.waitForTimeout(800)
    const toastT = ((await touch.locator('.toast').textContent()) ?? '').trim()
    const shownT = await timeOf('Gest unu')
    check(`ora aleasă (${pick.v}) se scrie pe rând`, pick.future ? shownT === pick.v : shownT !== before, `ora="${shownT}"`)
    check(`toastul spune „Mutat la ${pick.v}"`, toastT.includes(`Mutat la ${pick.v}`), `toast="${toastT}"`)
    check('…și banda s-a închis', !/show-right/.test((await rowOf('Gest unu').getAttribute('class')) ?? ''), (await rowOf('Gest unu').getAttribute('class')) ?? '')
    await touch.locator('.toast-act').click()
    await touch.waitForTimeout(800)
    check('„Anulează" întoarce ora de dinainte', (await timeOf('Gest unu')) === before, `ora="${await timeOf('Gest unu')}"`)

    // Data aleasă din bandă mută sarcina din „Azi".
    const target = await touch.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 3)
      const p = (n) => String(n).padStart(2, '0')
      return { v: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, shown: `${p(d.getDate())}/${p(d.getMonth() + 1)}` }
    })
    await openStrip('Gest unu')
    await choose('Dată', target.v)
    await touch.waitForTimeout(800)
    const toastD = ((await touch.locator('.toast').textContent()) ?? '').trim()
    check('data aleasă din bandă mută sarcina din „Azi"', !(await titles()).includes('Gest unu') && toastD.includes(`Mutat pe ${target.shown}`), `toast="${toastD}"`)
    await touch.locator('.toast-act').click()
    await touch.waitForTimeout(800)
    check('…„Anulează" o aduce înapoi', (await titles()).includes('Gest unu'), JSON.stringify(await titles()))

    // Glisarea completă spre stânga: foaia de dată (la ridicare nu e niciun
    // input sub deget), cu „Alege data…" ca input nativ real.
    const c2 = await T.center(rowOf('Gest doi'))
    const startX = c2.box.x + c2.box.width - 40
    await T.drag(startX, c2.y, startX - c2.box.width * 0.75, c2.y)
    await touch.waitForTimeout(600)
    const pickIn = await touch.locator('.date-sheet input').evaluateAll((is) => is.map((i) => `${i.type}:${i.getAttribute('aria-label')}`))
    check('glisarea completă spre stânga deschide foaia de dată cu inputuri native', (await touch.locator('.date-sheet').count()) === 1 && JSON.stringify(pickIn) === '["date:Alege data…","time:Oră…"]', JSON.stringify(pickIn))
    await touch.locator('.date-sheet input[aria-label="Alege data…"]').evaluate((el, val) => {
      el.value = val
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, target.v)
    await touch.waitForTimeout(800)
    const toast2 = ((await touch.locator('.toast').textContent()) ?? '').trim()
    check('…„Alege data…" mută sarcina și închide foaia', !(await titles()).includes('Gest doi') && toast2.includes(`Mutat pe ${target.shown}`) && (await touch.locator('.date-sheet').count()) === 0, `toast="${toast2}"`)
    await touch.locator('.toast-act').click()
    await touch.waitForTimeout(800)
    check('…„Anulează" o aduce înapoi', (await titles()).includes('Gest doi'), JSON.stringify(await titles()))
    check('niciun showPicker pe tot drumul', (await touch.evaluate(() => window.__showPicker)) === 0, String(await touch.evaluate(() => window.__showPicker)))
  }

  // O atingere scurtă deschide foaia și atât: temporizatorul apăsării lungi
  // se anulează la ridicare. Altfel, după 450 ms, vibra și intra în selecție
  // sub foaie — iar selecția își punea propria intrare, deci Back cerea două.
  {
    const c = await T.center(rowOf('Gest unu'))
    await T.tap(c.x, c.y)
    await touch.waitForTimeout(700)
    check('atingerea scurtă deschide foaia', (await touch.locator('.edit-sheet').count()) === 1, 'foaie deschisă')
    check('…fără să intre în selecție sub ea', !(await selecting()) && (await touch.locator('.task-row.selected').count()) === 0, (await selecting()) ? 'a intrat în selecție' : 'fără selecție')
    await touch.goBack()
    await touch.waitForTimeout(600)
    check('un singur Back închide foaia', (await touch.locator('.edit-sheet').count()) === 0, 'închisă')
    check('…și rămâi pe „Azi", fără selecție', (await touchOnAzi()) && !(await selecting()) && new URL(touch.url()).pathname === '/', `URL=${new URL(touch.url()).pathname}`)
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
  // „Azi", „7 zile" și „Ale mele" sunt tab-uri de sus, nu pagini una sub
  // alta: nicio săgeată în antet, ci ☰ (sertarul). Proiectele s-au mutat în
  // sertar; un proiect deschis de acolo stă peste „Azi" (`[Azi, proiect]`),
  // deci Back din el duce pe „Azi". Back-ul (gestul Android) urmează convenția
  // barei de jos: de pe orice tab → „Azi", de pe „Azi" → afară. Filă curată:
  // pornirea trebuie să fie chiar prima, iar `about:blank` din spate e „afară".
  {
    const nav = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await nav.goto(BASE, { waitUntil: 'networkidle' })
    await nav.waitForTimeout(800)
    const active = async () => ((await nav.locator('.tabbar button.on').textContent().catch(() => '')) ?? '').trim()
    const arrow = () => nav.locator('header .back').isVisible().catch(() => false)
    const tab = async (t) => { await nav.click(`[data-tab="${t}"]`); await nav.waitForTimeout(500) }
    const back = async () => { await nav.goBack().catch(() => null); await nav.waitForTimeout(600) }
    const path = () => new URL(nav.url()).pathname
    const drawerOpen = () => nav.locator('.drawer').count().then((n) => n > 0)
    const openDrawer = async () => { await nav.locator('.header-drawer-btn').click(); await nav.waitForTimeout(400) }

    check('telefon: pornirea aterizează pe „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)
    check('…fără săgeată pe „Azi", cu ☰', !(await arrow()) && (await nav.locator('.header-drawer-btn').isVisible()), 'antet')
    check('bara de jos are trei tab-uri, fără „Proiecte"', (await nav.locator('.tabbar button').count()) === 3 && (await nav.locator('[data-tab="projects"]').count()) === 0, `${await nav.locator('.tabbar button').count()} butoane`)
    for (const [t, label] of [['week', '7 zile'], ['inbox', 'Ale mele']]) {
      await tab(t)
      check(`fără săgeată pe „${label}"`, (await active()).includes(label) && !(await arrow()), `tab activ="${await active()}"`)
    }

    // Comutarea nu adună intrări: după două tab-uri, un singur Back e „Azi".
    await back()
    check('Back de pe „Ale mele" (după două tab-uri) → „Azi"', /Azi/.test(await active()) && path() === '/', `tab activ="${await active()}" URL=${path()}`)

    await tab('week')
    await back()
    check('Back de pe „7 zile" → „Azi"', /Azi/.test(await active()), `tab activ="${await active()}"`)

    // Sertarul: Back îl închide și atât — ecranul rămâne.
    await openDrawer()
    check('☰ deschide sertarul', await drawerOpen(), 'deschis')
    check('sertarul are intrare în istoric', await nav.evaluate(() => history.state?.hzSheet === 'drawer'), JSON.stringify(await nav.evaluate(() => history.state)))
    await back()
    check('Back închide sertarul', !(await drawerOpen()), (await drawerOpen()) ? 'a rămas deschis' : 'închis')
    check('…și rămâi pe „Azi", în aplicație', /Azi/.test(await active()) && nav.url().startsWith(BASE), `tab activ="${await active()}" URL=${nav.url()}`)

    // Fundalul îl închide fără să lase o intrare moartă.
    await openDrawer()
    await nav.mouse.click(370, 400)
    await nav.waitForTimeout(500)
    const afterBg = await nav.evaluate(() => ({ marked: history.state?.hzSheet ?? null, depth: history.state?.hzDepth ?? 0 }))
    check('fundalul închide sertarul fără intrare moartă', !(await drawerOpen()) && afterBg.marked === null && afterBg.depth === 0, JSON.stringify(afterBg))

    // Un rând din sertar navighează, iar Back NU redeschide sertarul.
    await openDrawer()
    await nav.locator('.dr-row', { hasText: '7 zile' }).click()
    await nav.waitForTimeout(700)
    check('rândul „7 zile" din sertar duce pe „7 zile"', (await active()).includes('7 zile') && !(await drawerOpen()), `tab activ="${await active()}"`)
    await back()
    check('…Back de acolo → „Azi", fără sertar', /Azi/.test(await active()) && !(await drawerOpen()), `tab activ="${await active()}" sertar=${await drawerOpen()}`)

    // Proiect din sertar: `[Azi, proiect]`. În antet ☰, nu săgeată.
    await openDrawer()
    await nav.locator('.dr-projects .dr-row').first().click()
    await nav.waitForTimeout(800)
    check('proiectul din sertar se deschide', path().startsWith('/project/') && !(await drawerOpen()), `URL=${path()}`)
    check('…cu ☰ în antet, nu săgeată', !(await arrow()) && (await nav.locator('.header-drawer-btn').isVisible()), 'antet')
    await back()
    check('Back din proiectul deschis din sertar → „Azi"', /Azi/.test(await active()) && path() === '/' && !(await drawerOpen()), `tab activ="${await active()}" URL=${path()}`)
    const rootDepth = await nav.evaluate(() => history.state?.hzDepth ?? 0)
    check('…pe rădăcina istoricului', rootDepth === 0, `hzDepth=${rootDepth}`)

    // Din proiect, sertarul → alt ecran: stiva se reclădește, nu se adună.
    await openDrawer()
    await nav.locator('.dr-projects .dr-row').first().click()
    await nav.waitForTimeout(800)
    await openDrawer()
    await nav.locator('.dr-row', { hasText: 'Ale mele' }).click()
    await nav.waitForTimeout(700)
    await back()
    check('proiect → sertar → „Ale mele" → Back = „Azi"', /Azi/.test(await active()) && path() === '/', `tab activ="${await active()}" URL=${path()}`)

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

  // ── Sertarul cu degetul: marginea stângă și fixarea prin apăsare lungă ──
  // Tragerea din margine trece prin `lockAxis`, ca rândurile; apăsarea lungă
  // pe un rând deschide meniul (iar click-ul ridicării NU îl închide pe loc),
  // „Fixează sus" pune pătratul în rândul de sus, iar pătratul duce la proiect.
  {
    const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const dp = await dctx.newPage()
    await dp.goto(BASE, { waitUntil: 'networkidle' })
    await dp.waitForTimeout(800)
    const t = await touchApi(dp)
    const open = () => dp.locator('.drawer').count().then((n) => n > 0)
    await t.drag(200, 420, 200, 300)
    await dp.waitForTimeout(300)
    check('o tragere verticală nu deschide sertarul', !(await open()), 'închis')
    await t.drag(8, 420, 170, 426)
    await dp.waitForTimeout(400)
    check('tragerea din marginea stângă deschide sertarul', await open(), (await open()) ? 'deschis' : 'închis')
    // Închiderea prin tragere spre stânga, pe sertarul însuși (nu pe fundal).
    await t.drag(250, 500, 60, 504)
    await dp.waitForTimeout(500)
    check('tragerea spre stânga pe sertar îl închide', !(await open()), (await open()) ? 'a rămas deschis' : 'închis')
    await t.drag(8, 420, 170, 426)
    await dp.waitForTimeout(400)
    const row = await t.center(dp.locator('.dr-projects .dr-row').first())
    await t.longPress(row.x, row.y)
    await dp.waitForTimeout(400)
    const menuOpen = (await dp.locator('.as-item', { hasText: 'Fixează sus' }).count()) > 0
    check('apăsarea lungă pe proiect deschide meniul de fixare', menuOpen, menuOpen ? 'meniu' : 'nimic')
    if (menuOpen) {
      await dp.locator('.as-item', { hasText: 'Fixează sus' }).click()
      await dp.waitForTimeout(400)
      check('fixarea pune pătratul sus, sertarul rămâne deschis', (await dp.locator('.dr-pin').count()) === 1 && (await open()), `${await dp.locator('.dr-pin').count()} pătrate`)
      await dp.locator('.dr-pin').first().click()
      await dp.waitForTimeout(800)
      check('pătratul fixat duce la proiect', new URL(dp.url()).pathname.startsWith('/project/') && !(await open()), new URL(dp.url()).pathname)
      await dp.goBack()
      await dp.waitForTimeout(600)
      check('…iar Back de acolo → „Azi"', new URL(dp.url()).pathname === '/' && /Azi/.test((await dp.locator('.tabbar button.on').textContent()) ?? ''), new URL(dp.url()).pathname)
    }
    await dctx.close()
  }

  // ── Banda de valuri vs. sertarul din margine ──────────────────────────
  // Pe telefon banda derulează orizontal și începe la marginea paginii, în
  // zona din care se trage sertarul (`EDGE_PX`). O tragere spre dreapta pe ea
  // e derulare, nu sertar (`onBand` din App.tsx).
  {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const bp = await bctx.newPage()
    await bp.goto(BASE, { waitUntil: 'networkidle' })
    await bp.waitForTimeout(800)
    await bp.locator('.header-drawer-btn').click()
    await bp.waitForTimeout(400)
    await bp.locator('.dr-projects .dr-row', { hasText: 'Exemplu' }).first().click()
    await bp.waitForTimeout(800)
    await bp.locator('.tab', { hasText: /^List/ }).first().click()
    await bp.waitForTimeout(500)
    const band = await bp.locator('.wb-pills').boundingBox()
    check('banda de valuri e pe ecran (proiectul are 2 valuri)', Boolean(band), band ? `${Math.round(band.x)}px de la margine` : 'lipsește')
    if (band) {
      const t = await touchApi(bp)
      const y = band.y + band.height / 2
      await t.drag(Math.max(band.x + 4, 16), y, 190, y + 4)
      await bp.waitForTimeout(400)
      const opened = (await bp.locator('.drawer').count()) > 0
      check('o glisare orizontală pe bandă nu deschide sertarul', !opened, opened ? 'S-A DESCHIS sertarul' : 'închis')
      if (opened) { await bp.goBack(); await bp.waitForTimeout(300) }
      // Sub bandă, aceeași tragere din margine deschide sertarul ca înainte.
      await t.drag(8, y + 220, 170, y + 226)
      await bp.waitForTimeout(400)
      check('…dar din margine, sub bandă, sertarul se deschide', (await bp.locator('.drawer').count()) > 0, 'deschis')
    }
    await bctx.close()
  }

  // ── Filtrele salvate: „+ Filtru" din sertar → ecranul filtrului → Back ──
  // Salvarea deschide filtrul ca tab de sus (`[Azi, filtru]`), deci Back duce
  // pe „Azi", nu afară din aplicație — editorul cere navigarea după ce s-a
  // închis, altfel rescria rădăcina. Rândurile sunt grupate pe proiect.
  {
    const fp = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await fp.goto(BASE, { waitUntil: 'networkidle' })
    await fp.waitForTimeout(800)
    await fp.locator('.header-drawer-btn').click()
    await fp.waitForTimeout(400)
    await fp.locator('.dr-filters .dr-add').click()
    await fp.waitForTimeout(500)
    check('„+ Filtru" deschide editorul', (await fp.locator('.filter-form').count()) === 1 && (await fp.locator('.drawer').count()) === 0, 'editor deschis, sertar închis')
    await fp.keyboard.type('Fără dată')
    await fp.locator('.filter-form .chip', { hasText: 'Fără dată' }).click()
    const preview = ((await fp.locator('.ff-preview').textContent()) ?? '').trim()
    check('editorul numără live', /^\d+ tichet/.test(preview), preview)
    await fp.locator('.sh-save').click()
    await fp.waitForTimeout(900)
    // Numărul din antet (`.hcount`) stă în același <h1> — numai numele.
    const h1 = ((await fp.locator('header h1').evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))) ?? '').trim()
    const groups = await fp.locator('.filter-group').count()
    check('salvarea deschide ecranul filtrului', h1 === 'Fără dată' && (await fp.locator('.filter-form').count()) === 0, `antet="${h1}"`)
    check('…cu rândurile grupate pe proiect', groups >= 1 && (await fp.locator('.filter-group .task-row').count()) >= 1, `${groups} grupe`)
    check('…fără FAB', (await fp.locator('.fab').count()) === 0, 'fără buton de adăugare')
    const st = await fp.evaluate(() => history.state)
    check('filtrul stă peste „Azi" în istoric', st?.hzDepth === 1 && String(st?.hzScreen).startsWith('filter:'), JSON.stringify(st))
    await fp.goBack()
    await fp.waitForTimeout(600)
    check('Back de pe filtru → „Azi"', /Azi/.test((await fp.locator('.tabbar button.on').textContent()) ?? '') && fp.url().startsWith(BASE), fp.url())
    await fp.reload({ waitUntil: 'networkidle' })
    await fp.waitForTimeout(800)
    await fp.locator('.header-drawer-btn').click()
    await fp.waitForTimeout(400)
    check('filtrul rămâne în sertar după reîncărcare', (await fp.locator('.dr-filters .dr-row', { hasText: 'Fără dată' }).count()) === 1, 'listat')
    await fp.close()
  }

  // ── Căsuțele din descriere: un click bifează rândul LUI, nu pe următorul ──
  // ROUTIN-08: ținta de atins a căsuței (`.md-task::after`) era 44px și pe
  // verticală, peste un rând de ~22px; a căsuței de dedesubt, mai târziu în
  // DOM, stătea deasupra, deci jumătatea de jos a fiecărei căsuțe era a
  // rândului următor. Click real, pe panou (1440), modal (1000) și foaie (390).
  {
    const DESC = '- [ ] Intretinere - ebloc \n- [ ] Convertește revolut dolari cont Simona și eu \n- [ ] Card de credit ING\n- [ ] taxa gunoi cisnadie - T a x e si i m p o z i t e 64 RON/luna  https://mail.google.com/mail/u/1/#inbox/FMfcgzQgLrqbMKgGNPxtjwVBrMBLhQKq\n- [ ] Eon\n- [ ] DIGI\n'
    const marks = (s) => [...s.matchAll(/\[(.)\]/g)].map((m) => (m[1] === ' ' ? '.' : 'x')).join('')
    for (const [where, viewport, scope] of [
      ['panou', { width: 1440, height: 900 }, '.split-pane'],
      ['modal', { width: 1000, height: 800 }, '.sheet.on'],
      ['foaie', { width: 390, height: 844 }, '.edit-sheet'],
    ]) {
      const tp = await browser.newPage({ viewport })
      await tp.goto(BASE, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(700)
      const id = await tp.evaluate((d) => {
        const db = JSON.parse(localStorage.getItem('horizontal:v2'))
        const i = db.issues.find((x) => x.projectId !== 'd')
        i.desc = d
        localStorage.setItem('horizontal:v2', JSON.stringify(db))
        return i.id
      }, DESC)
      await tp.goto(`${BASE}/${id}`, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(1500)
      // Fiecare punct din căsuță (și 10px în lateral) trebuie să lovească
      // căsuța ei — nu o măsurătoare de lățime, ci cine primește click-ul.
      const stray = await tp.evaluate((sc) => {
        const out = []
        document.querySelectorAll(`${sc} .md-task`).forEach((b, i) => {
          const r = b.getBoundingClientRect()
          for (let dy = 0; dy <= r.height; dy++) for (const dx of [-10, r.width / 2, r.width + 10]) {
            const hit = document.elementFromPoint(r.x + dx, r.y + dy)?.closest('.md-task')
            if (hit && hit !== b) { out.push(`#${i + 1}@${dy}px`); return }
          }
        })
        return out
      }, scope)
      check(`descriere (${where}): fiecare căsuță își primește singură click-ul`, stray.length === 0, stray.length ? `lovesc vecina: ${stray.join(' ')}` : 'fără suprapuneri')
      const b = await tp.locator(`${scope} .md-task`).nth(2).boundingBox()
      // Jumătatea de jos: acolo stătea ținta rândului următor.
      await tp.mouse.click(b.x + b.width / 2, b.y + b.height - 3)
      await tp.waitForTimeout(400)
      const got = marks(await descOf(tp, scope))
      check(`descriere (${where}): click pe a 3-a căsuță bifează doar a 3-a`, got === '..x...', got)
      await tp.close()
    }
  }

  // ── D-187: pe telefon, cu descrierea în lucru, căsuța „nu mergea" ──
  // Cât descrierea are focus, Gboard ține cuvântul de sub cursor în compunere,
  // iar atingerea căsuței nu mută cursorul, deci compunerea rămâne. Pluginul
  // doar muta decorările cât `view.composing`: documentul se bifa (și se
  // salva), căsuța rămânea desenată goală, iar a doua atingere o debifa pe
  // ascuns. Atingeri reale (CDP), compunerea prin `Input.imeSetComposition`;
  // foaia de tichet și formularul complet, cu o descriere scurtă și una pliată.
  {
    const SHORT = '- [ ] unu\n- [ ] doi\n- [ ] trei\n'
    const LONG = SHORT + Array.from({ length: 40 }, (_, i) => `- [ ] rândul ${i + 4}`).join('\n')
    const marks = (s) => [...s.matchAll(/\[(.)\]/g)].map((m) => (m[1] === ' ' ? '.' : 'x')).join('').slice(0, 3)
    for (const [len, DESC] of [['scurtă', SHORT], ['pliată', LONG]]) for (const full of [false, true]) {
      const where = `${full ? 'formular' : 'foaie'}, ${len}`
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const tp = await ctx.newPage()
      await tp.goto(BASE, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(700)
      const id = await tp.evaluate((d) => {
        const db = JSON.parse(localStorage.getItem('horizontal:v2'))
        const i = db.issues.find((x) => x.projectId !== 'd')
        i.desc = d
        localStorage.setItem('horizontal:v2', JSON.stringify(db))
        return i.id
      }, DESC)
      await tp.goto(`${BASE}/${id}`, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(1500)
      const { tap, center } = await touchApi(tp)
      let scope = '.edit-sheet'
      if (full) {
        const m = await center(tp.locator('.edit-sheet .qs-more'))
        await tap(m.x, m.y)
        await tp.waitForTimeout(900)
        scope = '.sheet.on'
      }
      const box = (i) => tp.locator(`${scope} .md-task`).nth(i)
      const drawn = () => tp.evaluate((s) => [...document.querySelectorAll(`${s} .md-task`)].slice(0, 3).map((b) => (b.classList.contains('on') ? 'x' : '.')).join(''), scope)
      // Fără focus: atingerea bifează căsuța ei.
      let c = await center(box(1))
      await tap(c.x, c.y)
      await tp.waitForTimeout(400)
      check(`atingere (${where}), fără focus: bifează a 2-a`, marks(await descOf(tp, scope)) === '.x.' && (await drawn()) === '.x.', `doc=${marks(await descOf(tp, scope))} desen=${await drawn()}`)
      await tap(c.x, c.y)
      await tp.waitForTimeout(400)
      // Cu focus și un cuvânt în compunere, ca pe Android.
      let l1 = await tp.locator(`${scope} .cm-line`).first().boundingBox()
      // Pliată, prima atingere doar o arată întreagă (D-196); a doua scrie.
      // Desfăcută, foaia crește și rândul se poate muta: se măsoară din nou.
      if (len === 'pliată') {
        await tap(l1.x + l1.width - 4, l1.y + l1.height / 2)
        await tp.waitForTimeout(300)
        l1 = await tp.locator(`${scope} .cm-line`).first().boundingBox()
      }
      await tap(l1.x + l1.width - 4, l1.y + l1.height / 2)
      await tp.waitForTimeout(300)
      const cdp = await ctx.newCDPSession(tp)
      await cdp.send('Input.imeSetComposition', { text: 'ab', selectionStart: 2, selectionEnd: 2 })
      await tp.waitForTimeout(200)
      c = await center(box(1))
      await tap(c.x, c.y)
      await tp.waitForTimeout(400)
      check(`atingere (${where}), în compunere: căsuța se desenează bifată`, marks(await descOf(tp, scope)) === '.x.' && (await drawn()) === '.x.', `doc=${marks(await descOf(tp, scope))} desen=${await drawn()}`)
      c = await center(box(1))
      await tap(c.x, c.y)
      await tp.waitForTimeout(400)
      check(`…a doua atingere o debifează, la vedere`, marks(await descOf(tp, scope)) === '...' && (await drawn()) === '...', `doc=${marks(await descOf(tp, scope))} desen=${await drawn()}`)
      await cdp.send('Input.insertText', { text: 'abc' })
      await tp.waitForTimeout(300)
      check(`…și cuvântul compus rămâne întreg`, (await descOf(tp, scope)).startsWith('- [ ] unuabc\n'), JSON.stringify((await descOf(tp, scope)).slice(0, 14)))
      await ctx.close()
    }
  }

  // ── D-196: descrierea pliată se citește întâi, se scrie după ─────────────
  // Pe telefon, cu „Arată tot", o atingere pe text o arăta întreagă ȘI ridica
  // tastatura (focus în editor). Acum prima atingere doar o desface; abia pe
  // textul întreg atingerea pune cursorul. Foaia de tichet și formularul
  // complet, cu atingeri reale (CDP). `NAV_SHOTS=<dosar>`: capturi la 390px.
  {
    const SHOTS = process.env.NAV_SHOTS
    const LONG = Array.from({ length: 45 }, (_, i) => `Rândul ${i + 1} din descrierea lungă, cu text cât să se citească.`).join('\n')
    const shoot = async (tp, name) => {
      if (!SHOTS) return
      for (const theme of ['dark', 'light']) {
        await tp.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
        await tp.waitForTimeout(300)
        await tp.screenshot({ path: `${SHOTS}/${name}-390-${theme}.png` })
      }
    }
    for (const full of [false, true]) {
      const where = full ? 'formular' : 'foaie'
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' })
      const tp = await ctx.newPage()
      await tp.goto(BASE, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(700)
      const id = await tp.evaluate((d) => {
        const db = JSON.parse(localStorage.getItem('horizontal:v2'))
        const i = db.issues.find((x) => x.projectId !== 'd')
        i.desc = d
        localStorage.setItem('horizontal:v2', JSON.stringify(db))
        return i.id
      }, LONG)
      await tp.goto(`${BASE}/${id}`, { waitUntil: 'networkidle' })
      await tp.waitForTimeout(1500)
      const { tap, center } = await touchApi(tp)
      let scope = '.edit-sheet'
      if (full) {
        const m = await center(tp.locator('.edit-sheet .qs-more'))
        await tap(m.x, m.y)
        await tp.waitForTimeout(900)
        scope = '.sheet.on'
      }
      await tp.locator(`${scope} .cm-line`).first().waitFor({ timeout: 5000 })
      const expanded = () => tp.locator(`${scope} .desc-more`).getAttribute('aria-expanded').catch(() => null)
      const inEditor = () => tp.evaluate(() => !!document.activeElement?.closest('.md-editor'))
      check(`D-196 (${where}): descrierea lungă pornește pliată`, (await expanded()) === 'false', `aria-expanded=${await expanded()}`)
      if (!full) await shoot(tp, 'desc-folded')
      // Pe un rând din mijlocul textului, nu pe „Arată tot".
      const line = await center(tp.locator(`${scope} .cm-line`).nth(3))
      await tap(line.x, line.y)
      await tp.waitForTimeout(400)
      check(`D-196 (${where}): prima atingere pe text o arată întreagă`, (await expanded()) === 'true', `aria-expanded=${await expanded()}`)
      check(`D-196 (${where}): …fără focus în editor (fără tastatură)`, !(await inEditor()), `activ=${await tp.evaluate(() => document.activeElement?.className)}`)
      if (!full) await shoot(tp, 'desc-expanded')
      const line2 = await center(tp.locator(`${scope} .cm-line`).nth(3))
      await tap(line2.x, line2.y)
      await tp.waitForTimeout(400)
      check(`D-196 (${where}): a doua atingere pune cursorul`, await inEditor(), `activ=${await tp.evaluate(() => document.activeElement?.className)}`)
      if (!full) await shoot(tp, 'desc-editing')
      await ctx.close()
    }
  }

  // ── D-197: data din foaia de tichet ─────────────────────────────────────
  // Jetonul de dată deschide același panou ca formularul complet (presetări,
  // butoanele de zi și de oră = calendarul / ceasul sistemului sub deget), ca
  // foaie de jos — fără câmp de scris și fără textul nativ (`10/16/2026`).
  // „Mâine" scrie pe loc (autosave), verificat în baza locală.
  {
    const SHOTS = process.env.NAV_SHOTS
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' })
    const tp = await ctx.newPage()
    await tp.goto(BASE, { waitUntil: 'networkidle' })
    await tp.waitForTimeout(700)
    await tp.locator('.fab').click()
    await tp.waitForTimeout(400)
    await tp.keyboard.type('Sarcină pentru panoul de dată')
    await tp.keyboard.press('Enter')
    await tp.waitForTimeout(1000)
    const { tap, center } = await touchApi(tp)
    const r = await center(tp.locator('.task-row', { hasText: 'Sarcină pentru panoul de dată' }).first())
    await tap(r.x, r.y)
    await tp.waitForTimeout(900)
    const chip = await center(tp.locator('.edit-sheet .qs-due'))
    await tap(chip.x, chip.y)
    await tp.waitForTimeout(500)
    const pop = tp.locator('.fc-sheet.es-due-pop')
    check('D-197: jetonul de dată deschide panoul ca foaie de jos', (await pop.count()) === 1, `${await pop.count()} panouri`)
    const shown = await pop.evaluate((el) => ({
      text: el.innerText,
      typed: el.querySelectorAll('input:not([type=date]):not([type=time])').length,
      day: el.querySelector('.fc-pick-date .fc-pick-t')?.textContent ?? null,
      nativeVisible: [...el.querySelectorAll('input[type=date], input[type=time]')].filter((i) => getComputedStyle(i).opacity !== '0').length,
      presets: [...el.querySelectorAll('.fc-pre')].map((b) => b.firstChild.textContent),
    })).catch(() => null)
    check('D-197: presetările Azi · Mâine · Luni · +1 săpt.', shown?.presets.join('|') === 'Azi|Mâine|Luni|+1 săpt.', JSON.stringify(shown?.presets))
    check('D-197: fără câmp de scris și fără text nativ — butonul spune ziua', !!shown && shown.typed === 0 && shown.nativeVisible === 0 && !/--:--|\b(AM|PM)\b|\d{2}\/\d{2}\/\d{4}/.test(shown.text) && shown.day === 'Azi',
      JSON.stringify({ day: shown?.day, typed: shown?.typed }))
    if (SHOTS) for (const theme of ['dark', 'light']) {
      await tp.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      await tp.waitForTimeout(300)
      await tp.screenshot({ path: `${SHOTS}/sheet-date-panel-390-${theme}.png` })
    }
    const want = await tp.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    const mBtn = await center(pop.locator('.fc-pre', { hasText: 'Mâine' }))
    await tap(mBtn.x, mBtn.y)
    await tp.waitForTimeout(800)
    const stored = await tp.evaluate(() => {
      const i = JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((x) => x.title === 'Sarcină pentru panoul de dată')
      if (!i?.dueAt) return null
      const d = new Date(i.dueAt)
      return { day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, allDay: i.allDay }
    })
    check('D-197: „Mâine" din foaie scrie data pe loc', stored?.day === want, `${JSON.stringify(stored)} vs ${want}`)
    const dayBtn = await pop.locator('.fc-pick-date .fc-pick-t').textContent().catch(() => null)
    check('…și butonul de zi spune „Mâine"', dayBtn === 'Mâine', JSON.stringify(dayBtn))
    const chipText = (await tp.locator('.edit-sheet .qs-due').textContent().catch(() => '')) ?? ''
    check('…iar jetonul spune „Mâine"', /Mâine/.test(chipText), JSON.stringify(chipText))
    // Ceasul (inputul nativ sub butonul de oră) pleacă imediat. Ce trimite
    // selectorul la OK: valoarea + `change`, ca la „Oră" din bandă. (Nu
    // `fill`: Chromium refuză o valoare pusă din script pe un input de oră
    // focusat a cărui valoare s-a pus în `focusin` — `prime` —, deși
    // selectorul și tastele merg.)
    const choose = (sel, v) => pop.locator(sel).evaluate((el, val) => {
      el.blur()
      el.value = val
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, v)
    await choose('.fc-pick-time input[type=time]', '17:30')
    await tp.waitForTimeout(800)
    const t = await tp.evaluate(() => {
      const i = JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((x) => x.title === 'Sarcină pentru panoul de dată')
      const d = new Date(i.dueAt)
      return `${d.getHours()}:${d.getMinutes()} allDay=${i.allDay}`
    })
    check('D-197: ora aleasă din ceas se salvează (24h)', t === '17:30 allDay=false', t)
    const timeBtn = await pop.locator('.fc-pick-time .fc-pick-t').textContent().catch(() => null)
    check('…și butonul de oră spune 17:30', timeBtn === '17:30', JSON.stringify(timeBtn))
    if (SHOTS) for (const theme of ['dark', 'light']) {
      await tp.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await tp.waitForTimeout(300)
      await tp.screenshot({ path: `${SHOTS}/sheet-date-panel-time-390-${theme}.png` })
    }
    // ✕ de lângă oră = toată ziua, ziua rămâne.
    const x = await center(pop.locator('.fc-pick-x'))
    await tap(x.x, x.y)
    await tp.waitForTimeout(800)
    const cleared = await tp.evaluate(() => {
      const i = JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((x) => x.title === 'Sarcină pentru panoul de dată')
      const d = new Date(i.dueAt)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} allDay=${i.allDay}`
    })
    check('D-197: ✕ de lângă oră lasă ziua, toată ziua', cleared === `${want} allDay=true`, cleared)
    // Calendarul (inputul nativ sub butonul de zi) scrie ziua aleasă.
    const pick = await tp.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 10); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    await choose('.fc-pick-date input[type=date]', pick)
    await tp.waitForTimeout(800)
    const picked = await tp.evaluate(() => {
      const i = JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((x) => x.title === 'Sarcină pentru panoul de dată')
      const d = new Date(i.dueAt)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    check('D-197: ziua aleasă din calendar se salvează', picked === pick, `${picked} vs ${pick}`)
    await ctx.close()
  }

  // ── Data din foaia rapidă ───────────────────────────────────────────────
  // Jetonul de dată al capturii deschide același `DuePanel` (inline, deasupra
  // rândului), nu fâșia cu două inputuri native. Nimic nu se scrie până la
  // Trimite: „Mâine" pune data în ciornă (bate data listei), titlul își
  // păstrează focusul (tastatura rămâne), iar sarcina trimisă e pe mâine.
  {
    const SHOTS = process.env.NAV_SHOTS
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' })
    const qp = await ctx.newPage()
    await qp.goto(BASE, { waitUntil: 'networkidle' })
    await qp.waitForTimeout(700)
    const { tap, center } = await touchApi(qp)
    const fab = await center(qp.locator('.fab'))
    await tap(fab.x, fab.y)
    await qp.waitForTimeout(400)
    const chip = await center(qp.locator('.quick-sheet .qs-due'))
    await tap(chip.x, chip.y)
    await qp.waitForTimeout(300)
    const pan = qp.locator('.quick-sheet .qs-when')
    const shown = await pan.evaluate((el) => ({
      text: el.innerText,
      typed: el.querySelectorAll('input:not([type=date]):not([type=time])').length,
      day: el.querySelector('.fc-pick-date .fc-pick-t')?.textContent ?? null,
      nativeVisible: [...el.querySelectorAll('input[type=date], input[type=time]')].filter((i) => getComputedStyle(i).opacity !== '0').length,
      presets: [...el.querySelectorAll('.fc-pre')].map((b) => b.firstChild.textContent),
      reminder: !!el.querySelector('.fc-seg'),
    })).catch(() => null)
    check('foaia rapidă: jetonul de dată deschide panoul (Azi · Mâine · Luni · +1 săpt.)', shown?.presets.join('|') === 'Azi|Mâine|Luni|+1 săpt.', JSON.stringify(shown?.presets))
    check('…fără câmp de scris, fără text nativ și fără memento', !!shown && shown.typed === 0 && shown.nativeVisible === 0 && !shown.reminder && !/--:--|\b(AM|PM)\b/.test(shown.text) && !!shown.day,
      JSON.stringify({ day: shown?.day, typed: shown?.typed }))
    const want = await qp.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    const mBtn = await center(pan.locator('.fc-pre', { hasText: 'Mâine' }))
    await tap(mBtn.x, mBtn.y)
    await qp.waitForTimeout(300)
    const inTitle = await qp.evaluate(() => document.activeElement?.classList.contains('qa-input') ?? false)
    check('…„Mâine" lasă focusul în titlu (tastatura rămâne)', inTitle, String(inTitle))
    const chipText = (await qp.locator('.quick-sheet .qs-due').textContent().catch(() => '')) ?? ''
    check('…iar jetonul spune „Mâine"', /Mâine/.test(chipText), JSON.stringify(chipText))
    const before = await qp.evaluate(() => JSON.parse(localStorage.getItem('horizontal:v2')).issues.length)
    await qp.keyboard.type('Captură din panoul de dată')
    if (SHOTS) for (const theme of ['dark', 'light']) {
      await qp.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      await qp.waitForTimeout(300)
      await qp.screenshot({ path: `${SHOTS}/quick-date-panel-390-${theme}.png` })
    }
    const nothingYet = await qp.evaluate(() => JSON.parse(localStorage.getItem('horizontal:v2')).issues.length)
    check('…nimic nu se scrie înainte de Trimite', nothingYet === before, `${before} → ${nothingYet}`)
    const send = await center(qp.locator('.quick-sheet .qs-send'))
    await tap(send.x, send.y)
    await qp.waitForTimeout(900)
    const stored = await qp.evaluate(() => {
      const i = JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((x) => x.title === 'Captură din panoul de dată')
      if (!i?.dueAt) return null
      const d = new Date(i.dueAt)
      return { day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, allDay: i.allDay }
    })
    check('foaia rapidă: sarcina trimisă e pe mâine', stored?.day === want, `${JSON.stringify(stored)} vs ${want}`)
    await ctx.close()
  }

  // ── Mutarea în alt proiect (telefon, modul local) ───────────────────────
  // Spec: foaia rămâne deschisă pe ID-ul NOU, URL-ul se rescrie (fără intrare
  // nouă în istoric), iar Back te lasă pe lista de dinainte — nu pe `/EX-…`,
  // un tichet care nu mai există. Din formularul complet, mutarea înapoi îl
  // remontează pe proiectul țintă. Filă curată, cu un al doilea proiect pus în
  // baza locală.
  {
    const mv = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await mv.goto(BASE, { waitUntil: 'networkidle' })
    await mv.waitForTimeout(600)
    await mv.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('horizontal:v2'))
      db.projects.push({ id: 'apo', name: 'Apologetica', description: '', prefix: 'APO', currentWave: 1, accent: '#a855f7', type: 'personal' })
      db.waves.push({ projectId: 'apo', number: 1, name: 'Val 1', label: '', position: 1 })
      localStorage.setItem('horizontal:v2', JSON.stringify(db))
    })
    await mv.reload({ waitUntil: 'networkidle' })
    await mv.waitForTimeout(800)
    const onAziMv = async () => /Azi/.test((await mv.locator('.tabbar button.on').textContent().catch(() => '')) ?? '')
    await mv.locator('.fab').click()
    await mv.waitForTimeout(400)
    await mv.keyboard.type('Sarcină de mutat')
    await mv.keyboard.press('Enter')
    await mv.waitForTimeout(1000)
    await mv.locator('.task-row', { hasText: 'Sarcină de mutat' }).first().click()
    await mv.waitForTimeout(900)
    const before = new URL(mv.url()).pathname
    check('mutare: foaia de tichet deschisă pe ID-ul vechi', /^\/EX-\d+$/.test(before), `URL=${before}`)
    const depth = await mv.evaluate(() => history.length)
    await mv.locator('.edit-sheet button.qs-proj').click()
    await mv.waitForTimeout(400)
    const names = await mv.locator('.move-sheet .mv-item').allTextContents()
    check('mutare: foaia mică arată celelalte proiecte', names.length === 1 && /Apologetica/.test(names[0]), JSON.stringify(names))
    await mv.locator('.move-sheet .mv-item', { hasText: 'Apologetica' }).click()
    await mv.waitForTimeout(900)
    const meta = (await mv.locator('.edit-sheet .es-meta').textContent().catch(() => ''))?.trim()
    check('mutare: foaia rămâne deschisă, pe ID-ul nou', (await mv.locator('.edit-sheet').count()) === 1 && meta === 'APO-01', `ID=${meta}`)
    check('mutare: foaia mică s-a închis', (await mv.locator('.move-sheet').count()) === 0, 'închisă')
    check('mutare: URL rescris, fără intrare nouă', new URL(mv.url()).pathname === '/APO-01' && (await mv.evaluate(() => history.length)) === depth, `URL=${new URL(mv.url()).pathname}, istoric ${depth} → ${await mv.evaluate(() => history.length)}`)
    const toast = (await mv.locator('.toast').textContent().catch(() => '')) ?? ''
    check('mutare: confirmarea spune unde și cu ce număr', toast.includes('Mutat în „Apologetica" ca APO-01.'), JSON.stringify(toast))
    const chip = (await mv.locator('.edit-sheet .qs-proj').textContent().catch(() => '')) ?? ''
    check('mutare: jetonul arată proiectul nou', /Apologetica/.test(chip), JSON.stringify(chip))

    // „…" → formularul complet, apoi înapoi în Exemplu din meniul de lângă ID.
    await mv.locator('.edit-sheet .qs-more').click()
    await mv.waitForTimeout(700)
    await mv.locator('.sheet.on .sh-move-btn').click()
    await mv.waitForTimeout(400)
    await mv.locator('.fc-sheet .mv-item', { hasText: 'Exemplu' }).click()
    await mv.waitForTimeout(900)
    const formId = (await mv.locator('.sheet.on .sh-id').textContent().catch(() => ''))?.trim()
    check('mutare din formular: formularul urmează tichetul', /^EX-\d+$/.test(formId ?? '') && new URL(mv.url()).pathname === `/${formId}`, `ID=${formId} URL=${new URL(mv.url()).pathname}`)
    const formProj = (await mv.locator('.sheet.on .sh-move-btn').textContent().catch(() => '')) ?? ''
    check('…remontat pe proiectul țintă', /Exemplu/.test(formProj), JSON.stringify(formProj))

    await mv.goBack()
    await mv.waitForTimeout(700)
    check('mutare: Back te lasă pe lista de dinainte', (await mv.locator('.sheet.on, .edit-sheet').count()) === 0 && (await onAziMv()) && new URL(mv.url()).pathname === '/', `URL=${new URL(mv.url()).pathname}`)
    const still = await mv.locator('.task-row', { hasText: 'Sarcină de mutat' }).count()
    check('mutare: sarcina rămâne în „Azi", o singură dată', still === 1, `${still} rânduri`)
    await mv.close()
  }

  // Refuzul: un tichet cu dependențe arată motivul în locul listei (desktop,
  // meniul de lângă ID din panoul docat).
  {
    const rf = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await rf.goto(`${BASE}/EX-02`, { waitUntil: 'networkidle' })
    await rf.waitForTimeout(1200)
    await rf.locator('.sh-move-btn').first().click()
    await rf.waitForTimeout(400)
    const why = (await rf.locator('.mv-pop .mv-why').textContent().catch(() => '')) ?? ''
    check('mutare refuzată: motivul în locul listei', why.includes('Nu se poate muta EX-02: are dependențe'), JSON.stringify(why))
    check('…fără proiecte de ales', (await rf.locator('.mv-pop .mv-item').count()) === 0, 'listă ascunsă')
    await rf.close()
  }

  // ── Modul Vim (src/vim.tsx): cursorul, panoul care urmează, „Listă", oprit ──
  // Cursorul nu e o clasă pe rând: `VimStatus` scrie o regulă CSS pe id. Testul
  // îl citește de acolo, ca să nu depindă de culori.
  {
    const cursorOf = (pg) => pg.evaluate(() => {
      for (const st of document.querySelectorAll('style')) {
        const m = st.textContent.match(/list-row\[data-issue-id="([^"]+)"\]/)
        if (m) return m[1]
      }
      return null
    })
    const listRows = (pg) => pg.evaluate(() => [...document.querySelectorAll('main .list-row[data-issue-id]')]
      .filter((el) => !el.closest('.split-pane'))
      .map((el) => {
        const g = el.closest('.list-group')
        return { id: el.getAttribute('data-issue-id'), group: g ? [...document.querySelectorAll('main .list-group')].indexOf(g) : -1 }
      }))
    const dockedId = (pg) => pg.evaluate(() => document.querySelector('main .list-row.docked')?.getAttribute('data-issue-id') ?? null)
    const keys = async (pg, ...ks) => { for (const k of ks) { await pg.keyboard.press(k); await pg.waitForTimeout(40) } }

    const vp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await vp.goto(BASE, { waitUntil: 'networkidle' })
    await vp.waitForTimeout(700)
    for (const t of ['Vim unu', 'Vim doi', 'Vim trei']) {
      await vp.locator('.qa-input').first().fill(t)
      await vp.keyboard.press('Enter')
      await vp.waitForTimeout(500)
    }
    await vp.locator('h1').first().click()
    await vp.waitForTimeout(200)
    const rows = await listRows(vp)
    await keys(vp, 'j', 'j', 'Enter')
    await vp.waitForTimeout(900)
    const d1 = await dockedId(vp)
    check('vim: pe „Azi" j j Enter dochează al doilea rând', rows.length >= 3 && d1 === rows[1].id, `docat=${d1}, rânduri=${rows.map((r) => r.id).join(',')}`)
    const focusInList = await vp.evaluate(() => !document.activeElement?.closest('.split-pane'))
    check('…iar focusul rămâne în listă', focusInList, focusInList ? 'în listă' : 'a sărit în panou')

    await keys(vp, 'j')
    await vp.waitForTimeout(600)
    const d2 = await dockedId(vp)
    check('vim: panoul urmează j (formular curat)', d2 === rows[2].id && (await cursorOf(vp)) === rows[2].id, `docat=${d2}, cursor=${await cursorOf(vp)}`)

    // Murdar: cursorul merge, panoul stă, iar pastila spune de ce.
    const title = vp.locator('.split-pane .sh-title-input').first()
    await title.fill(`${await title.inputValue()} MODIFICAT`)
    await vp.waitForTimeout(300)
    await keys(vp, 'Escape')
    const inPane = await vp.evaluate(() => document.activeElement?.classList.contains('split-pane'))
    check('vim: Esc din câmpul panoului rămâne în panou', !!inPane, `activ=${await vp.evaluate(() => document.activeElement?.className)}`)
    await keys(vp, 'h', 'k')
    await vp.waitForTimeout(600)
    const d3 = await dockedId(vp)
    const cur3 = await cursorOf(vp)
    const hint = (await vp.locator('.vim-pill-hint').textContent().catch(() => '')) ?? ''
    check('vim: cu formularul murdar panoul stă pe loc', d3 === rows[2].id && cur3 === rows[1].id, `docat=${d3}, cursor=${cur3}`)
    check('…iar pastila spune „nesalvat"', /nesalvat/.test(hint), JSON.stringify(hint))
    await vp.close()

    // „Listă": j merge exact un rând, în interiorul layerului (nu din layer în layer).
    const lp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await lp.goto(BASE, { waitUntil: 'networkidle' })
    await lp.waitForTimeout(700)
    await lp.locator('.sidebar-proj-btn', { hasText: 'Exemplu' }).first().click()
    await lp.waitForTimeout(800)
    await lp.locator('.tab', { hasText: /^List/ }).first().click()
    await lp.waitForTimeout(500)
    await lp.locator('h1').first().click().catch(() => {})
    const lrows = await listRows(lp)
    const i = lrows.findIndex((r, k) => k + 1 < lrows.length && lrows[k + 1].group === r.group)
    if (i < 0) check('vim: „Listă" are un layer cu două rânduri', false, JSON.stringify(lrows))
    else {
      await keys(lp, 'g', 'g', ...Array(i).fill('j'))
      const a = await cursorOf(lp)
      await keys(lp, 'j')
      const b = await cursorOf(lp)
      check('vim: în „Listă" j coboară exact un rând, în același layer', a === lrows[i].id && b === lrows[i + 1].id, `înainte=${a} după=${b}, așteptat ${lrows[i].id}→${lrows[i + 1].id}`)
      // 5j, nu 2j: într-un proiect 1–4 rămân taburile.
      await keys(lp, 'g', 'g', '5', 'j')
      check('vim: 5j sare cinci rânduri (oprit la capăt)', (await cursorOf(lp)) === lrows[Math.min(5, lrows.length - 1)].id, `cursor=${await cursorOf(lp)}`)
    }
    // g + ezitare: fereastra cu continuările.
    await keys(lp, 'g')
    await lp.waitForTimeout(550)
    const wk = await lp.locator('.vim-wk').count()
    await lp.waitForTimeout(700)
    check('vim: g + ezitare arată continuările', wk === 1, `${wk} ferestre`)
    // gt → „Azi" (today), H → înapoi, L → înainte.
    await keys(lp, 'g', 't')
    await lp.waitForTimeout(700)
    const onAzi = /Azi/.test((await lp.locator('.sidebar-nav-item.on').first().textContent().catch(() => '')) ?? '')
    check('vim: ga duce pe „Azi"', onAzi, 'pe Azi')
    await keys(lp, 'g', 'w')
    await lp.waitForTimeout(700)
    await keys(lp, 'H')
    await lp.waitForTimeout(700)
    const back = (await lp.locator('.sidebar-nav-item.on').first().textContent().catch(() => ''))?.trim()
    check('vim: H = înapoi în istoric (7 zile → Azi)', /Azi/.test(back ?? ''), `ecran=${back}`)
    // z → „Mergi la…", „exe" Enter → proiectul.
    await keys(lp, 'z')
    await lp.waitForTimeout(300)
    await lp.keyboard.type('exe')
    await lp.keyboard.press('Enter')
    await lp.waitForTimeout(800)
    const proj = (await lp.locator('.sidebar-proj-item.on').first().textContent().catch(() => '')) ?? ''
    check('vim: z „exe" Enter deschide proiectul', /Exemplu/.test(proj), JSON.stringify(proj.trim()))
    // Bara laterală: h intră (pe ecranul de acum), j coboară, Enter deschide și te lasă în listă.
    await keys(lp, 'g', 't')
    await lp.waitForTimeout(700)
    await keys(lp, 'h', 'j', 'Enter')
    await lp.waitForTimeout(700)
    const sb = (await lp.locator('.sidebar-nav-item.on').first().textContent().catch(() => ''))?.trim()
    const sbFocus = await lp.evaluate(() => !!document.activeElement?.closest('.sidebar'))
    check('vim: h j Enter din „Azi" deschide „7 zile" din bara laterală', /7 zile/.test(sb ?? '') && !sbFocus, `ecran=${sb}, focus în bară=${sbFocus}`)
    await lp.close()

    // ── Faza 3: acțiunile pe rânduri, pe „Azi" ───────────────────────────────
    {
      const ap = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      let dialogs = 0
      ap.on('dialog', (d) => { dialogs++; void d.dismiss() })
      await ap.goto(BASE, { waitUntil: 'networkidle' })
      await ap.waitForTimeout(700)
      const names = ['Vim A', 'Vim B', 'Vim C', 'Vim D', 'Vim E']
      for (const t of names) {
        await ap.locator('.qa-input').first().fill(t)
        await ap.keyboard.press('Enter')
        await ap.waitForTimeout(400)
      }
      await ap.locator('h1').first().click()
      await ap.waitForTimeout(200)
      const db = (t) => ap.evaluate((t) => JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.title === t), t)
      const titles = () => ap.evaluate(() => [...document.querySelectorAll('main .list-row[data-issue-id]')]
        .filter((el) => !el.closest('.split-pane') && el.getClientRects().length).map((el) => el.querySelector('.list-title')?.textContent))
      const t0 = await titles()

      // j x → gata; u → înapoi.
      await keys(ap, 'g', 'g', 'x')
      await ap.waitForTimeout(700)
      const xDone = (await db(t0[0]))?.done
      await keys(ap, 'u')
      await ap.waitForTimeout(700)
      check('vim: x bifează rândul, u îl redeschide', xDone === true && (await db(t0[0]))?.done === false && (await titles()).includes(t0[0]), `după x=${xDone}, după u=${(await db(t0[0]))?.done}`)

      // dd → rândul dispare, toast, fără dialog; u → revine.
      await keys(ap, 'g', 'g', 'd', 'd')
      await ap.waitForTimeout(500)
      const afterDd = await titles()
      const toastTxt = (await ap.locator('.toast.on').textContent().catch(() => '')) ?? ''
      check('vim: dd ascunde rândul, cu toast și fără dialog', !afterDd.includes(t0[0]) && /Șters/.test(toastTxt) && dialogs === 0, `rânduri=${afterDd.length}/${t0.length}, toast=${JSON.stringify(toastTxt)}, dialoguri=${dialogs}`)
      await keys(ap, 'u')
      await ap.waitForTimeout(600)
      check('…iar u îl aduce înapoi', (await titles()).includes(t0[0]) && !!(await db(t0[0])), JSON.stringify(await titles()))

      // v j j D → trei pe mâine; un singur u le întoarce pe toate.
      const start = await titles()
      await keys(ap, 'g', 'g', 'v', 'j', 'j', 'D')
      await ap.waitForTimeout(900)
      const moved = start.slice(0, 3)
      const left = await titles()
      check('vim: v j j D mută trei rânduri pe mâine', moved.every((t) => !left.includes(t)), `rămase=${JSON.stringify(left)}`)
      await keys(ap, 'u')
      await ap.waitForTimeout(900)
      const back = await titles()
      check('…și un singur u le întoarce pe toate', moved.every((t) => back.includes(t)), `înapoi=${JSON.stringify(back)}`)

      // D, apoi . repetă pe rândul de acum (vecinul celui mutat).
      await keys(ap, 'g', 'g', 'D')
      await ap.waitForTimeout(900)
      await keys(ap, '.')
      await ap.waitForTimeout(900)
      const afterDot = await titles()
      check('vim: . repetă D pe rândul următor', !afterDot.includes(back[0]) && !afterDot.includes(back[1]), `rămase=${JSON.stringify(afterDot)}`)
      await keys(ap, 'u')
      await ap.waitForTimeout(700)

      // Space: rândul intră în selecție și cursorul coboară.
      const rowsNow = await listRows(ap)
      await keys(ap, 'g', 'g', 'Space')
      const selCss = await ap.evaluate(() => [...document.querySelectorAll('style')].some((s) => /list-row:is\(/.test(s.textContent)))
      check('vim: Space pune rândul în selecție și coboară', (await cursorOf(ap)) === rowsNow[1]?.id && selCss, `cursor=${await cursorOf(ap)}, selecție desenată=${selCss}`)
      await keys(ap, 'Escape')

      // `/` = căutarea din toate proiectele (ca O), nu căutarea în listă.
      await keys(ap, '/')
      await ap.waitForTimeout(200)
      const qsOpen = (await ap.locator('.qs-overlay').count()) === 1
      check('vim: / deschide căutarea', qsOpen, qsOpen ? 'deschisă' : 'nu s-a deschis')
      await keys(ap, 'Escape', 'Escape')
      await ap.close()
    }

    // ── Faza 4: câmpurile panoului ───────────────────────────────────────────
    {
      const pp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await pp.goto(BASE, { waitUntil: 'networkidle' })
      await pp.waitForTimeout(700)
      await pp.locator('.qa-input').first().fill('Vim panou')
      await pp.keyboard.press('Enter')
      await pp.waitForTimeout(500)
      await pp.locator('h1').first().click()
      const target = (await listRows(pp)).find(Boolean)
      await keys(pp, 'g', 'g', 'l')
      await pp.waitForTimeout(900)
      const inPane = await pp.evaluate(() => document.activeElement?.classList.contains('split-pane'))
      // Inelul: titlu → jetoane (un popas) → descriere. J J de pe titlu = descrierea.
      const fieldRule = () => pp.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).find((t) => t.startsWith('@media (pointer: fine) {') && t.includes('#app[data-vim-pane="panel"]')) ?? '')
      await keys(pp, 'J', 'J')
      check('vim: panou J J ajunge pe descriere', !!inPane && /data-vim-pane="panel"\] \.split-pane \.form-col-desc \.desc-box/.test(await fieldRule()), (await fieldRule()).match(/#app\[data-vim-pane="panel"\][^{]*/)?.[0] ?? '(niciun câmp)')
      await keys(pp, 'K', 'Enter')
      await pp.waitForTimeout(300)
      const menuOn = await pp.locator('.am-menu').count()
      const menuTitle = (await pp.locator('.am-menu .am-title').textContent().catch(() => '')) ?? ''
      check('vim: Enter pe jetoane deschide meniul de acțiuni', menuOn === 1 && /Acțiuni/.test(menuTitle), `meniu=${menuOn}, titlu=${menuTitle}`)
      await keys(pp, 'Escape')
      await pp.waitForTimeout(200)
      check('…iar Esc îl închide, panoul rămâne', (await pp.locator('.am-menu').count()) === 0 && (await pp.locator('.split-pane:not([hidden])').count()) === 1, 'închis')
      await pp.close()

      // Esc din descriere → panoul (normal) → lista → panoul se închide. Pagină nouă: formular curat.
      const ep = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await ep.goto(BASE, { waitUntil: 'networkidle' })
      await ep.waitForTimeout(700)
      await ep.locator('.qa-input').first().fill('Vim descriere')
      await ep.keyboard.press('Enter')
      await ep.waitForTimeout(500)
      await ep.locator('h1').first().click()
      await keys(ep, 'g', 'g', 'l')
      await ep.waitForTimeout(900)
      await keys(ep, 'a')
      await ep.waitForTimeout(400)
      const inDesc = await ep.evaluate(() => !!document.activeElement?.closest('.split-pane .cm-editor, .split-pane textarea'))
      await keys(ep, 'Escape')
      const s1 = await ep.evaluate(() => document.activeElement?.classList.contains('split-pane'))
      await keys(ep, 'Escape')
      const s2 = await ep.evaluate(() => !document.activeElement?.closest('.split-pane'))
      await keys(ep, 'Escape')
      await ep.waitForTimeout(400)
      const closed = await ep.locator('.split-pane:not([hidden])').count()
      check('vim: Esc din descriere → panou → listă → închis', inDesc && !!s1 && s2 && closed === 0, `în descriere=${inDesc}, panou=${s1}, listă=${s2}, panouri deschise=${closed}`)
      void target
      await ep.close()
    }

    // ── O scriere din listă pe tichetul docat (curat): panoul o arată, iar o
    // salvare ulterioară NU scrie valoarea veche înapoi (remontarea din SplitView).
    {
      const up = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await up.goto(BASE, { waitUntil: 'networkidle' })
      await up.waitForTimeout(700)
      await up.locator('.qa-input').first().fill('Vim urgent din listă')
      await up.keyboard.press('Enter')
      await up.waitForTimeout(500)
      await up.locator('h1').first().click()
      const id = (await listRows(up))[0]?.id
      const inDb = () => up.evaluate((id) => JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.id === id), id)
      await keys(up, 'g', 'g', 'l')
      await up.waitForTimeout(900)
      await keys(up, 'h', '!')
      await up.waitForTimeout(800)
      const chip = await up.locator('.split-pane .fc-chip.urgent').count()
      const saveDirty = await up.locator('.split-pane .sh-save.dirty').count()
      check('docat curat: ! din listă se vede în panou, fără „nesalvat"', chip === 1 && saveDirty === 0 && (await inDb())?.urgent === true, `jeton=${chip}, nesalvat=${saveDirty}`)
      const t = up.locator('.split-pane .sh-title-input').first()
      await t.fill('Vim urgent din listă, redenumit')
      await up.keyboard.press('Control+s')
      await up.waitForTimeout(900)
      const after = await inDb()
      check('…iar o salvare din formular păstrează urgentul', after?.urgent === true && after?.title === 'Vim urgent din listă, redenumit', `urgent=${after?.urgent}, titlu=${after?.title}`)
      // Meniul de click dreapta pe același rând (fără Vim): același drum.
      await up.locator(`main .list-row[data-issue-id="${id}"]`).click({ button: 'right' })
      await up.waitForTimeout(300)
      await up.locator('.ctx-menu [role="menuitem"]', { hasText: /urgent/i }).first().click()
      await up.waitForTimeout(800)
      check('…și click dreapta → Urgent se vede în panou', (await up.locator('.split-pane .fc-chip.urgent').count()) === 0 && (await inDb())?.urgent === false, `urgent=${(await inDb())?.urgent}`)
      await up.close()
    }

    // ── Meniul de acțiuni (m) ────────────────────────────────────────────────
    {
      const mp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await mp.goto(BASE, { waitUntil: 'networkidle' })
      await mp.waitForTimeout(700)
      const names = ['Meniu unu mâine', 'Meniu doi mâine', 'Meniu trei mâine']
      for (const t of names) {
        await mp.locator('.qa-input').first().fill(t)
        await mp.keyboard.press('Enter')
        await mp.waitForTimeout(400)
      }
      await mp.locator('h1').first().click()
      await keys(mp, 'g', 'w')
      await mp.waitForTimeout(800)
      const weekTitles = () => mp.evaluate(() => [...document.querySelectorAll('main .list-row[data-issue-id]')]
        .filter((el) => !el.closest('.split-pane')).map((el) => el.querySelector('.list-title')?.textContent))
      const due = (t) => mp.evaluate((t) => JSON.parse(localStorage.getItem('horizontal:v2')).issues.find((i) => i.title === t)?.dueAt, t)
      const before = await due('Meniu unu')
      // Trei rânduri în selecție (Space), apoi m t a: toate pe azi; un u le întoarce.
      await keys(mp, 'g', 'g', 'Space', 'Space', 'Space', 'm')
      await mp.waitForTimeout(200)
      const root = await mp.locator('.am-menu .am-item').count()
      await keys(mp, 't')
      const crumb = (await mp.locator('.am-menu .am-head').textContent().catch(() => '')) ?? ''
      await keys(mp, 'a')
      await mp.waitForTimeout(900)
      const left = await weekTitles()
      check('vim: m t a pe trei rânduri le mută pe azi', root === 12 && /Acțiuni ›\s*Dată și oră/.test(crumb) && names.every((n) => !left.includes(n.replace(' mâine', ''))), `rânduri meniu=${root}, crumb=${JSON.stringify(crumb)}, rămase=${JSON.stringify(left)}`)
      await keys(mp, 'u')
      await mp.waitForTimeout(900)
      const back = await weekTitles()
      check('…iar un u le întoarce pe toate', names.every((n) => back.includes(n.replace(' mâine', ''))) && (await due('Meniu unu')) === before, JSON.stringify(back))
      // Cu un interval (v j), „Mută în proiect" e stins, cu motivul.
      await keys(mp, 'g', 'g', 'v', 'j', 'm')
      await mp.waitForTimeout(200)
      const mv = mp.locator('.am-menu .am-item', { hasText: 'Mută în proiect' })
      const mvCls = (await mv.getAttribute('class').catch(() => '')) ?? ''
      const mvWhy = (await mv.locator('.am-why').textContent().catch(() => '')) ?? ''
      check('vim: m pe interval stinge „Mută", cu motivul', /\boff\b/.test(mvCls) && /doar pe un tichet/.test(mvWhy), `${mvCls} · ${mvWhy}`)
      await keys(mp, 'M')
      check('…și M nu deschide sub-meniul', (await mp.locator('.am-menu .am-title').textContent()) === 'Acțiuni', await mp.locator('.am-menu .am-title').textContent())
      await keys(mp, 'Escape', 'Escape', 'Escape')
      // t direct: sub-meniul datei, ora din cifre.
      await keys(mp, 'g', 'g', 't', '1', '5', '3', '0', 'Enter')
      await mp.waitForTimeout(900)
      const firstTitle = (await weekTitles())[0]
      const d = new Date(await due(firstTitle + ' mâine') ?? await due(firstTitle))
      check('vim: t 1530 Enter pune ora 15:30, pe ziua sarcinii', d.getHours() === 15 && d.getMinutes() === 30, `${firstTitle} → ${d.toString()}`)
      await mp.close()
    }

    // ── Faza 5: ] schimbă valul cu modul Vim pornit ──────────────────────────
    {
      const wp = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await wp.goto(BASE, { waitUntil: 'networkidle' })
      await wp.waitForTimeout(700)
      await wp.locator('.sidebar-proj-btn', { hasText: 'Exemplu' }).first().click()
      await wp.waitForTimeout(800)
      await wp.locator('.tab', { hasText: /^List/ }).first().click()
      await wp.waitForTimeout(500)
      await wp.locator('h1').first().click().catch(() => {})
      const aw = () => wp.locator('.wb-pills [aria-selected="true"]').first().textContent().catch(() => null)
      const a0 = await aw()
      await wp.keyboard.press(']')
      await wp.waitForTimeout(400)
      const a1 = await aw()
      await wp.keyboard.press('[')
      await wp.waitForTimeout(400)
      const a2 = await aw()
      check('vim: ] / [ schimbă valul', a0 !== null && a1 !== a0 && a2 === a0, `${a0} → ${a1} → ${a2}`)
      // `.` nu mai schimbă valul cu modul Vim (repetă).
      await wp.keyboard.press('.')
      await wp.waitForTimeout(400)
      check('…iar . nu mai e valul', (await aw()) === a0, `${await aw()}`)
      await wp.close()
    }

    // Modul Vim oprit: `,` / `.` schimbă valul, ca înainte.
    const op = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await op.addInitScript(() => localStorage.setItem('horizontal-vim', 'off'))
    await op.goto(BASE, { waitUntil: 'networkidle' })
    await op.waitForTimeout(700)
    await op.locator('.sidebar-proj-btn', { hasText: 'Exemplu' }).first().click()
    await op.waitForTimeout(800)
    await op.locator('.tab', { hasText: /^List/ }).first().click()
    await op.waitForTimeout(500)
    await op.locator('h1').first().click().catch(() => {})
    const activeWave = () => op.locator('.wb-pills [aria-selected="true"]').first().textContent().catch(() => null)
    const w0 = await activeWave()
    await op.keyboard.press('.')
    await op.waitForTimeout(400)
    const w1 = await activeWave()
    await op.keyboard.press(',')
    await op.waitForTimeout(400)
    const w2 = await activeWave()
    check('vim oprit: `,` / `.` schimbă valul', w0 !== null && w1 !== w0 && w2 === w0, `${w0} → ${w1} → ${w2}`)
    await op.close()
  }

  // Aceeași regresie în aplicația obișnuită: tichet docat în „Listă", apoi
  // „Azi" din bara laterală — formularul rămânea pe „Se încarcă tichetul…".
  {
    const dk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await dk.goto(BASE, { waitUntil: 'networkidle' })
    await dk.waitForTimeout(700)
    await dk.locator('.sidebar-proj-btn', { hasText: 'Exemplu' }).first().click()
    await dk.waitForTimeout(800)
    await dk.locator('.tab', { hasText: /^List/ }).first().click()
    await dk.waitForTimeout(500)
    await dk.locator('.list-row').first().click()
    await dk.waitForTimeout(800)
    const before = new URL(dk.url()).pathname
    await dk.locator('.sidebar .sidebar-nav-item', { hasText: 'Azi' }).first().click()
    await dk.waitForTimeout(1500)
    const loadingStuck = await dk.locator('.split-pane:not([hidden]) .split-empty').count()
    const form = await dk.locator('.split-pane:not([hidden]) .sh-title-input').count()
    check('tichet docat, apoi „Azi" din bara laterală: formularul rămâne încărcat', loadingStuck === 0 && form === 1, `${before}: gol=${loadingStuck}, formular=${form}`)
    await dk.close()
  }

  // ── Panoul dublu (spec 2026-10-22-split-pane): două iframe-uri, fiecare
  // aplicația întreagă. Context propriu: `sessionStorage` e al filei, iar o
  // pagină nouă în același context e o pornire rece.
  {
    console.log('\nPanoul dublu:')
    const sctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const sp = await sctx.newPage()
    const pane = (id) => sp.frames().find((f) => new URL(f.url()).search === `?pane=${id}`)
    const crumb = async (id) => (await pane(id)?.locator('.pane-crumb').innerText().catch(() => '?'))?.replace(/\s+/g, ' ').trim()
    const focused = () => sp.evaluate(() => document.querySelector('.split-pane-frame.focus')?.getAttribute('data-pane') ?? null)
    const activeFrame = () => sp.evaluate(() => {
      const a = document.activeElement
      return a?.tagName === 'IFRAME' ? new URL(a.src).search.slice(6) : a?.tagName ?? null
    })
    await sp.goto(BASE, { waitUntil: 'networkidle' })
    await sp.waitForTimeout(700)
    await sp.locator('.qa-input').first().fill('Sarcină pentru panoul dublu')
    await sp.keyboard.press('Enter')
    await sp.waitForTimeout(900)
    await sp.locator('.task-row', { hasText: 'Sarcină pentru panoul dublu' }).first().click()
    await sp.waitForTimeout(900)
    const id = new URL(sp.url()).pathname.slice(1)
    const hist0 = await sp.evaluate(() => history.length)
    check('split: butonul din antetul tichetului docat, de la 1200px', (await sp.locator('.split-pane .sh-split').count()) === 1, `${await sp.locator('.split-pane .sh-split').count()} buton(e)`)
    await sp.locator('.split-pane .sh-split').click()
    await sp.waitForTimeout(2500)
    check('split: pornirea din tichet — stânga tichetul, dreapta lista unde erai',
      (await sp.locator('.split-pane-frame iframe').count()) === 2 && (await crumb('L'))?.endsWith(id) && (await crumb('R')) === 'Azi',
      `L=${await crumb('L')}, R=${await crumb('R')}`)
    check('split: focusul pe stânga, cu linia accent', (await focused()) === 'L' && (await activeFrame()) === 'L', `focus=${await focused()}, tastatura=${await activeFrame()}`)

    // Ctrl+Shift+] / [ dintr-un câmp de text (titlul tichetului din stânga).
    await pane('L').locator('.sh-title-input').first().click()
    await sp.waitForTimeout(200)
    await sp.keyboard.press('Control+Shift+BracketRight')
    await sp.waitForTimeout(400)
    const afterR = [await focused(), await activeFrame()]
    await sp.keyboard.press('Control+Shift+BracketLeft')
    await sp.waitForTimeout(400)
    const afterL = [await focused(), await activeFrame()]
    const titleKept = await pane('L').evaluate(() => document.activeElement?.closest('.sh-title, .sh-title-wrap') !== null || document.activeElement?.className)
    check('split: Ctrl+Shift+] / [ mută focusul, și dintr-un câmp', afterR.join() === 'R,R' && afterL.join() === 'L,L', `] → ${afterR}, [ → ${afterL}, înapoi în titlu: ${titleKept}`)
    const titleVal = await pane('L').locator('.sh-title-input').first().inputValue().catch(() => null)
    check('split: tasta de comutare nu scrie nimic în câmp', titleVal === 'Sarcină pentru panoul dublu', `titlu=${titleVal}`)

    // Regresia din producție (2026-10-22): o listă aleasă din bara laterală cu
    // tichetul deschis îi descărca proiectul (`selectProject(null)`), iar
    // formularul docat rămânea pe „Se încarcă tichetul…" la nesfârșit.
    await pane('L').locator('main').click({ position: { x: 60, y: 300 } }).catch(() => {})
    await sp.waitForTimeout(300)
    await sp.locator('.sidebar .sidebar-nav-item', { hasText: '7 zile' }).first().click()
    await sp.waitForTimeout(1500)
    check('split: o listă din bara laterală, cu tichetul deschis în panou, nu-l lasă pe „Se încarcă"',
      (await pane('L').locator('.split-empty').count()) === 0 && (await pane('L').locator('.sh-title-input').count()) === 1 && (await crumb('L'))?.endsWith(id),
      `L=${await crumb('L')}, gol=${await pane('L').locator('.split-empty').count()}`)
    await sp.locator('.sidebar .sidebar-nav-item', { hasText: 'Azi' }).first().click()
    await sp.waitForTimeout(800)

    // Bara laterală navighează panoul cu focus; Back = Back-ul panoului cu focus.
    await pane('R').locator('main').click({ position: { x: 60, y: 400 } })
    await sp.waitForTimeout(300)
    await sp.locator('.sidebar .sidebar-proj-btn', { hasText: 'Exemplu' }).first().click()
    await sp.waitForTimeout(900)
    check('split: bara laterală navighează panoul cu focus', (await crumb('R')) === 'Exemplu' && (await crumb('L'))?.endsWith(id), `L=${await crumb('L')}, R=${await crumb('R')}, URL=${new URL(sp.url()).pathname}`)
    check('split: URL-ul de sus = ruta panoului cu focus', new URL(sp.url()).pathname === '/project/exemplu', new URL(sp.url()).pathname)
    await sp.goBack()
    await sp.waitForTimeout(900)
    check('split: Back lucrează pe panoul cu focus, celălalt neatins', (await crumb('R')) === 'Azi' && (await crumb('L'))?.endsWith(id), `L=${await crumb('L')}, R=${await crumb('R')}`)
    await sp.goBack()
    await sp.waitForTimeout(900)
    const stillHere = new URL(sp.url()).origin === BASE && (await sp.locator('.split-pane-frame iframe').count()) === 2
    check('split: Back pe rădăcina panoului nu face nimic', stillHere && (await crumb('R')) === 'Azi' && (await crumb('L'))?.endsWith(id), `URL=${sp.url()}, R=${await crumb('R')}`)
    const hist1 = await sp.evaluate(() => history.length)
    check('split: navigarea din panouri nu umple istoricul filei', hist1 <= hist0 + 1, `${hist0} → ${hist1}`)

    // O scriere într-un panou se vede în celălalt (bifa din „Azi" → formularul din stânga).
    await pane('R').locator('.task-row', { hasText: 'Sarcină pentru panoul dublu' }).first().locator('.ck').click()
    await sp.waitForTimeout(2500)
    const doneL = await pane('L').locator('.sh-check .ck').first().getAttribute('class').catch(() => '')
    check('split: o scriere într-un panou se vede în celălalt', /\bon\b|done/.test(doneL ?? ''), `bifa din stânga: ${doneL}`)
    await pane('R').locator('.task-row', { hasText: 'Sarcină pentru panoul dublu' }).first().locator('.ck').click().catch(() => {})
    await sp.waitForTimeout(800)

    // Reîncărcarea reface ambele panouri și focusul.
    await pane('R').locator('main').click({ position: { x: 60, y: 400 } })
    await sp.waitForTimeout(300)
    await sp.reload({ waitUntil: 'networkidle' })
    await sp.waitForTimeout(2500)
    check('split: reîncărcarea reface ambele panouri și focusul',
      (await sp.locator('.split-pane-frame iframe').count()) === 2 && (await crumb('L'))?.endsWith(id) && (await crumb('R')) === 'Azi' && (await focused()) === 'R',
      `L=${await crumb('L')}, R=${await crumb('R')}, focus=${await focused()}`)

    // Pornirea rece (filă nouă = `sessionStorage` gol): un singur panou, pe „Azi".
    const cold = await sctx.newPage()
    await cold.goto(BASE, { waitUntil: 'networkidle' })
    await cold.waitForTimeout(1200)
    check('split: pornirea rece dă un singur panou, pe „Azi"', (await cold.locator('iframe').count()) === 0 && /Azi/.test(await cold.locator('.hd-title').first().innerText().catch(() => '')), `${await cold.locator('iframe').count()} iframe-uri`)
    check('split: butonul din bara laterală apare la 1366', (await cold.locator('.sidebar-split-btn').count()) === 1, `${await cold.locator('.sidebar-split-btn').count()}`)
    await cold.close()

    // Garda de murdărie pe panoul care se închide.
    await pane('L').locator('.sh-title-input').first().fill('Sarcină pentru panoul dublu — schimbată')
    await sp.waitForTimeout(300)
    await pane('L').locator('.pane-close').click()
    await sp.waitForTimeout(600)
    check('split: ✕ cu modificări nesalvate e refuzat (garda de azi)',
      (await sp.locator('.split-pane-frame iframe').count()) === 2 && (await pane('L').locator('.ccm-overlay').count()) === 1,
      `${await sp.locator('.split-pane-frame iframe').count()} panouri, dialog=${await pane('L').locator('.ccm-overlay').count()}`)
    await pane('L').locator('.ccm-exit').click()
    await sp.waitForTimeout(400)

    // ✕ curat: celălalt NU se reîncarcă — iframe-ul lui se lărgește, cu tot cu ce avea.
    await pane('R').locator('.qa-input').first().fill('ciornă nesalvată')
    const marker = await pane('R').evaluate(() => { (window).__alive = 'da'; return true })
    await pane('L').locator('.pane-close').click()
    await sp.waitForTimeout(800)
    const r = pane('R')
    const kept = r ? await r.evaluate(() => [(window).__alive, document.querySelector('.qa-input')?.value]) : null
    const width = await sp.evaluate(() => document.querySelector('.split-pane-frame')?.getBoundingClientRect().width ?? 0)
    check('split: ✕ închide fără reîncărcarea celuilalt, care se lărgește', marker && kept?.[0] === 'da' && kept?.[1] === 'ciornă nesalvată' && width > 1000 && (await sp.locator('.split-pane-frame iframe').count()) === 1,
      `rămas=${JSON.stringify(kept)}, lățime=${Math.round(width)}px`)
    await sp.reload({ waitUntil: 'networkidle' })
    await sp.waitForTimeout(1600)
    check('split: după ✕, reîncărcarea dă aplicația normală, din ruta rămasă', (await sp.locator('iframe').count()) === 0 && /Azi/.test(await sp.locator('.hd-title').first().innerText().catch(() => '')), `${await sp.locator('iframe').count()} iframe-uri`)

    // Pornirea din bara laterală (fără tichet).
    await sp.locator('.sidebar-split-btn').click()
    await sp.waitForTimeout(2500)
    check('split: pornirea din bara laterală', (await sp.locator('.split-pane-frame iframe').count()) === 2 && (await crumb('L')) === 'Azi' && (await crumb('R')) === 'Azi', `L=${await crumb('L')}, R=${await crumb('R')}`)
    await sctx.close()

    // Sub 1200px butonul nu apare.
    const narrowSp = await browser.newPage({ viewport: { width: 1199, height: 800 } })
    await narrowSp.goto(BASE, { waitUntil: 'networkidle' })
    await narrowSp.waitForTimeout(800)
    check('split: sub 1200px butonul din bara laterală lipsește', (await narrowSp.locator('.sidebar-split-btn').count()) === 0, `${await narrowSp.locator('.sidebar-split-btn').count()}`)
    await narrowSp.close()
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
