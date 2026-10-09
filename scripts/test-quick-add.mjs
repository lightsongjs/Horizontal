// Ruta /quick-add pe backendul local, în Chromium: pagina nu e luată drept
// tichet, Enter creează sarcina cu data din text în proiectul implicit (Inbox, sau primul personal),
// iar sarcina apare în aplicație.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5213
const BASE = `http://localhost:${PORT}`
let failed = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++ }

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', VITE_DATA_SOURCE: 'local', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite nu a pornit în 60s')), 60_000)
  vite.stdout.on('data', (d) => { if (String(d).includes(`localhost:${PORT}`)) { clearTimeout(t); resolve() } })
  vite.on('exit', (c) => { clearTimeout(t); reject(new Error(`vite a ieșit cu ${c}`)) })
})

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 150 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/quick-add`, { waitUntil: 'networkidle' })
  check('URL-ul rămâne /quick-add', new URL(page.url()).pathname === '/quick-add', page.url())
  check('nu apare notița de tichet inexistent', (await page.locator('text=nu mai există').count()) === 0)
  const openList = async (name) => {
    await page.locator('.tabbar button, .sidebar-smart-item, .sidebar button').filter({ hasText: new RegExp('^' + name) }).locator('visible=true').first().click()
    await page.waitForTimeout(800)
    return page.locator('.task-row').allInnerTexts()
  }
  // Înainte de bară: câte rânduri are „Azi". Un Enter pe câmp gol ar crea o
  // sarcină pentru AZI, deci numărul ăsta e singurul loc unde se vede.
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const aziBefore = (await openList('Azi')).length
  await page.setViewportSize({ width: 720, height: 150 })
  await page.goto(`${BASE}/quick-add`, { waitUntil: 'networkidle' })
  const input = page.locator('.qab .qa-input')
  check('bara are câmpul', (await input.count()) === 1)

  await input.fill('')
  await input.press('Enter')
  await page.waitForTimeout(400)
  await input.fill('test bară mâine la 10')
  await page.waitForTimeout(300)
  await input.press('Enter')
  await page.waitForTimeout(800)
  check('după Enter câmpul e gol', (await input.inputValue()) === '')

  // Semnele: proiectul și urgența din text. Pe backendul local proiectul din
  // seed e „Exemplu" (`src/lib/seed.ts`); „Daily" nu există acolo, deci bara
  // pornește pe proiectul personal implicit.
  await input.fill('test semne #exemplu ! mâine')
  await page.waitForTimeout(300)
  const richRow = await page.locator('.qab .qa-rich').innerText()
  check('rândul de butoane arată proiectul ales din text', /Exemplu/i.test(richRow), richRow)
  check('urgent aprins din „!"', (await page.locator('.qab .qa-urgent.on').count()) === 1)
  await page.locator('.qab .qa-urgent').click()
  check('butonul are ultimul cuvânt (urgent stins)', (await page.locator('.qab .qa-urgent.on').count()) === 0)
  await input.press('Enter')
  await page.waitForTimeout(800)

  // Lista de sugestii la `#`: se deschide, se filtrează, Enter alege (nu trimite),
  // iar alegerea e recunoscută ca proiect. Esc o închide fără să închidă bara.
  await input.fill('')
  await input.pressSequentially('alegere #ex')
  await page.waitForTimeout(200)
  const sugg = page.locator('.qab .qa-suggest li')
  check('„#ex" deschide lista cu „Exemplu"', (await sugg.count()) >= 1 && /Exemplu/.test(await sugg.first().innerText()), String(await sugg.count()))
  await input.press('Enter')
  await page.waitForTimeout(200)
  check('Enter în listă inserează proiectul, nu trimite', /^alegere #Exemplu $/.test(await input.inputValue()), await input.inputValue())
  check('lista se închide după alegere', (await sugg.count()) === 0)
  check('alegerea e recunoscută (rândul arată proiectul)', /Exemplu/i.test(await page.locator('.qab .qa-rich').innerText()))
  await input.pressSequentially('@')
  await page.waitForTimeout(150)
  const people = await sugg.count()
  await input.press('Escape')
  await page.waitForTimeout(150)
  check('Esc închide lista (dacă era deschisă), textul rămâne', (await sugg.count()) === 0 && (await input.inputValue()).endsWith('@'), `oameni: ${people}`)

  // Esc cu text: nu salvează (în browser nu există punte, deci bara nu se ascunde).
  await input.fill('nu trebuie salvat')
  await input.press('Escape')
  check('fără erori în pagină', errors.length === 0, errors.join(' | '))

  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const aziAfter = await openList('Azi')
  check('Enter pe câmp gol n-a creat nimic („Azi" are tot atâtea rânduri)', aziAfter.length === aziBefore, `${aziBefore} -> ${aziAfter.length}`)
  const rows = await openList('Mâine')
  check('sarcina din bară apare în „Mâine", la 10:00', rows.some((r) => r.includes('test bară') && r.includes('10:00')), rows.join(' / '))
  // Slab prin construcție: în browser nu există punte, deci Esc nu ascunde bara
  // și nu putem apăsa Enter "după"; verificăm doar că Esc singur nu scrie nimic.
  check('textul de la Esc nu s-a salvat', !rows.some((r) => r.includes('nu trebuie salvat')))
  // Sarcina cu semne e pentru MÂINE, deci e aici; titlul ei e exact „test semne".
  const signs = rows.find((r) => r.includes('test semne')) ?? ''
  check('sarcina cu semne a ajuns în „Mâine"', signs !== '', rows.join(' / '))
  check('semnele nu rămân în titlu', signs !== '' && !signs.includes('#') && !signs.includes('!') && signs.split('\n').includes('test semne'), signs)

  // ── Descrierea (Tab) și fereastra care crește ────────────────────────────
  // Puntea e simulată: în browser `window.horizontalDesktop` lipsește. Cu ea,
  // `.qab` își cere înălțimea prin `resizeBar` — aici doar se înregistrează.
  // Aceeași pagină (deci același context): depozitul local e al contextului,
  // iar sarcina scrisă din bară trebuie văzută apoi din aplicație. Puntea
  // simulată rămâne și pe aplicația de după — inofensiv, metodele sunt goale.
  const desk = page
  await desk.setViewportSize({ width: 720, height: 150 })
  await desk.addInitScript(() => {
    window.__sizes = []
    window.horizontalDesktop = {
      version: 'test',
      setReminders() {},
      onReminderAction() { return () => {} },
      hideBar() { window.__hidden = (window.__hidden ?? 0) + 1 },
      resizeBar(h) { window.__sizes.push(h) },
    }
  })
  await desk.goto(`${BASE}/quick-add`, { waitUntil: 'networkidle' })
  const dIn = desk.locator('.qab .qa-input')
  await dIn.fill('test descriere mâine')
  await dIn.press('Tab')
  await desk.waitForTimeout(300)
  const descShown = (await desk.locator('.qab .qa-desc').count()) === 1
  check('Tab deschide descrierea', descShown)
  check('cursorul trece în descriere', await desk.evaluate(() => document.activeElement?.classList.contains('qa-desc') ?? false))
  const before = await desk.evaluate(() => Math.max(0, ...window.__sizes.slice(0, 1)))
  await desk.keyboard.type('rândul unu')
  await desk.keyboard.press('Enter')
  await desk.keyboard.type('rândul doi')
  await desk.keyboard.press('Enter')
  await desk.keyboard.type('rândul trei')
  await desk.waitForTimeout(300)
  const sizes = await desk.evaluate(() => window.__sizes)
  check('fereastra își cere mai multă înălțime', sizes.length > 1 && sizes[sizes.length - 1] > before, sizes.join(' → '))
  check('Enter în descriere nu salvează', (await desk.evaluate(() => window.__hidden ?? 0)) === 0)
  await desk.keyboard.press('Control+Enter')
  await desk.waitForTimeout(800)
  check('Ctrl+Enter salvează (bara se ascunde)', (await desk.evaluate(() => window.__hidden ?? 0)) === 1)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await openList('Mâine')
  await page.locator('.task-row', { hasText: 'test descriere' }).first().click()
  await page.waitForTimeout(1000)
  const savedDesc = await page.locator('.desc-fixed').first().inputValue().catch(() => null)
  check('tichetul are descrierea', savedDesc === 'rândul unu\nrândul doi\nrândul trei', JSON.stringify(savedDesc))
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}
if (failed) { console.error(`${failed} verificări au picat.`); process.exit(1) }
console.log('Bara de captură funcționează.')
