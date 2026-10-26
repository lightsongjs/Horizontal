// Invarianți de layout, măsurați în browser real: `npm run test:layout`
//
// De ce un script separat și nu vitest: astea nu sunt afirmații despre logică,
// ci despre LĂȚIMI — cât spațiu primește efectiv un control după ce flexbox
// împarte rândul. Un test în jsdom n-ar măsura nimic (jsdom nu face layout),
// iar typecheck-ul și suita de unit-teste trec liniștite peste un câmp de
// input strivit la zero pixeli. Exact clasa de regresie din CLAUDE.md
// („un control care rămâne fără fundal ȘI fără chenar"), varianta de lățime.
//
// Tiparul e cel din design/preview.html: CSS-ul REAL peste DOM-ul REAL al
// aplicației, fără server și fără login.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

// `.replace(/^﻿/, '')`: `styles.css` are BOM (salvat de un editor Windows).
// Injectat inline într-un `<style>` (nu ca foaie externă), BOM-ul rămâne text
// literal înaintea `@import`-ului — Chromium aruncă atunci nu doar @import-ul,
// ci și `:root{}` de după, deci NICIO variabilă CSS (`--surface-3`, `--amb`
// etc.) nu se mai rezolvă. Latent până acum: niciun check de mai jos n-a citit
// o culoare calculată — abia bara de om verifică fundal/umbră.
const BASE_CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/^﻿/, '')
// `TEXT_SCALE=1.5 npm run test:layout` — aceiași invarianți cu textul mărit din
// rotița de setări (treapta „Maxim"). Variabila se pune DUPĂ foaie, ca să bată
// `--text-scale: 1` din `:root`.
const CSS = process.env.TEXT_SCALE ? `${BASE_CSS}\n:root{--text-scale:${process.env.TEXT_SCALE}}` : BASE_CSS

/** Lățimile la care se uită oamenii pe telefon. 320 = cel mai îngust ecran
 *  pe care merită să funcționeze; 430 = iPhone Pro Max. */
const PHONE_WIDTHS = [320, 360, 390, 430]

/** Sub atâta, un câmp de căutare nu mai e un câmp de căutare. */
const MIN_INPUT_W = 100

const failures = []

function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name} — ${detail}`)
  else {
    console.log(`  FAIL ${name} — ${detail}`)
    failures.push(`${name}: ${detail}`)
  }
}

/**
 * Bara de dependențe din `IssueForm.tsx`: trei taburi care NU se micșorează
 * (`.dep-tab-btn` are `flex-shrink: 0` și `white-space: nowrap`) plus câmpul
 * de căutare. Contoarele sunt puse pe cazul cel mai rău — cu ele, taburile
 * ocupă mai mult.
 */
const depsBar = () => `
<div class="sheet"><div class="sheet-scroll"><div class="deps-zone">
  <div class="deps-bar">
    <button class="dep-tab-btn on"><svg width="13" height="13"></svg>Necesită<span class="dep-tab-count">2</span></button>
    <button class="dep-tab-btn"><svg width="13" height="13"></svg>Permite<span class="dep-tab-count">3</span></button>
    <button class="dep-tab-btn"><svg width="13" height="13"></svg>Obstacole<span class="dep-tab-count">1</span></button>
    <div class="dep-search-wrap-rel">
      <div class="dep-search-field">
        <svg class="dep-search-icon" width="13" height="13"></svg>
        <input class="dep-search-input-sm" placeholder="Caută sau creează tichet…">
      </div>
      <div class="dep-dropdown"><button class="dep-dd-item">rând</button></div>
    </div>
  </div>
</div></div></div>`

const browser = await chromium.launch()
// CSS-ul de telefon atârnă de `<html data-narrow>` (src/lib/narrow.ts), nu de un
// @media; panoul lateral (1200px) de `<html data-wide>`. Îl punem dintr-un script AL PAGINII, înaintea conținutului — ca
// `installNarrow` înainte de prima randare. Pus după `setContent`, regulile de
// desktop s-ar fi aplicat întâi, iar tranzițiile (`.sheet { transition:
// transform }`) ar fi fost prinse la jumătate de măsurători.
const NARROW_BOOT = `<script>(() => {
  const mq = matchMedia('(max-width: 899px)')
  const wq = matchMedia('(min-width: 1200px)')
  const sync = () => {
    const pane = document.documentElement.hasAttribute('data-pane')
    document.documentElement.toggleAttribute('data-narrow', mq.matches && !pane)
    document.documentElement.toggleAttribute('data-wide', wq.matches || pane)
  }
  sync(); mq.addEventListener('change', sync); wq.addEventListener('change', sync)
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pane'] })
})()</script>`
const syncNarrow = (page) => {
  if (page.__narrow) return page
  page.__narrow = true
  const setContent = page.setContent.bind(page)
  page.setContent = (html, ...rest) => setContent(NARROW_BOOT + html, ...rest)
  return page
}
{
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (opts) => syncNarrow(await newPage(opts))
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts)
    const ctxPage = ctx.newPage.bind(ctx)
    ctx.newPage = async () => syncNarrow(await ctxPage())
    return ctx
  }
}
// Cu text mărit, `theme.tsx` pune și `data-text-large` pe <html> — regulile care
// rup rândurile pe două linii depind de el, deci îl punem după fiecare setContent.
if (process.env.TEXT_SCALE) {
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (opts) => {
    const page = await newPage(opts)
    const setContent = page.setContent.bind(page)
    page.setContent = async (...args) => {
      await setContent(...args)
      await page.evaluate(() => document.documentElement.setAttribute('data-text-large', ''))
    }
    return page
  }
}

console.log('Bara de dependențe (IssueForm) — câmpul de căutare pe telefon:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${depsBar()}`)
  const m = await page.evaluate(() => {
    const input = document.querySelector('.dep-search-input-sm')
    const field = document.querySelector('.dep-search-field')
    const bar = document.querySelector('.deps-bar')
    const dd = document.querySelector('.dep-dropdown')
    const barRect = bar.getBoundingClientRect()
    return {
      input: Math.round(input.getBoundingClientRect().width),
      overflow: bar.scrollWidth - Math.round(barRect.width),
      // Dropdown-ul e `position: absolute` în `.dep-search-wrap-rel`; dacă
      // bara se înfășoară, trebuie să rămână ancorat sub câmp, nu sub taburi.
      ddAligned:
        Math.abs(dd.getBoundingClientRect().left - field.getBoundingClientRect().left) < 1,
    }
  })
  await page.close()

  check(`input @${width}px`, m.input >= MIN_INPUT_W, `${m.input}px (minim ${MIN_INPUT_W}px)`)
  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste bară`)
  check(`dropdown ancorat @${width}px`, m.ddAligned, m.ddAligned ? 'sub câmp' : 'deviat de câmp')
}

/**
 * Rândul de stare din foaia obstacolului: patru butoane `.seg` cu etichete
 * lungi („în așteptare"). Lățimea lui a fost verificată de două ori prin
 * aritmetică pe lățimi de glife, niciodată randată — bancul de probă din
 * `design/preview.html` nu poate arăta o strivire, doar o culoare.
 */
const segRow = () => `
<div class="sheet"><div class="sheet-scroll">
  <div class="seg-row">
    <button class="seg on">necunoscut</button>
    <button class="seg">în așteptare</button>
    <button class="seg">depășit</button>
    <button class="seg">ocolit</button>
  </div>
</div></div>`

console.log('\nRândul de stare din foaia obstacolului (`.seg`):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${segRow()}`)
  const m = await page.evaluate(() => {
    const row = document.querySelector('.seg-row')
    const segs = [...document.querySelectorAll('.seg')]
    const rowRect = row.getBoundingClientRect()
    return {
      overflow: row.scrollWidth - Math.round(rowRect.width),
      narrowest: Math.round(Math.min(...segs.map((s) => s.getBoundingClientRect().width))),
      // Un buton al cărui text e tăiat nu mai spune ce stare alegi.
      clipped: segs.some((s) => s.scrollWidth > Math.ceil(s.getBoundingClientRect().width) + 1),
    }
  })
  await page.close()

  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste rând`)
  check(`text netăiat @${width}px`, !m.clipped, m.clipped ? 'o etichetă e tăiată' : 'toate etichetele întregi')
  check(`buton vizibil @${width}px`, m.narrowest >= 40, `cel mai îngust ${m.narrowest}px`)
}

/**
 * Banda de valuri (`WaveTabs.tsx`): [Notițe] [valuri] [+] [moduri ✕] … [⋯].
 * Pe telefon derulează orizontal în interiorul ei; pagina nu are voie să
 * crească, iar „⋯" stă în afara derulării, deci trebuie să fie întreg pe
 * ecran la orice lățime. Pe desktop banda e un singur rând (mai jos). Cu un
 * singur val, Notițele și „⋯" urcă în rândul de taburi (`.tabs-tools`) —
 * la 320px rândul acela nu are voie să iasă din ecran.
 * Datele sunt MateCuSens (etichete lungi) plus două jetoane de mod.
 */
const PILLS = [
  ['MVP', 12], ['Extindere clase 7,8,12', 88, true], ['Discutie cu Mih…', 7], ['matecusens.ro', 11],
  ['2026-09-17', 2], ['Val VI', 0], ['Campuri aditiona…', 2], ['Cost Unitar', 1],
]
const waveBand = () => `
<div class="wave-band">
  <div class="wb-pills" role="tablist">
    <button class="wb-pill wb-scratch" role="tab"><svg width="16" height="16"></svg><span class="n">3</span></button>
    <span class="wb-sep"></span>
    ${PILLS.map(([l, n, on]) => `<button class="wb-pill${on ? ' on' : ''}" role="tab"><span class="lb">${l}</span><span class="n">${n}</span></button>`).join('')}
    <button class="wb-pill wb-add"><svg width="16" height="16"></svg></button>
    <button class="wb-mode"><span>Fără bifate</span><span class="x"><svg width="12" height="12"></svg></span></button>
    <button class="wb-mode"><span>Nepasate</span><span class="x"><svg width="12" height="12"></svg></span></button>
  </div>
  <span class="wb-more-wrap"><button class="wb-more"><svg width="18" height="18"></svg><span class="dot"></span></button></span>
</div>`
const tabsRow = (tools) => `
<div class="tabs">
  <button class="tab on">List</button><button class="tab">Cards</button><button class="tab">Hartă</button><button class="tab">Teme</button>
  <span class="tabs-tools">${tools}</span>
</div>`
const SOLO_TOOLS = `<span class="wb-tools"><button class="wb-pill wb-scratch"><svg width="16" height="16"></svg><span class="n">13</span></button><span class="wb-more-wrap"><button class="wb-more"><svg width="18" height="18"></svg></button></span></span>`

console.log('Banda de valuri (Listă / Cards):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="view"><div class="panel">${waveBand()}</div></div>`)
  const m = await page.evaluate(() => {
    const pills = document.querySelector('.wb-pills')
    const more = document.querySelector('.wb-more').getBoundingClientRect()
    const add = getComputedStyle(document.querySelector('.wb-add'))
    const pill = document.querySelector('.wb-pill:not(.on)')
    const ps = getComputedStyle(pill)
    return {
      doc: document.documentElement.scrollWidth,
      moreL: Math.round(more.left), moreR: Math.round(more.right), moreW: Math.round(more.width),
      scrolls: pills.scrollWidth > pills.clientWidth,
      overflowX: getComputedStyle(pills).overflowX,
      wraps: getComputedStyle(pills).flexWrap,
      pillH: Math.round(pill.getBoundingClientRect().height),
      pillVisible: ps.backgroundColor !== 'rgba(0, 0, 0, 0)' || ps.boxShadow !== 'none',
      addVisible: add.outlineStyle !== 'none' || add.backgroundColor !== 'rgba(0, 0, 0, 0)',
    }
  })
  await page.close()
  check(`pagina nu se lățește @${width}px`, m.doc <= width, `scrollWidth=${m.doc}px`)
  check(`„⋯" întreg pe ecran @${width}px`, m.moreL >= 0 && m.moreR <= width && m.moreW >= 30, `${m.moreL}–${m.moreR}px`)
  check(`banda derulează, nu se rupe @${width}px`, m.scrolls && m.overflowX === 'auto' && m.wraps === 'nowrap', `overflow-x: ${m.overflowX}, wrap: ${m.wraps}`)
  check(`pastilă atingibilă și vizibilă @${width}px`, m.pillH >= 30 && m.pillVisible, `${m.pillH}px, vizibilă=${m.pillVisible}`)
  check(`„+" vizibil @${width}px`, m.addVisible, m.addVisible ? 'contur punctat' : 'INVIZIBIL')
}

for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="view">${tabsRow(SOLO_TOOLS)}</div>`)
  const m = await page.evaluate(() => {
    const tools = document.querySelector('.tabs-tools').getBoundingClientRect()
    const tabs = [...document.querySelectorAll('.tab')].map((t) => t.getBoundingClientRect())
    return {
      doc: document.documentElement.scrollWidth,
      toolsR: Math.round(tools.right),
      // Calcă peste un tab doar dacă stă pe același rând cu el.
      overlap: tabs.some((t) => t.right > tools.left + 0.5 && t.bottom > tools.top + 0.5 && t.top < tools.bottom - 0.5),
      oneLine: new Set(tabs.map((t) => Math.round(t.top))).size === 1,
    }
  })
  await page.close()
  // Cu text mărit (TEXT_SCALE) uneltele au voie să cadă pe rândul următor —
  // dar nu să iasă din ecran sau să calce peste un tab.
  const lineOk = m.oneLine || Boolean(process.env.TEXT_SCALE)
  check(`un singur val: Notițe + „⋯" în rândul de taburi @${width}px`, m.doc <= width && m.toolsR <= width && !m.overlap && lineOk,
    `dreapta=${m.toolsR}px, suprapus=${m.overlap}, un rând=${m.oneLine}`)
}

// Desktop: banda e UN rând fix. Ce nu încape intră în „Încă N" după regula
// reală (`fitPills`, împachetată din `src/lib/waveBar.ts`), cu lățimile măsurate
// în stratul ascuns ca în `WaveTabs.tsx`. Coloana docată (~465px lângă panou)
// și o listă largă (1100px); plus valul activ dincolo de tăietură.
const { outputFiles: [fitBundle] } = await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../src/lib/waveBar.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'waveBar',
})
const deskBand = (activeIdx) => {
  const pill = ([l, n], i) => `<button class="wb-pill${i === activeIdx ? ' on' : ''}" role="tab" data-wave="${i}"><span class="lb">${l}</span><span class="n">${n}</span></button>`
  return `
<div class="wave-band">
  <div class="wb-pills" role="tablist">
    <button class="wb-pill wb-scratch" role="tab"><svg width="16" height="16"></svg><span class="lb">Notițe</span><span class="n">3</span></button>
    <span class="wb-sep"></span>
    ${PILLS.map(pill).join('')}
    <button class="wb-pill wb-add"><svg width="16" height="16"></svg></button>
    <button class="wb-mode"><span>Nepasate</span><span class="x"><svg width="12" height="12"></svg></span></button>
  </div>
  <span class="wb-more-wrap"><button class="wb-more"><svg width="18" height="18"></svg></button></span>
  <div class="wb-measure"><div class="wb-measure-row">
    <span class="wb-measure-fixed">
      <button class="wb-pill wb-scratch" role="tab"><svg width="16" height="16"></svg><span class="lb">Notițe</span><span class="n">3</span></button>
      <span class="wb-sep"></span>
      <button class="wb-pill wb-add"><svg width="16" height="16"></svg></button>
      <button class="wb-mode"><span>Nepasate</span><span class="x"><svg width="12" height="12"></svg></span></button>
    </span>
    ${PILLS.map((p, i) => pill(p, i).replace('data-wave', 'data-mwave')).join('')}
    <button class="wb-pill wb-over"><span class="lb">Încă ${PILLS.length}</span><svg width="14" height="14"></svg></button>
  </div></div>
</div>`
}
for (const [width, activeIdx] of [[465, 1], [1100, 1], [465, PILLS.length - 1]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div style="width:${width}px"><div class="panel">${deskBand(activeIdx)}</div></div>`)
  await page.addScriptTag({ content: fitBundle.text })
  const m = await page.evaluate((activeIdx) => {
    // Același calcul ca `fitRef` din `WaveTabs.tsx`.
    const row = document.querySelector('.wb-pills')
    const cs = getComputedStyle(row)
    const gap = parseFloat(cs.columnGap) || 0
    const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const outer = (el) => { const c = getComputedStyle(el); return el.getBoundingClientRect().width + parseFloat(c.marginLeft) + parseFloat(c.marginRight) }
    let fixed = 0
    for (const el of document.querySelectorAll('.wb-measure-fixed > *')) fixed += outer(el) + gap
    const widths = [...document.querySelectorAll('[data-mwave]')].map((e) => outer(e) + gap)
    const overW = outer(document.querySelector('.wb-measure .wb-over')) + gap
    const fit = window.waveBar.fitPills(widths, inner + gap - fixed + 0.5, activeIdx, overW)
    const pills = [...row.querySelectorAll('[data-wave]')]
    pills.forEach((p, i) => { if (!fit.shown.includes(i)) p.remove() })
    if (fit.overflow.length) {
      const last = row.querySelectorAll('[data-wave]')
      last[last.length - 1].insertAdjacentHTML('afterend',
        `<span class="wb-over-wrap"><button class="wb-pill wb-over"><span class="lb">Încă ${fit.overflow.length}</span><svg width="14" height="14"></svg></button></span>`)
    }
    const band = document.querySelector('.wave-band').getBoundingClientRect()
    const items = [...row.children].map((e) => e.getBoundingClientRect())
    const rb = row.getBoundingClientRect()
    return {
      shown: fit.shown.length, over: fit.overflow.length,
      activeShown: fit.shown.includes(activeIdx),
      // Cât a cedat activul față de lățimea lui firească (0 = întreg).
      squeezed: Math.round(document.querySelector(`[data-mwave="${activeIdx}"]`).getBoundingClientRect().width - row.querySelector('.wb-pill.on[data-wave]').getBoundingClientRect().width),
      rows: new Set(items.map((r) => Math.round(r.top + r.height / 2))).size,
      bandH: Math.round(band.height),
      inside: items.every((r) => r.left >= rb.left - 0.5 && r.right <= rb.right + 0.5),
      overflow: Math.round(row.scrollWidth - row.clientWidth),
      doc: document.documentElement.scrollWidth,
    }
  }, activeIdx)
  await page.close()
  const tag = `${width}px, activ #${activeIdx}`
  check(`desktop (${tag}): banda pe un singur rând`, m.rows === 1 && m.bandH <= 52, `${m.rows} rând(uri), ${m.bandH}px, ${m.shown} pe rând + ${m.over} în „Încă"`)
  check(`desktop (${tag}): nimic tăiat sau în afara benzii`, m.inside && m.overflow <= 0 && m.doc <= 1280, `overflow=${m.overflow}px`)
  check(`desktop (${tag}): valul activ pe rând`, m.activeShown, m.activeShown ? `vizibil, cedat ${m.squeezed}px` : 'ÎN MENIU')
  if (m.shown > 1) check(`desktop (${tag}): activul întreg când încape`, m.squeezed <= 0, `cedat ${m.squeezed}px`)
}

/**
 * Bara de jos (`TabBar` din App.tsx) — trei butoane cu `flex: 1` („Proiecte"
 * s-a mutat în sertar). „Ale mele" e eticheta cea mai lungă. Trei lucruri
 * contează cu adevărat: eticheta nu se rupe pe două rânduri (butoanele sunt
 * `flex-direction: column`, deci o a doua linie crește ÎNĂLȚIMEA, nu
 * lățimea — un check de lățime n-ar prinde-o), butonul rămâne atingibil, iar
 * bara nu depășește lățimea disponibilă.
 */
const tabBar = () => `
<nav class="tabbar">
  <button data-tab="today"><span class="tb-ico"><svg width="21" height="21"></svg></span>Azi</button>
  <button data-tab="week"><span class="tb-ico"><svg width="21" height="21"></svg></span>7 zile</button>
  <button class="on" data-tab="inbox"><span class="tb-ico"><svg width="21" height="21"></svg><span class="tb-badge">12</span></span>Ale mele</button>
</nav>`

console.log('\nBara de jos (`TabBar`) — trei butoane pe telefon:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.setContent(`<style>${CSS}</style>${tabBar()}`)
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.tabbar')
    const btns = [...document.querySelectorAll('.tabbar button')]
    // `align-items: stretch` (implicit pe un flex row) egalizează înălțimea
    // TUTUROR butoanelor cu cel mai înalt vecin — deci o etichetă ruptă pe
    // două rânduri nu se vede NICIODATĂ într-o comparație de înălțimi ale
    // cutiei (toate ies la fel, stretch-uite). Trebuie numărate liniile
    // TEXTULUI direct, cu `Range.getClientRects()`: un nod-text pe un rând dă
    // un dreptunghi, pe două rânduri dă două.
    const wrapped = btns.map((b) => {
      const textNode = [...b.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      if (!textNode) return false
      const range = document.createRange()
      range.selectNodeContents(textNode)
      return range.getClientRects().length > 1
    })
    return {
      overflow: nav.scrollWidth - Math.round(nav.getBoundingClientRect().width),
      narrowest: Math.round(Math.min(...btns.map((b) => b.getBoundingClientRect().width))),
      wrapped,
    }
  })
  await page.close()

  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste bară`)
  check(
    `etichetă pe un rând @${width}px`,
    !m.wrapped.some(Boolean),
    m.wrapped.some(Boolean) ? `butonul #${m.wrapped.indexOf(true) + 1} s-a rupt pe două rânduri` : 'toate pe un rând',
  )
  check(`buton atingibil @${width}px`, m.narrowest >= 44, `cel mai îngust ${m.narrowest}px`)
}

/**
 * Rândul de jetoane din `IssueForm.tsx` (design/form-compact): între titlu și
 * descriere, un singur rând cu NUMAI ce e setat. Cazul cel mai rău: totul
 * setat, cu nume lungi. Rândul are voie să se rupă pe două rânduri, dar nimic
 * nu iese din el — nici pe telefon, nici în panoul lateral de ~500px, nici cu
 * textul mărit. Iar popoverul datei (foaie de jos pe telefon, ancorat în
 * panou) nu iese din ecran, cu calendarul și ceasul încă atingibile.
 */
const CHIP = (cls, inner) => `<button type="button" class="fc-chip ${cls}" data-chip="">${inner}</button>`
const SVG = '<svg width="14" height="14"></svg>'
const chipRow = (pop = '') => `
<div class="fc-row" role="toolbar">
  ${CHIP('due late', `${SVG}Mâine <span class="fc-t">17:00</span>`)}
  ${CHIP('', `${SVG}−1 zi`)}
  ${CHIP('', `${SVG}Lunea și joia`)}
  ${CHIP('', `${SVG}Scratchpad`)}
  ${CHIP('', '<span class="fc-dot" style="background:#7C3AED"></span><span class="fc-chip-t">Raportare lunară</span>')}
  ${CHIP('who', '<span class="fc-av">AL</span><span class="fc-chip-t">Alexandru Popescu</span>')}
  ${CHIP('urgent', `${SVG}Urgent`)}
  ${CHIP('icon', '<svg width="16" height="16"></svg>')}
  ${CHIP('icon', '<svg width="16" height="16"></svg>')}
  ${pop}
</div>`
const datePop = (sheet) => `
<div class="fc-pop ${sheet ? 'fc-sheet' : ''}" role="dialog" style="${sheet ? '' : 'left:0'}">
  ${sheet ? '<div class="fc-grab"></div>' : ''}
  <h4 class="fc-h">Ziua</h4>
  <div class="fc-presets">
    <button class="fc-pre on">Azi<small>mie 14</small></button>
    <button class="fc-pre">Mâine<small>joi 15</small></button>
    <button class="fc-pre">Luni<small>19 oct</small></button>
    <button class="fc-pre">+1 săpt.<small>21 oct</small></button>
  </div>
  <div class="fc-fields">
    <span class="native-pick fc-pick fc-pick-date"><svg width="16" height="16"></svg><span class="fc-pick-t">Mâine</span><small class="fc-pick-sub">sâm 18 oct 2027</small><input class="native-pick-input" type="date"></span>
    <span class="fc-time set"><span class="native-pick fc-pick fc-pick-time"><svg width="16" height="16"></svg><span class="fc-pick-t">09:30</span><input class="native-pick-input" type="time"></span><button class="fc-pick-x"><svg width="14" height="14"></svg></button></span>
    <button class="fc-link">scoate</button>
  </div>
  <h4 class="fc-h">Memento</h4>
  <div class="fc-seg"><button class="on">la oră</button><button>−30m</button><button>−1 zi</button><button>fără</button></div>
  <p class="fc-recur"><svg width="13" height="13"></svg><span>Se repetă: lunea și joia</span><span>·</span><button class="fc-link">scoate</button></p>
</div>`
const formHead = (pop = '') => `
  <div class="sh-header">
    <span class="sh-id">EX-01</span>
    <button class="sh-close">x</button>
    <span class="sh-break"></span>
    <button class="sh-check"><span class="ck"></span></button>
    <span class="sh-title-wrap"><textarea class="sh-title-input" rows="1">Adresă email proiect</textarea></span>
    ${chipRow(pop)}
    <button class="sh-save">^</button>
  </div>
  <div class="sheet-scroll if-body"><div class="form-cols"><div class="form-col form-col-desc">desc</div></div></div>`

/** Măsurătorile comune: nimic nu iese din rând; jetoanele rămân jetoane. */
const measureRow = () => {
  const row = document.querySelector('.fc-row')
  const r = (el) => el.getBoundingClientRect()
  const chips = [...row.querySelectorAll(':scope > .fc-chip')]
  const out = chips.filter((c) => r(c).right > r(row).right + 1 || r(c).left < r(row).left - 1)
  // Un jeton cu text tăiat la zero („…" fără literă) nu mai spune nimic.
  const crushed = chips.filter((c) => r(c).width < 28)
  return {
    overflow: row.scrollWidth - row.clientWidth,
    out: out.length,
    crushed: crushed.length,
    lowest: Math.round(Math.min(...chips.map((c) => r(c).height))),
    docOverflow: document.documentElement.scrollWidth - innerWidth,
    // Aliniat cu textul titlului, nu cu bifa.
    alignGap: Math.round(r(chips[0]).left - r(document.querySelector('.sh-title-wrap')).left),
    // Pe telefon rândul pornește de sub bifă (ca foaia de tichet), nu de sub titlu.
    checkGap: Math.round(r(chips[0]).left - r(document.querySelector('.sh-check .ck') ?? document.querySelector('.sh-title-wrap')).left),
  }
}

console.log('\nRândul de jetoane al formularului (telefon, formularul complet):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="sheet on tall" style="position:static;transform:none;width:100%">${formHead()}</div>`)
  const m = await page.evaluate(measureRow)
  await page.close()
  check(`rândul nu iese din foaie @${width}px`, m.overflow <= 0 && m.out === 0 && m.docOverflow <= 0, `${m.overflow}px, ${m.out} jetoane afară, pagina +${m.docOverflow}px`)
  check(`jetoane nestrivite @${width}px`, m.crushed === 0, `${m.crushed} sub 28px`)
  check(`jetoane atingibile @${width}px`, m.lowest >= 30, `cel mai scund ${m.lowest}px`)
  check(`aliniat cu bifa @${width}px`, Math.abs(m.checkGap) <= 1, `${m.checkGap}px față de bifă`)
}

console.log('\nRândul de jetoane în panoul lateral (~500px):')
{
  // 1280px fereastră, din care sidebar-ul ia ~240px: lista + panoul au ~1000px.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="split has-pane" style="height:900px;width:1000px"><div class="split-list"></div><aside class="split-pane">${formHead(datePop(false))}</aside></div>`)
  const m = await page.evaluate(() => {
    const pane = document.querySelector('.split-pane')
    const pop = document.querySelector('.fc-pop')
    const r = (el) => el.getBoundingClientRect()
    return {
      paneW: Math.round(r(pane).width),
      popOut: Math.round(r(pop).right - r(pane).right),
      popOverflow: pop.scrollWidth - pop.clientWidth,
      dueOut: Math.round(Math.max(...[...pop.querySelectorAll('.fc-fields > *')].map((el) => r(el).right)) - r(pop).right),
      cut: [...pop.querySelectorAll('.fc-pick-t, .fc-pick-sub')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
    }
  })
  const row = await page.evaluate(measureRow)
  await page.close()
  check('panoul are lățimea de panou', m.paneW >= 440 && m.paneW <= 620, `${m.paneW}px`)
  check('rândul nu iese din panou', row.overflow <= 0 && row.out === 0, `${row.overflow}px, ${row.out} jetoane afară`)
  check('jetoane nestrivite în panou', row.crushed === 0, `${row.crushed} sub 28px`)
  check('aliniat cu titlul în panou', Math.abs(row.alignGap) <= 1, `${row.alignGap}px`)
  check('popoverul datei încape în panou', m.popOut <= 0 && m.popOverflow <= 0, `${m.popOut}px peste panou, ${m.popOverflow}px în el`)
  check('butoanele de zi și oră încap în popover', m.dueOut <= 0, `${m.dueOut}px peste`)
  check('etichetele zilei și orei întregi în popover', m.cut === 0, `${m.cut} tăiate`)
}

console.log('\nPopoverul datei ca foaie de jos (telefon):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="sheet on tall" style="position:static;transform:none;width:100%">${formHead()}</div>${datePop(true)}`)
  const m = await page.evaluate(() => {
    const pop = document.querySelector('.fc-sheet')
    const fields = [...document.querySelectorAll('.fc-sheet .fc-fields > *')]
    const picks = [...document.querySelectorAll('.fc-sheet .fc-pick, .fc-sheet .fc-pick-x')]
    const pres = [...document.querySelectorAll('.fc-sheet .fc-pre')]
    const r = (el) => el.getBoundingClientRect()
    return {
      popW: Math.round(r(pop).width),
      popOverflow: pop.scrollWidth - pop.clientWidth,
      fieldOut: Math.round(Math.max(...fields.map((el) => r(el).right)) - r(pop).right),
      fieldOverflow: [...document.querySelectorAll('.fc-sheet .fc-pick-t, .fc-sheet .fc-pick-sub')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
      pick: Math.round(Math.min(...picks.map((p) => Math.min(r(p).width, r(p).height)))),
      preWrapped: pres.some((p) => p.scrollWidth > p.clientWidth + 1),
      docOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  await page.close()
  check(`foaia pe toată lățimea @${width}px`, m.popW === width && m.docOverflow <= 0, `${m.popW}px, pagina +${m.docOverflow}px`)
  check(`nimic nu iese din foaie @${width}px`, m.popOverflow <= 0 && m.fieldOut <= 0, `${m.popOverflow}px / câmp +${m.fieldOut}px`)
  check(`etichetele zilei și orei întregi @${width}px`, m.fieldOverflow === 0, `${m.fieldOverflow} tăiate`)
  check(`butoanele zi/oră/✕ atingibile @${width}px`, m.pick >= 32, `cel mai mic ${m.pick}px`)
  check(`presetările întregi @${width}px`, !m.preWrapped, m.preWrapped ? 'o presetare iese din casetă' : 'toate încap')
}

/**
 * Titlul tichetului — se rupe pe rânduri, nu se taie.
 *
 * Un `<input>` nu poate face asta, iar pe telefon nu există hover, deci un
 * titlu tăiat nu se mai poate citi NICĂIERI. Două lucruri se verifică aici,
 * și al doilea e cel care sparge tăcut: oglinda de evidențiere a datei stă
 * peste câmp, deci trebuie să se rupă în ACELEAȘI locuri — orice diferență de
 * `white-space` sau de `overflow-wrap` decalează marcajul, la fel ca un font
 * diferit. Iar butoanele rotunde din antet trebuie să rămână la primul rând.
 */
const LONG = 'Cont Supabase cu politici RLS conștiente de membership și rotație de chei'
const titleHead = (title) => `
<div class="sheet card" style="width:100%">
  <div class="sh-header">
    <button class="sh-close">x</button>
    <span class="sh-title-wrap">
      <span class="sh-title-mirror" aria-hidden="true"><span>${title}</span></span>
      <textarea class="sh-title-input" rows="1" style="height:auto">${title}</textarea>
    </span>
    <button class="sh-save">^</button>
  </div>
</div>`

console.log('\nTitlul din formular (mobil) — rupere pe rânduri:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${titleHead(LONG)}`)
  const m = await page.evaluate(() => {
    const ta = document.querySelector('.sh-title-input')
    const mirror = document.querySelector('.sh-title-mirror')
    const head = document.querySelector('.sh-header')
    const save = document.querySelector('.sh-save')
    const r = (el) => el.getBoundingClientRect()
    // Exact ce face `useLayoutEffect`-ul din IssueForm: `height:auto` pe un
    // `<textarea>` NU se strânge pe conținut (cade pe `rows`), deci înălțimea
    // se pune în pixeli din `scrollHeight`. Dacă testul ar sări peste pasul
    // ăsta, ar măsura mereu un singur rând.
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    return {
      lines: Math.round(ta.scrollHeight / 26),
      clipped: ta.scrollHeight - Math.round(r(ta).height) > 1,
      mirrorGap: Math.abs(mirror.scrollHeight - ta.scrollHeight),
      saveOnFirstLine: r(save).top - r(head).top <= 8,
    }
  })
  await page.close()

  check(`titlul se rupe @${width}px`, m.lines >= 2, `${m.lines} rânduri`)
  check(`titlul întreg @${width}px`, !m.clipped, m.clipped ? 'TĂIAT sub plafon' : 'tot textul e vizibil')
  check(`oglinda se rupe la fel @${width}px`, m.mirrorGap <= 1, `${m.mirrorGap}px diferență`)
  check(`butoanele sus @${width}px`, m.saveOnFirstLine, m.saveOnFirstLine ? 'la primul rând' : 'coborâte la mijloc')
}

/**
 * Titlul de pe cardul din „Ordine" — trei rânduri, nu unul.
 *
 * Bulina cu titlul complet (`.tk[data-title]::after`) cere hover, deci pe
 * telefon nu există. Cardul e singurul loc unde titlul se poate citi.
 */
console.log('\nTitlul de pe card (mobil) — câte rânduri se văd:')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await page.setContent(
    `<style>${CSS}</style><div class="tk" style="width:168px">` +
    `<div class="tk-meta"><span class="tk-id">HZ-14</span></div><h5>${LONG}</h5></div>`,
  )
  const m = await page.evaluate(() => {
    const h5 = document.querySelector('.tk h5')
    const line = parseFloat(getComputedStyle(h5).lineHeight)
    return { lines: Math.round(h5.getBoundingClientRect().height / line) }
  })
  await page.close()
  check('cardul arată mai mult de un rând', m.lines >= 2, `${m.lines} rânduri`)
  check('cardul nu crește la nesfârșit', m.lines <= 3, `${m.lines} rânduri (plafon 3)`)
}

/**
 * Cardul Android din „Azi" (`AndroidReminderCard`), varianta cu cel mai mult
 * conținut: reconectarea, cu câmp de parolă + „Conectează" în coloana de
 * text, lângă iconiță și „×". Plus rândul cel mai lung din ecranul de
 * verificare (`AndroidStatus`), cu valoare lungă, link și notă.
 */
const androidCard = () => `
<div class="push-cta">
  <span class="push-cta-ico"><svg width="20" height="20"></svg></span>
  <div class="push-cta-txt">
    <strong>Reconectează mementourile</strong>
    <span>Aplicația nu mai are sesiune: mementourile nu se sincronizează.</span>
    <form class="android-pass"><input type="password" placeholder="Parola"><button type="submit" class="push-cta-btn">Conectează</button></form>
  </div>
  <button class="push-cta-x"><svg width="15" height="15"></svg></button>
</div>
<div class="info-card"><div class="info-body"><section class="info-sec and-status">
  <div class="and-head"><h3>Aplicația de Android</h3><button class="and-reload"><svg width="13" height="13"></svg>Reîncarcă</button></div>
  <dl class="and-rows">
    <div class="and-row"><dt>Alarme exacte</dt><dd><span class="and-val">nu încă — se vor pune la următoarea alarmă</span></dd></div>
    <div class="and-row"><dt>Baterie</dt><dd><span class="and-val">optimizată</span><button class="and-link">Setări</button><span class="and-note">Producătorul poate opri aplicația în fundal</span></dd></div>
  </dl>
</section></div></div>`

console.log('\nCardul Android (Azi) și ecranul de verificare:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${androidCard()}`)
  const m = await page.evaluate(() => {
    const card = document.querySelector('.push-cta').getBoundingClientRect()
    const input = document.querySelector('.android-pass input').getBoundingClientRect()
    const btn = document.querySelector('.android-pass button')
    const b = btn.getBoundingClientRect()
    const bs = getComputedStyle(btn)
    const reload = getComputedStyle(document.querySelector('.and-reload'))
    const sec = document.querySelector('.and-status').getBoundingClientRect()
    const rows = [...document.querySelectorAll('.and-row')]
    return {
      input: Math.round(input.width),
      overflow: Math.round(Math.max(b.right, input.right) - card.right),
      btnVisible: bs.backgroundColor !== 'rgba(0, 0, 0, 0)' || bs.boxShadow !== 'none',
      reloadVisible: reload.backgroundColor !== 'rgba(0, 0, 0, 0)' || reload.boxShadow !== 'none',
      rowOverflow: Math.round(Math.max(...rows.map((r) => r.scrollWidth - r.clientWidth))),
      secInside: sec.right <= window.innerWidth,
    }
  })
  await page.close()
  check(`parola nestrivită @${width}px`, m.input >= MIN_INPUT_W, `${m.input}px (minim ${MIN_INPUT_W}px)`)
  check(`fără overflow în card @${width}px`, m.overflow <= 0, `${m.overflow}px peste card`)
  check(`„Conectează" vizibil @${width}px`, m.btnVisible, m.btnVisible ? 'are fundal' : 'INVIZIBIL')
  check(`„Reîncarcă" vizibil @${width}px`, m.reloadVisible, m.reloadVisible ? 'are fundal' : 'INVIZIBIL')
  check(`rândurile de stare încap @${width}px`, m.rowOverflow <= 0 && m.secInside, `${m.rowOverflow}px peste rând`)
}

/**
 * Rândul de controale al foii rapide (`QuickSheet.tsx`) și al foii de tichet
 * (`EditSheet.tsx`, fără Trimite): trimite și iconițele au `flex-shrink: 0`,
 * jetonul de dată și proiectul se micșorează. Cazul cel mai rău: dată lungă
 * cu oră, nume de proiect lung, om ales. Trimite nu are voie să fie strivit
 * sau împins afară, proiectul nu are voie să dispară, și niciun control nu
 * rămâne fără fundal. Plus cazul obișnuit, „Mâine 10:00" și „Exemplu": la
 * 390px amândouă se citesc întregi — înainte ieșea „Mâine 10:…" și „Exem…".
 */
const ATTACH = (menu = false) => `<span class="qs-attach-wrap"><button type="button" class="qs-ico qs-attach on"><svg width="16" height="16"></svg><span class="qs-attach-n">3</span></button>${menu ? '<span class="qs-attach-menu"><button type="button"><svg width="16" height="16"></svg> Fă o poză</button><button type="button"><svg width="16" height="16"></svg> Alege fișier</button></span>' : ''}<input class="att-pick-input" type="file"></span>`
const quickBar = ({ day = 'Mie 07/10', time = '10:00', proj = 'Aplicație Turism și încă ceva lung', send = true, menu = false } = {}) => `
<div class="kb-sheet quick-sheet" style="animation:none"><form class="qs-form">
  <span class="qa-wrap"><span class="qa-mirror"></span><input class="qa-input" value="Sună la bancă"></span>
  <textarea class="qa-desc" rows="1" placeholder="Descriere"></textarea>
  <div class="qs-bar">
    <button type="button" class="qs-due on"><svg width="15" height="15"></svg><span class="qs-due-t">${day}</span><span class="qs-due-h">${time}</span></button>
    <label class="qs-sel qs-proj"><span class="t-dot" style="background:#6e7bff"></span><span class="qs-sel-t">${proj}</span><select><option>x</option></select></label>
    ${send ? '' : '<button type="button" class="qs-ico qs-who-badge">MIH</button>'}
    <span class="qs-tools">
    <button type="button" class="qs-ico qs-urgent on"><svg width="16" height="16"></svg></button>
    ${ATTACH(menu)}
    <button type="button" class="qs-ico qs-more"><svg width="16" height="16"></svg></button>
    ${send ? '<button type="submit" class="qs-send"><svg width="18" height="18"></svg></button>' : ''}
    </span>
  </div>
</form></div>`

/** Se citește întreg: textul nu e tăiat cu „…" (nici ascuns de container query). */
const readable = (page) => page.evaluate(() => {
  const cut = (el) => !el || el.offsetParent === null ? 'ascuns' : el.scrollWidth > el.clientWidth + 0.5 ? 'tăiat' : 'întreg'
  return {
    day: cut(document.querySelector('.qs-due-t')),
    time: cut(document.querySelector('.qs-due-h')),
    proj: cut(document.querySelector('.qs-proj .qs-sel-t')),
  }
})

console.log('\nRândul obișnuit la 390px — „Mâine 10:00", „Exemplu":')
for (const send of [true, false]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${quickBar({ day: 'Mâine', proj: 'Exemplu', send })}`)
  const r = await readable(page)
  await page.close()
  const name = send ? 'foaia rapidă' : 'foaia de tichet'
  check(`${name}: ziua se citește întreagă`, r.day === 'întreg', r.day)
  check(`${name}: proiectul se citește întreg`, r.proj === 'întreg', r.proj)
  // Cu Trimite pe rând ora cedează locul (container query); fără el, încape.
  if (!send) check(`${name}: ora se citește întreagă`, r.time === 'întreg', r.time)
}

for (const send of [true, false]) {
console.log(`\nRândul de controale al foii ${send ? 'rapide' : 'de tichet (cu inițiale)'} (\`.qs-bar\`) — cu agrafa:`)
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${quickBar({ send })}`)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.qs-bar')
    const r = (sel) => document.querySelector(sel).getBoundingClientRect()
    const barR = bar.getBoundingClientRect()
    const send = document.querySelector('.qs-send')?.getBoundingClientRect() ?? r('.qs-more')
    const attach = r('.qs-attach')
    // `.qs-tools` e doar grupul comutatoarelor (fără fundal, deliberat): se
    // verifică fiecare control din el, nu cutia.
    const kids = [...bar.children, ...bar.querySelector('.qs-tools').children]
      .filter((el) => !el.classList.contains('qs-attach-wrap') && !el.classList.contains('qs-tools'))
      .concat([document.querySelector('.qs-attach')])
    const invisible = kids.filter((el) => {
      const cs = getComputedStyle(el)
      return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderStyle === 'none'
    }).map((el) => el.className)
    return {
      overflow: bar.scrollWidth - Math.round(barR.width),
      sendW: Math.round(send.width),
      sendInside: send.right <= barR.right + 0.5,
      proj: Math.round(r('.qs-proj').width),
      due: Math.round(r('.qs-due').width),
      attachW: Math.round(attach.width),
      // Comutatoarele (urgent, agrafă, „…") stau lipite unul de altul, la
      // dreapta, după jetoanele cu text — golul elastic e înaintea lui urgent.
      toolsGap: Math.round(attach.left - r('.qs-urgent').right),
      // Cu text mărit grupul poate trece întreg pe rândul al doilea.
      toolsAfterText: r('.qs-urgent').left >= r('.qs-proj').right || r('.qs-urgent').top >= r('.qs-proj').bottom,
      invisible,
    }
  })
  await page.close()
  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste rând`)
  check(`${send ? 'trimite' : '„…"'} nestrivit @${width}px`, m.sendW >= 34 && m.sendInside, `${m.sendW}px${m.sendInside ? '' : ', împins afară'}`)
  check(`agrafa nestrivită @${width}px`, m.attachW >= 34, `${m.attachW}px`)
  check(`proiectul vizibil @${width}px`, m.proj >= 40, `${m.proj}px`)
  check(`urgent grupat cu agrafa, la dreapta @${width}px`, m.toolsAfterText && m.toolsGap <= 6, `${m.toolsGap}px până la agrafă`)
  check(`jetonul de dată vizibil @${width}px`, m.due >= 34, `${m.due}px`)
  check(`fiecare control are fundal @${width}px`, m.invisible.length === 0, m.invisible.length ? `INVIZIBIL: ${m.invisible.join(', ')}` : 'toate')
}
}

/**
 * Meniul agrafei („Fă o poză" / „Alege fișier") stă deasupra butonului,
 * aliniat la dreapta lui. La 320px nu are voie să iasă din ecran pe stânga,
 * iar cele două rânduri se citesc întregi.
 */
console.log('\nMeniul agrafei:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style><div style="height:300px"></div>${quickBar({ menu: true })}`)
  const m = await page.evaluate(() => {
    const menu = document.querySelector('.qs-attach-menu').getBoundingClientRect()
    const btns = [...document.querySelectorAll('.qs-attach-menu button')]
    const cs = getComputedStyle(document.querySelector('.qs-attach-menu'))
    return {
      left: Math.round(menu.left), right: Math.round(menu.right),
      cut: btns.some((b) => b.scrollWidth > b.clientWidth + 0.5),
      bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
    }
  })
  await page.close()
  check(`meniul în ecran @${width}px`, m.left >= 0 && m.right <= width, `${m.left}–${m.right}px`)
  check(`rândurile meniului întregi @${width}px`, !m.cut, m.cut ? 'tăiate' : 'întregi')
  check(`meniul are fundal @${width}px`, m.bg, m.bg ? 'da' : 'INVIZIBIL')
}

/**
 * Rândul de miniaturi din foaia de tichet (`ThumbRow`): 44px, aliniat cu
 * titlul (după bifă), derulează pe orizontală — mai multe poze nu lățesc
 * foaia. O miniatură în curs de urcare are rotița deasupra.
 */
const thumbs = (n) => `
<div class="kb-sheet edit-sheet" style="animation:none"><div class="qs-form">
  <div class="es-head"><button class="es-check"><svg width="20" height="20"></svg></button>
    <span class="es-title-wrap"><span class="es-title-mirror">Ședință <mark>la 17</mark></span><textarea class="es-title" rows="1">Ședință la 17</textarea></span></div>
  <div class="es-files att-strip">${Array.from({ length: n }, (_, i) => i === n - 1
    ? '<span class="att-chip img es-file-up"><span class="att-ic off"><svg width="20" height="20"></svg></span><span class="es-file-veil"><svg width="16" height="16"></svg></span></span>'
    : '<span class="att-chip img"><button class="att-open"><svg width="20" height="20"></svg></button></span>').join('')}</div>
  <textarea class="qa-desc" rows="1">Descriere</textarea>
</div></div>`
console.log('\nMiniaturile din foaia de tichet:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${thumbs(12)}`)
  const m = await page.evaluate(() => {
    const row = document.querySelector('.es-files')
    const chip = document.querySelector('.es-files .att-chip').getBoundingClientRect()
    const title = document.querySelector('.es-title').getBoundingClientRect()
    const sheet = document.querySelector('.kb-sheet')
    const mark = document.querySelector('.es-title-mirror mark').getBoundingClientRect()
    return {
      w: Math.round(chip.width), h: Math.round(chip.height),
      scrolls: row.scrollWidth > row.clientWidth,
      sheetOverflow: sheet.scrollWidth - sheet.clientWidth,
      aligned: Math.abs(row.getBoundingClientRect().left - title.left) < 1,
      markH: Math.round(mark.height),
    }
  })
  await page.close()
  check(`miniatura 44px @${width}px`, m.w === 44 && m.h === 44, `${m.w}×${m.h}`)
  check(`rândul derulează, foaia nu se lățește @${width}px`, m.scrolls && m.sheetOverflow <= 0, `scroll=${m.scrolls}, foaie +${m.sheetOverflow}px`)
  check(`miniaturile aliniate cu titlul @${width}px`, m.aligned, m.aligned ? 'da' : 'decalate')
  check(`marcajul de dată pe un rând de titlu @${width}px`, m.markH > 0 && m.markH <= 30, `${m.markH}px`)
}

/**
 * Modul de selecție de pe telefon (`SelectionChrome.tsx`) și banda glisării
 * (`TaskRow.tsx`). Bara de jos are cinci butoane, nu patru ca bara de tab-uri,
 * deci la 320px fiecare primește mai puțin; banda din dreapta trebuie să
 * încapă în lățimea pe care o dezvăluie glisarea (`REVEAL_RIGHT` din
 * `src/lib/swipe.ts` — 222px), altfel ultimul buton rămâne sub rând.
 */
const REVEAL_RIGHT = 222
const REVEAL_LEFT = 72
const selection = () => `
<header class="sel-head">
  <button class="back"><svg width="20" height="20"></svg></button>
  <h1 class="sel-count"><span class="sel-num">12</span> selectate</h1>
  <button class="sel-all">Toate</button>
</header>
<div class="smart-list">
  <div class="list-group">
    <div class="list-group-head">
      <span class="list-group-num">12</span><span class="list-group-label">Restanțe</span>
      <button class="group-act">Mută restanțele pe azi</button>
    </div>
    <div class="swipe show-right" id="sr">
      <div class="swipe-strip swipe-right">
        <span class="native-pick swipe-btn lead" data-pick="date"><svg width="18" height="18"></svg><input type="date" class="native-pick-input" aria-label="Dată"></span>
        <span class="native-pick swipe-btn" data-pick="time"><svg width="18" height="18"></svg><input type="time" class="native-pick-input" aria-label="Oră"></span>
        <button class="swipe-btn danger" aria-label="Șterge"><svg width="18" height="18"></svg></button>
        <button class="swipe-btn" aria-label="Mai multe"><svg width="18" height="18"></svg></button>
      </div>
      <button class="list-row task-row" style="transform: translateX(-${REVEAL_RIGHT}px)">
        <span class="list-check"></span><span class="t-time">09:30</span><span class="list-title">Sună la bancă pentru extras</span>
      </button>
    </div>
    <div class="swipe show-left" id="sl">
      <div class="swipe-strip swipe-left">
        <button class="swipe-btn primary"><svg width="18" height="18"></svg></button>
      </div>
      <button class="list-row task-row selected" style="transform: translateX(${REVEAL_LEFT}px)">
        <span class="list-check"><span class="sel-mark"></span></span><span class="t-time">—</span><span class="list-title">Plătește chiria</span>
      </button>
    </div>
  </div>
</div>
<nav class="tabbar sel-bar">
  <button class="primary"><span class="tb-ico"><svg width="21" height="21"></svg></span>Dată</button>
  <button><span class="tb-ico"><svg width="21" height="21"></svg></span>Urgent</button>
  <button><span class="tb-ico"><svg width="21" height="21"></svg></span>Gata</button>
  <button class="danger"><span class="tb-ico"><svg width="21" height="21"></svg></span>Șterge</button>
  <button><span class="tb-ico"><svg width="21" height="21"></svg></span>Mai mult</button>
</nav>
<div class="action-sheet date-sheet" id="ds">
  <div class="ds-grid">
    ${['Azi', 'Mâine', '+1 zi', 'Luni viitoare'].map((l) => `<button class="ds-opt"><span class="ds-label">${l}</span><span class="ds-hint">lun 12/10</span></button>`).join('')}
    ${[['date', 'Alege data…'], ['time', 'Oră…']].map(([t, l]) => `<span class="native-pick ds-opt"><span class="ds-label">${l}</span><span class="ds-hint">calendar</span><input type="${t}" class="native-pick-input" aria-label="${l}"></span>`).join('')}
    <button class="ds-opt ds-wide"><span class="ds-label">Fără dată</span></button>
  </div>
</div>`

console.log('\nModul de selecție și banda glisării (telefon):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${selection()}`)
  const m = await page.evaluate(([revR, revL]) => {
    const r = (el) => el.getBoundingClientRect()
    const bar = document.querySelector('.sel-bar')
    const btns = [...bar.querySelectorAll('button')]
    const head = document.querySelector('.sel-head')
    const all = document.querySelector('.sel-all')
    const count = document.querySelector('.sel-count')
    const sr = document.querySelector('#sr')
    const srBtns = [...sr.querySelectorAll('.swipe-btn')]
    const sl = document.querySelector('#sl')
    const slBtn = sl.querySelector('.swipe-btn')
    const gh = document.querySelector('.list-group-head')
    const act = document.querySelector('.group-act')
    const bgOf = (el) => getComputedStyle(el).backgroundColor
    return {
      barOverflow: Math.round(bar.scrollWidth - r(bar).width),
      narrowestBtn: Math.round(Math.min(...btns.map((b) => r(b).width))),
      clippedLabel: btns.some((b) => b.scrollWidth > b.clientWidth + 1),
      allInside: r(all).right <= window.innerWidth + 0.5 && r(all).width >= 44,
      countClipped: count.scrollWidth > count.clientWidth + 1,
      headOverflow: Math.round(head.scrollWidth - r(head).width),
      // Banda din dreapta: toate butoanele în zona dezvăluită, niciunul sub rând.
      stripFits: srBtns.every((b) => r(b).left >= r(sr).right - revR - 0.5 && r(b).right <= r(sr).right + 0.5),
      leftFits: r(slBtn).right <= r(sl).left + revL + 0.5,
      round: srBtns.every((b) => getComputedStyle(b).borderRadius === '50%' && Math.round(r(b).width) === Math.round(r(b).height)),
      btnSize: Math.round(Math.min(...srBtns.map((b) => r(b).width))),
      invisible: [...srBtns, slBtn].filter((b) => bgOf(b) === 'rgba(0, 0, 0, 0)').length,
      noBorder: [...srBtns, slBtn].every((b) => getComputedStyle(b).borderStyle === 'none' || getComputedStyle(b).borderWidth === '0px'),
      // Ordinea benzii: Dată, Oră, Șterge, ⋮ (Urgent e în ⋮).
      order: srBtns.map((b) => b.getAttribute('aria-label') ?? b.querySelector('input')?.getAttribute('aria-label')).join(','),
      // Dată și Oră: aceeași greutate (fundal identic, fără accent umplut).
      equalPick: bgOf(srBtns[0]) === bgOf(srBtns[1]),
      // Inputul nativ acoperă tot butonul: degetul cade pe el oriunde.
      pickCovers: [...document.querySelectorAll('.native-pick')].every((w) => {
        const i = w.querySelector('input'); return Math.abs(r(i).width - r(w).width) < 1 && Math.abs(r(i).height - r(w).height) < 1
      }),
      // Banda deschisă trebuie să lase rândul lizibil (pragul complet stă
      // peste bandă prin `fullThreshold` din `swipe.ts`, testat acolo).
      rowLeft: Math.round(r(sr).width - revR),
      dsOverflow: Math.round(document.querySelector('.ds-grid').scrollWidth - r(document.querySelector('.ds-grid')).width),
      dsClipped: [...document.querySelectorAll('.ds-label')].some((b) => b.scrollWidth > b.clientWidth + 1),
      groupOverflow: Math.round(gh.scrollWidth - r(gh).width),
      actClipped: act.scrollWidth > act.clientWidth + 1,
    }
  }, [REVEAL_RIGHT, REVEAL_LEFT])
  await page.close()
  check(`bara de selecție fără overflow @${width}px`, m.barOverflow <= 0, `${m.barOverflow}px peste bară`)
  check(`butoanele barei nestrivite @${width}px`, m.narrowestBtn >= 48, `cel mai îngust ${m.narrowestBtn}px`)
  check(`etichetele barei netăiate @${width}px`, !m.clippedLabel, m.clippedLabel ? 'o etichetă e tăiată' : 'întregi')
  check(`antetul selecției încape @${width}px`, m.headOverflow <= 0 && m.allInside && !m.countClipped, `overflow=${m.headOverflow}px, Toate în ecran=${m.allInside}, număr tăiat=${m.countClipped}`)
  check(`banda din dreapta încape în ${REVEAL_RIGHT}px @${width}px`, m.stripFits, m.stripFits ? 'toate patru în zona dezvăluită' : 'un buton rămâne sub rând')
  check(`banda din dreapta: Dată, Oră, Șterge, ⋮ @${width}px`, m.order === 'Dată,Oră,Șterge,Mai multe', m.order)
  check(`Dată și Oră egale, neutre @${width}px`, m.equalPick, m.equalPick ? 'același fundal' : 'fundaluri diferite')
  check(`inputul nativ acoperă tot butonul @${width}px`, m.pickCovers, m.pickCovers ? 'da' : 'nu')
  // Cu Șterge pe bandă (cererea omului, 2026-10-12) rândul cedează mai mult:
  // la 320px rămân ~70px — bifa și începutul titlului, destul cât să știi pe ce rând ești.
  check(`banda deschisă lasă rândul lizibil @${width}px`, m.rowLeft >= 64, `rămân ${m.rowLeft}px din rând`)
  check(`foaia de dată (7 opțiuni) încape @${width}px`, m.dsOverflow <= 0 && !m.dsClipped, `overflow=${m.dsOverflow}px, tăiat=${m.dsClipped}`)
  check(`banda din stânga încape în ${REVEAL_LEFT}px @${width}px`, m.leftFits, m.leftFits ? 'Mâine în zona dezvăluită' : 'sub rând')
  check(`butoanele benzii rotunde @${width}px`, m.round && m.btnSize >= 40, `${m.btnSize}px, rotunde=${m.round}`)
  check(`butoanele benzii au fundal, fără chenar @${width}px`, m.invisible === 0 && m.noBorder, `fără fundal: ${m.invisible}, fără chenar: ${m.noBorder}`)
  check(`„Mută restanțele pe azi" încape @${width}px`, m.groupOverflow <= 0 && !m.actClipped, `overflow=${m.groupOverflow}px, tăiat=${m.actClipped}`)
}

/**
 * Sertarul (`Drawer.tsx`): ~85% din lățime, iar rândul de pătrate fixate
 * DERULEAZĂ orizontal — opt pătrate nu au voie să lățească foaia, nici să
 * împingă rotița din antet afară. Numerele rândurilor stau în rând chiar cu
 * un nume de proiect lung (eticheta se taie, numărul nu).
 */
const drawer = () => `
<div class="drawer-bg"></div>
<nav class="drawer">
  <div class="dr-head">
    <span class="dr-avatar">IS</span>
    <span class="dr-who"><span class="dr-name">Ionuț Salonariu Popescu-Vlădescu</span><span class="dr-email">ionut.foarte.lung@exemplu-domeniu.ro</span><span class="me-build">Versiune · acum 20 de ore</span></span>
    <button class="dr-gear"><svg width="19" height="19"></svg></button>
  </div>
  <div class="dr-scroll">
    <div class="dr-pins">
      ${Array.from({ length: 8 }, (_, i) => `<button class="dr-pin${i === 0 ? ' on' : ''}"><span class="dr-pin-ico"><span class="pin-prefix">H${i}</span></span><span class="dr-pin-name">Proiectul numărul ${i}</span></button>`).join('')}
    </div>
    <div class="dr-group">
      <button class="dr-row on"><span class="dr-row-ico"><svg width="19" height="19"></svg></span><span class="dr-row-label">Azi</span><span class="sl-late">12</span><span class="dr-count">128</span></button>
      <button class="dr-row"><span class="dr-row-ico"><svg width="19" height="19"></svg></span><span class="dr-row-label">Ale mele</span><span class="sl-new">3</span></button>
    </div>
    <div class="dr-projects">
      <div class="dr-label">Proiecte</div>
      <button class="dr-row" id="long"><span class="dr-row-ico"><span class="dr-dot" style="background:#0EA5E9"></span></span><span class="dr-row-label">Un proiect cu un nume foarte, foarte lung care nu încape</span><span class="dr-count">1024</span></button>
      <button class="dr-add"><svg width="16" height="16"></svg> Proiect</button>
    </div>
  </div>
</nav>`

console.log('\nSertarul (☰) și rândul de pătrate fixate:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  // Fără animația de intrare: măsurat la jumătatea alunecării, sertarul
  // ar sta încă parțial în afara ecranului.
  await page.setContent(`<style>${CSS}</style><style>.drawer,.drawer-bg{animation:none}</style>${drawer()}`)
  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect()
    const dr = document.querySelector('.drawer')
    const pins = document.querySelector('.dr-pins')
    const gear = document.querySelector('.dr-gear')
    const long = document.querySelector('#long')
    const count = long.querySelector('.dr-count')
    const names = [...document.querySelectorAll('.dr-pin-name')]
    // Rânduri distincte după `top`: un text tăiat cu „…" dă două dreptunghiuri
    // pe ACELAȘI rând (textul și elipsa), nu două rânduri.
    const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size }
    return {
      share: r(dr).width / window.innerWidth,
      drOverflow: dr.scrollWidth - Math.ceil(r(dr).width),
      pinsScroll: pins.scrollWidth > pins.clientWidth && getComputedStyle(pins).overflowX === 'auto',
      pinsInside: r(pins).right <= r(dr).right + 0.5,
      tile: Math.round(r(document.querySelector('.dr-pin-ico')).width),
      gearInside: r(gear).right <= r(dr).right + 0.5 && r(gear).width >= 40,
      countInside: r(count).right <= r(long).right + 0.5 && count.scrollWidth <= count.clientWidth + 1,
      rowH: Math.round(r(long).height),
      nameOneLine: names.every((n) => lines(n) <= 1),
      // Vârsta buildului (`BuildAge`): un rând, în coloana numelui, înaintea rotiței.
      build: (() => {
        const b = document.querySelector('.me-build')
        return { lines: lines(b), h: Math.round(r(b).height), beforeGear: r(b).right <= r(gear).left + 0.5, w: Math.round(r(b).width), cut: b.scrollWidth - b.clientWidth }
      })(),
      bg: getComputedStyle(dr).backgroundColor,
      border: getComputedStyle(dr).borderRightStyle,
    }
  })
  await page.close()
  check(`sertarul ia ~85% @${width}px`, m.share > 0.8 && m.share <= 0.86, `${Math.round(m.share * 100)}%`)
  check(`sertarul nu se lățește @${width}px`, m.drOverflow <= 0, `${m.drOverflow}px peste`)
  check(`pătratele derulează în sertar @${width}px`, m.pinsScroll && m.pinsInside, `derulează=${m.pinsScroll}`)
  check(`pătrat atingibil @${width}px`, m.tile >= 44, `${m.tile}px`)
  check(`rotița în sertar @${width}px`, m.gearInside, m.gearInside ? 'în ecran' : 'împinsă afară')
  check(`numărul rămâne întreg lângă un nume lung @${width}px`, m.countInside, m.countInside ? 'întreg' : 'tăiat')
  check(`rând atingibil @${width}px`, m.rowH >= 44, `${m.rowH}px`)
  check(`numele pătratelor pe un rând @${width}px`, m.nameOneLine, m.nameOneLine ? 'da' : 'rupt')
  // Întreagă (fără „…”, vârsta e la coadă); un rând, două cu textul mărit
  // sau la 320px, unde cea mai lungă formă („acum 20 de ore”) nu încape.
  check(`vârsta buildului întreagă, înaintea rotiței @${width}px`, m.build.lines <= (process.env.TEXT_SCALE || width < 360 ? 2 : 1) &&m.build.cut <= 0 && m.build.beforeGear,`${m.build.w}px, rânduri=${m.build.lines}, înaintea rotiței=${m.build.beforeGear}, tăiat=${m.build.cut}px`)
  check(`sertarul are fundal, fără chenar @${width}px`, m.bg !== 'rgba(0, 0, 0, 0)' && m.border === 'none', `bg=${m.bg} chenar=${m.border}`)
}

/**
 * Editorul de filtru (`FilterForm.tsx`): jetoanele SE RUP pe rânduri, nu
 * derulează — un proiect ascuns după margine nu se mai poate alege. Și capul
 * unui grup pe proiect din ecranul filtrului: numele lung se taie, numărul nu.
 */
const filterForm = () => `
<div class="sheet on tall"><div class="sheet-scroll filter-form">
  <div class="sheet-section-t">Proiecte <span class="ff-any">oricare</span></div>
  <div class="chips" id="pchips">
    ${['Aplicație Turism', 'Casă', 'Inbox', 'Un proiect cu nume lung', 'Serviciu', 'Mașina', 'Cumpărături'].map((n, i) => `<button class="chip${i === 1 ? ' on' : ''}"><span class="cdot" style="background:#0EA5E9"></span>${n}</button>`).join('')}
  </div>
  <p class="ff-preview"><span class="ff-n">128</span> tichete deschise</p>
</div></div>
<div class="panel smart-list"><div class="list-group filter-group">
  <div class="list-group-head" id="gh"><span class="filter-group-dot" style="background:#0EA5E9"></span><span class="list-group-label">Un proiect cu un nume foarte, foarte lung care nu încape deloc</span><span class="list-group-num">1024</span></div>
</div></div>`

console.log('\nFiltrele salvate — editorul și capul de grup:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${filterForm()}`)
  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect()
    const chips = document.querySelector('#pchips')
    const all = [...chips.querySelectorAll('.chip')]
    const gh = document.querySelector('#gh')
    const num = gh.querySelector('.list-group-num')
    return {
      wraps: new Set(all.map((c) => Math.round(r(c).top))).size > 1,
      inside: all.every((c) => r(c).right <= r(chips).right + 0.5),
      tall: Math.round(Math.min(...all.map((c) => r(c).height))),
      onVisible: getComputedStyle(chips.querySelector('.chip.on')).boxShadow !== 'none',
      numInside: r(num).right <= r(gh).right + 0.5 && num.scrollWidth <= num.clientWidth + 1,
      ghOverflow: Math.round(gh.scrollWidth - r(gh).width),
    }
  })
  await page.close()
  check(`jetoanele se rup pe rânduri @${width}px`, m.wraps && m.inside, `rupte=${m.wraps}, în cutie=${m.inside}`)
  check(`jeton atingibil @${width}px`, m.tall >= 32, `${m.tall}px`)
  check(`jetonul ales se vede (linia de 2px) @${width}px`, m.onVisible, m.onVisible ? 'da' : 'nu')
  check(`capul grupului ține numărul @${width}px`, m.numInside && m.ghOverflow <= 0, `overflow=${m.ghOverflow}px`)
}

/**
 * Google Calendar (`EventRow.tsx`, `CalendarSettings.tsx`): rândul de eveniment
 * stă între sarcini cu un interval (`10:00–11:00`) mai lat decât ora unei
 * sarcini și cu „ziua 2/5" la coadă — intervalul nu are voie să se taie, iar
 * titlul trebuie să mai primească loc. Bara de 3px trebuie să SE VADĂ (are
 * culoare), banda de toată ziua se rupe pe rânduri, iar în Integrări un email
 * lung nu împinge „Deconectează" afară din ecran.
 */
const calendar = () => `
<div class="panel smart-list"><div class="list-group">
  <div class="list-group-head"><span class="list-group-num">2</span><span class="list-group-label">Azi</span><span class="list-group-date">luni, 12 octombrie</span></div>
  <div class="ev-band" id="band">
    <button class="ev-band-item" style="--ev:#0b8043"><span class="ev-band-title">Concediu la munte cu toată familia, departe de laptop</span><span class="ev-day">ziua 2/5</span></button>
    <button class="ev-band-item" style="--ev:#8e24aa"><span class="ev-band-title">Ziua lui Mihai</span></button>
  </div>
  <button class="list-row task-row"><span class="list-check"></span><span class="t-time">09:30</span><span class="list-title">Sună la bancă</span></button>
  <button class="list-row event-row" id="ev" style="--ev:#4285f4"><span class="ev-bar"></span><span class="t-time ev-time">10:00–11:30</span><span class="list-title">Ședință de planificare a trimestrului cu toată echipa extinsă</span><span class="ev-day">ziua 2/5</span></button>
</div></div>
<div class="sheet"><div class="sheet-scroll app-settings"><div class="integrations">
  <div class="int-account" id="acc">
    <div class="int-account-head"><span class="int-email">ionut.foarte.lung.cu.prenume@exemplu-domeniu-de-serviciu.ro</span><button class="btn-ghost">Deconectează</button></div>
    <label class="int-cal"><span class="int-cal-dot" style="background:#4285f4"></span><span class="int-cal-name">Calendarul principal cu un nume foarte lung de tot</span><input type="checkbox" class="int-switch" checked></label>
  </div>
</div></div></div>`

console.log('\nGoogle Calendar — rândul de eveniment, banda, Integrări:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${calendar()}`)
  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect()
    const ev = document.querySelector('#ev')
    const time = ev.querySelector('.ev-time')
    const title = ev.querySelector('.list-title')
    const bar = getComputedStyle(ev.querySelector('.ev-bar'), '::before')
    const band = document.querySelector('#band')
    const items = [...band.querySelectorAll('.ev-band-item')]
    const acc = document.querySelector('#acc')
    const btn = acc.querySelector('.btn-ghost')
    const sw = acc.querySelector('.int-switch')
    return {
      rowOverflow: Math.round(ev.scrollWidth - r(ev).width),
      timeClipped: time.scrollWidth > time.clientWidth + 1,
      titleW: Math.round(r(title).width),
      barW: parseFloat(bar.width),
      barBg: bar.backgroundColor,
      bandInside: items.every((i) => r(i).right <= r(band).right + 0.5),
      bandOverflow: Math.round(band.scrollWidth - r(band).width),
      btnInside: r(btn).right <= window.innerWidth + 0.5 && btn.scrollWidth <= btn.clientWidth + 1,
      swInside: r(sw).right <= window.innerWidth + 0.5,
      accOverflow: Math.round(acc.scrollWidth - r(acc).width),
    }
  })
  await page.close()
  check(`rândul de eveniment fără overflow @${width}px`, m.rowOverflow <= 0, `${m.rowOverflow}px`)
  check(`intervalul orar netăiat @${width}px`, !m.timeClipped, m.timeClipped ? 'tăiat' : 'întreg')
  check(`titlul evenimentului mai are loc @${width}px`, m.titleW >= 80, `${m.titleW}px`)
  check(`bara calendarului se vede @${width}px`, m.barW === 3 && m.barBg !== 'rgba(0, 0, 0, 0)', `${m.barW}px, ${m.barBg}`)
  check(`banda de toată ziua în cutie @${width}px`, m.bandInside && m.bandOverflow <= 0, `overflow=${m.bandOverflow}px`)
  check(`„Deconectează" și comutatorul în ecran @${width}px`, m.btnInside && m.swInside && m.accOverflow <= 0, `buton=${m.btnInside}, comutator=${m.swInside}, overflow=${m.accOverflow}px`)
}

/**
 * Jetonul „12/15" (`TaskProgress.tsx`) stă în `.t-tail`, `flex-shrink: 0`: nu
 * are voie să se taie, iar titlul trebuie să mai primească loc.
 */
const progressRow = () => `
<div class="panel smart-list"><div class="list-group">
  <button class="list-row task-row" id="pr"><span class="list-check"></span><span class="t-time">09:30</span><span class="list-title">Pregătește lansarea versiunii noi pentru toți clienții</span><span class="t-tail"><span class="md-progress">12/15</span></span></button>
</div></div>`

console.log('\nProgresul căsuțelor — jetonul din rând:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${progressRow()}`)
  const m = await page.evaluate(() => {
    const row = document.querySelector('#pr')
    const chip = row.querySelector('.md-progress')
    return {
      titleW: Math.round(row.querySelector('.list-title').getBoundingClientRect().width),
      clipped: chip.scrollWidth > chip.clientWidth + 1,
      overflow: Math.round(row.scrollWidth - row.getBoundingClientRect().width),
    }
  })
  await page.close()
  check(`titlul mai are loc cu jetonul @${width}px`, m.titleW > 80, `${m.titleW}px`)
  check(`jetonul netăiat @${width}px`, !m.clipped && m.overflow <= 0, `tăiat=${m.clipped}, overflow=${m.overflow}px`)
}

/**
 * Rândul de fir din foaia de tichet (`SheetThreadRow`): sub 430px nu iese din
 * foaie, necititul ține corpul pe EXACT 2 rânduri (un comentariu lung nu
 * împinge descrierea în jos), cititul pe unul singur, iar numărul + › rămân
 * întregi lângă un autor lung.
 */
const LONG_BODY = 'Poți verifica pe staging cu clientul de test? Eu am văzut că TaxPointDate lipsește la facturile parțial încasate, iar exportul pică.'
const threadRow = (kind, who) => `
<button type="button" class="es-thread ${kind}" id="tr-${kind}">
  <span class="es-thread-av">IS</span>
  <span class="es-thread-tx">
    <span class="es-thread-who"><span class="es-thread-name">${who}</span><span class="es-thread-t">2 h</span>${kind === 'unread' ? '<span class="es-thread-new">nou</span>' : ''}</span>
    <span class="es-thread-body">${LONG_BODY}</span>
  </span>
  <span class="es-thread-n"><svg width="14" height="14"></svg>17<svg width="15" height="15"></svg></span>
</button>`
const threadSheet = () => `
<div class="kb-sheet edit-sheet" style="animation:none"><div class="qs-form">
  ${threadRow('unread', 'Ți l-a pasat Ionuț-Alexandru Constantinescu')}
  ${threadRow('read', 'Ionuț-Alexandru Constantinescu → Ana-Maria')}
</div></div>`
console.log('\nRândul de fir din foaia de tichet:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${threadSheet()}`)
  const m = await page.evaluate(() => {
    const sheet = document.querySelector('.kb-sheet')
    const one = (kind) => {
      const row = document.getElementById(`tr-${kind}`)
      const r = row.getBoundingClientRect()
      const body = row.querySelector('.es-thread-body')
      const lh = parseFloat(getComputedStyle(body).lineHeight)
      const n = row.querySelector('.es-thread-n')
      const nr = n.getBoundingClientRect()
      return {
        overflow: Math.round(row.scrollWidth - row.clientWidth),
        right: Math.round(r.right),
        lines: Math.round(body.getBoundingClientRect().height / lh),
        nInside: nr.right <= r.right + 0.5 && nr.width > 0,
        nClipped: n.scrollWidth > n.clientWidth + 1,
        h: Math.round(r.height),
      }
    }
    return { sheetOverflow: sheet.scrollWidth - sheet.clientWidth, vw: innerWidth, unread: one('unread'), read: one('read') }
  })
  await page.close()
  check(`foaia nu se lățește @${width}px`, m.sheetOverflow <= 0 && m.unread.right <= m.vw && m.read.right <= m.vw, `+${m.sheetOverflow}px`)
  check(`necitit: corpul pe 2 rânduri @${width}px`, m.unread.lines === 2 && m.unread.overflow <= 0, `${m.unread.lines} rânduri, overflow=${m.unread.overflow}px`)
  check(`citit: un singur rând @${width}px`, m.read.lines === 1 && m.read.overflow <= 0 && m.read.h < m.unread.h, `${m.read.lines} rând, ${m.read.h}px vs ${m.unread.h}px`)
  check(`numărul + › întregi @${width}px`, m.unread.nInside && !m.unread.nClipped && m.read.nInside && !m.read.nClipped, 'da')
}

/**
 * Sarcinile fixate (`pinnedAt`): grupul „Fixate" din „Azi" (capul cu piuneza),
 * un rând al grupului cu ziua în cuvinte („Mâine 10:00", `.t-day`; ora
 * cade sub 380px) + proiectul lung, un rând cu semnul de fixare (`.t-pin`), și butonul de pe rândul ID-ului din foaia de tichet
 * (`.es-pin`). Semnul și ziua stau în `.t-tail` (`flex-shrink: 0`), deci
 * titlul trebuie să mai primească loc, iar butonul n-are voie să crească
 * rândul ID-ului (marginile negative) sau să iasă din foaie.
 */
const PIN_TITLE = 'Credențiale ANAF: utilizator, parolă și codul de pe SMS pentru depunere'
const pinnedList = () => `
<div class="panel smart-list"><div class="list-group" style="--gc: var(--accent)">
  <div class="list-group-head"><span class="list-group-ico pin"><svg width="15" height="15"></svg></span><span class="list-group-label">Fixate</span><span class="list-group-num">2</span></div>
  <button class="list-row task-row" id="pin-a"><span class="list-check"><span class="ck"></span></span><span class="list-title">${PIN_TITLE}</span><span class="t-tail"><span class="t-time t-day">Mâine<span class="t-day-h"> 10:00</span></span><span class="t-proj"><span class="t-dot" style="background:#0ea5e9"></span><span class="t-proj-name">Aplicație Turism și încă ceva lung</span></span></span></button>
  <button class="list-row task-row" id="pin-b"><span class="list-check"><span class="ck"></span></span><span class="list-title">Rând fixat din Listă</span><span class="t-tail"><span class="t-pin" id="pin-mark"><svg width="13" height="13"></svg></span><span class="t-proj"><span class="t-dot" style="background:#0ea5e9"></span><span class="t-proj-name">Inbox</span></span></span></button>
</div></div>
<div class="kb-sheet edit-sheet" style="animation:none;position:static"><div class="qs-form">
  <div class="es-meta"><span>TUR-128</span><button type="button" class="es-pin on" id="es-pin"><svg width="15" height="15"></svg></button></div>
  <div class="es-head"><button class="es-check"><span class="ck"></span></button><textarea class="sh-title-input" rows="1">x</textarea></div>
</div></div>`
console.log('\nSarcinile fixate (grupul din Azi, semnul din rând, butonul din foaie):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${pinnedList()}`)
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect()
    const row = document.getElementById('pin-a')
    const day = row.querySelector('.t-day')
    const mark = document.getElementById('pin-mark')
    const meta = document.querySelector('.es-meta')
    const pin = document.getElementById('es-pin')
    const sheet = document.querySelector('.kb-sheet')
    const metaSpan = meta.querySelector('span')
    const cs = getComputedStyle(pin)
    return {
      rowOverflow: Math.round(row.scrollWidth - row.getBoundingClientRect().width),
      titleW: Math.round(row.querySelector('.list-title').getBoundingClientRect().width),
      dayClipped: day.scrollWidth > day.clientWidth + 1,
      markW: Math.round(mark.getBoundingClientRect().width),
      markColor: getComputedStyle(mark).color,
      headIco: Math.round(r('.list-group-ico.pin').width),
      pinW: Math.round(pin.getBoundingClientRect().width),
      pinH: Math.round(pin.getBoundingClientRect().height),
      pinBg: cs.backgroundColor,
      pinInside: pin.getBoundingClientRect().right <= sheet.getBoundingClientRect().right + 0.5,
      sameRow: r('#es-pin').top < metaSpan.getBoundingClientRect().bottom && r('#es-pin').bottom > metaSpan.getBoundingClientRect().top,
      metaH: Math.round(meta.getBoundingClientRect().height),
      textH: Math.round(metaSpan.getBoundingClientRect().height),
      docOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  await page.close()
  check(`rândul fixat nu iese din listă @${width}px`, m.rowOverflow <= 0 && m.docOverflow <= 0, `${m.rowOverflow}px, pagina +${m.docOverflow}px`)
  check(`titlul rândului fixat mai are loc @${width}px`, m.titleW > 80, `${m.titleW}px`)
  check(`semnul de fixare se vede, în accent @${width}px`, m.markW >= 13 && m.markColor !== 'rgba(0, 0, 0, 0)' && m.headIco >= 15, `${m.markW}px, ${m.markColor}, cap ${m.headIco}px`)
  check(`ziua din coadă („Mâine 10:00") netăiată @${width}px`, !m.dayClipped, `tăiat=${m.dayClipped}`)
  check(`butonul de fixare din foaie: 28px, cu fundal, pe rândul ID-ului @${width}px`,
    m.pinW === 28 && m.pinH === 28 && m.pinBg !== 'rgba(0, 0, 0, 0)' && m.pinInside && m.sameRow,
    `${m.pinW}×${m.pinH}px, ${m.pinBg}, în foaie=${m.pinInside}, același rând=${m.sameRow}`)
  check(`rândul ID-ului nu crește din cauza butonului @${width}px`, m.metaH <= m.textH + 1, `${m.metaH}px vs text ${m.textH}px`)
}

/**
 * Piuneza de rând pe desktop (`RowPin`, `.row-pin`): pe un rând nefixat e
 * transparentă și își ține locul, deci la hover titlul nu se mișcă și nu se
 * taie; pe un rând fixat stă mereu, în accent. Fără mouse (telefonul, 390px
 * cu atingere) piuneza unui rând nefixat lipsește cu totul. Două forme: coada
 * din listele inteligente (`.t-tail`) și cea din „Listă" (`.row-tail`).
 */
const rowPinList = () => `
<div class="panel smart-list"><div class="list-group">
  <button class="list-row task-row" id="rp-a"><span class="list-check"><span class="ck"></span></span><span class="list-title">Sună la contabilă</span><span class="t-tail"><span role="button" class="t-pin row-pin" id="rp-a-pin"><svg width="13" height="13"></svg></span><span class="t-time">10:00</span><span class="t-proj"><span class="t-dot" style="background:#0ea5e9"></span><span class="t-proj-name">Inbox</span></span></span></button>
  <button class="list-row task-row" id="rp-b"><span class="list-check"><span class="ck"></span></span><span class="list-title">Credențiale ANAF</span><span class="t-tail"><span role="button" class="t-pin row-pin on" id="rp-b-pin"><svg width="13" height="13"></svg></span><span class="t-proj"><span class="t-dot" style="background:#0ea5e9"></span><span class="t-proj-name">Inbox</span></span></span></button>
</div></div>
<div class="panel"><div class="list-group">
  <button class="list-row" id="rp-c"><span class="list-check"><span class="ck"></span></span><span class="list-title">Exportă raportul lunar</span><span class="row-tail"><span role="button" class="t-pin row-pin" id="rp-c-pin"><svg width="13" height="13"></svg></span><span class="list-id">TUR-12</span></span></button>
</div></div>`
console.log('\nPiuneza de rând pe desktop (hover, fără salt):')
for (const width of [1100, 1400]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.setContent(`<style>${CSS}</style>${rowPinList()}`)
  const measure = () => page.evaluate(() => {
    const one = (id) => {
      const row = document.getElementById(id)
      const t = row.querySelector('.list-title')
      const pin = document.getElementById(`${id}-pin`)
      const r = t.getBoundingClientRect()
      return {
        tl: Math.round(r.left), tw: Math.round(r.width), cut: t.scrollWidth > t.clientWidth + 1,
        h: Math.round(row.getBoundingClientRect().height),
        pw: Math.round(pin.getBoundingClientRect().width), op: getComputedStyle(pin).opacity,
        color: getComputedStyle(pin).color,
      }
    }
    return { a: one('rp-a'), b: one('rp-b'), c: one('rp-c') }
  })
  const rest = await measure()
  await page.hover('#rp-a .list-title')
  await page.waitForTimeout(250) // tranziția de opacitate (0.12s)
  const hovA = (await measure()).a
  await page.hover('#rp-c .list-title')
  await page.waitForTimeout(250)
  const hovC = (await measure()).c
  await page.close()
  for (const [k, before, after] of [['inteligentă', rest.a, hovA], ['„Listă"', rest.c, hovC]]) {
    check(`hover nu mișcă titlul (${k}) @${width}px`, before.tl === after.tl && before.tw === after.tw && before.h === after.h,
      `${before.tl}/${before.tw}/${before.h} → ${after.tl}/${after.tw}/${after.h}`)
    check(`titlul scurt netăiat la hover (${k}) @${width}px`, !after.cut, `tăiat=${after.cut}`)
    check(`piuneza: ascunsă în repaus, vizibilă la hover (${k}) @${width}px`, before.op === '0' && after.op === '1' && after.pw >= 16,
      `${before.op} → ${after.op}, ${after.pw}px`)
  }
  check(`rândul fixat: piuneza mereu vizibilă, în accent @${width}px`, rest.b.op === '1' && rest.b.color !== rest.a.color, `${rest.b.op}, ${rest.b.color}`)
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.setContent(`<style>${CSS}</style>${rowPinList()}`)
  const m = await page.evaluate(() => ({
    off: getComputedStyle(document.getElementById('rp-a-pin')).display,
    on: getComputedStyle(document.getElementById('rp-b-pin')).display,
  }))
  await ctx.close()
  check('fără mouse (390px): piuneza nefixatului lipsește, a fixatului e semn', m.off === 'none' && m.on !== 'none', `${m.off} / ${m.on}`)
}

// Galeria (Lightbox) — componenta REALĂ, împachetată cu esbuild, montată în
// interiorul unei `.sheet` (care are `transform`, ca în aplicație). Regresia
// din 2026-10-15: pe telefon se vedea un sfert din poză, fiindcă `position:
// fixed` sub un strămoș cu `transform` se așază față de foaie, iar `max-height:
// 100%` pe un element de grid nu se rezolva. Aici: poza încape întreagă în
// ecran, în portret și în peisaj, pentru o poză lată și una înaltă; plus
// dublu-tap, ciupit și închiderea.
console.log('\nGaleria (Lightbox) — poza încape întreagă, mărirea:')
const { outputFiles: [lbBundle] } = await esbuild.build({
  stdin: {
    contents: `
      import { createElement as h, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { Lightbox } from './components/Lightbox'
      function Harness({ items }) {
        const [index, setIndex] = useState(0)
        const [open, setOpen] = useState(true)
        window.__lb = { open, index }
        return h('div', { className: 'sheet on tall' }, h('div', { className: 'sheet-scroll' },
          h('div', { style: { height: 200 } }, 'formular'),
          open && h(Lightbox, { items, index, urlFor: (a) => a.path, canDelete: true,
            onIndex: setIndex, onClose: () => setOpen(false), onDelete: () => {} })))
      }
      window.__mount = (items) => createRoot(document.getElementById('app')).render(h(Harness, { items }))
    `,
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  // `signedDownloadUrl` trage clientul Supabase; galeria nu-l cheamă fără click pe „Descarcă".
  plugins: [{ name: 'stub-attachments', setup(b) {
    b.onResolve({ filter: /data\/attachments$/ }, () => ({ path: 'attachments', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const signedDownloadUrl = async () => null', loader: 'js' }))
  } }],
})
const lbSvg = (w, h) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#3b6ea5"/><rect x="${w * 0.02}" y="${h * 0.02}" width="${w * 0.96}" height="${h * 0.96}" fill="none" stroke="#f5c542" stroke-width="${Math.min(w, h) * 0.02}"/>` +
  `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#e8eef5"/></svg>`).toString('base64')
// Numele lungi, fără spații, sunt cele reale de pe Android („Screenshot_…"):
// unul scurt n-ar fi prins coloana care se lățea după bară (D-175).
const LB_IMAGES = [
  ['lata-4000x3000-Screenshot_2026-10-16-20-37-27-202_ro.horizontal.app.jpg', 4000, 3000],
  ['inalta-1080x2400.png', 1080, 2400],
]
const LB_SHOTS = process.env.LB_SHOTS
for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const [name, w, h] of LB_IMAGES) {
    const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true })
    // Același viewport ca `index.html` (`isMobile` fără el ar așeza pagina pe 980px).
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><style>${CSS}</style><div id="app"></div><script>${lbBundle.text}</script>`)
    if (process.env.LB_DEBUG) {
      page.on('console', (msg) => console.log('   [page]', msg.text()))
      await page.evaluate(() => { for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick']) document.addEventListener(t, (e) => console.log(t, e.pointerType, e.pointerId, e.target.tagName, e.timeStamp | 0), true) })
    }
    await page.evaluate(([items]) => window.__mount(items), [[
      { id: 'a', path: lbSvg(w, h), filename: name },
      { id: 'b', path: lbSvg(1200, 800), filename: 'a-doua.jpg' },
    ]])
    await page.waitForFunction(() => document.querySelector('.lb-body img')?.complete)
    const tag = `${name} @${vp.width}×${vp.height}`
    const m = await page.evaluate(() => {
      const back = document.querySelector('.lb-back')
      const body = document.querySelector('.lb-body').getBoundingClientRect()
      const r = document.querySelector('.lb-body img').getBoundingClientRect()
      return { bar: document.querySelector('.lb-bar').getBoundingClientRect().toJSON(), inBody: back.parentElement === document.body, vw: innerWidth, vh: innerHeight, body, img: { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } }
    })
    check(`galeria e în <body>, nu prinsă în foaie — ${tag}`, m.inBody, 'părintele nu e body')
    check(`bara și cutia nu ies din ecran — ${tag}`, m.bar.right <= m.vw + 0.5 && m.body.right <= m.vw + 0.5, `bara ${Math.round(m.bar.right)}, cutia ${Math.round(m.body.right)} pe ${m.vw}`)
    const fits = m.img.x >= -0.5 && m.img.y >= -0.5 && m.img.right <= m.vw + 0.5 && m.img.bottom <= m.vh + 0.5
      && m.img.y >= m.body.top - 0.5 && m.img.bottom <= m.body.bottom + 0.5
    check(`poza încape întreagă — ${tag}`, fits, `img ${Math.round(m.img.x)},${Math.round(m.img.y)} ${Math.round(m.img.w)}×${Math.round(m.img.h)} în ${m.vw}×${m.vh}`)
    // Și o umple pe o latură (nu încape fiindcă a ieșit mică).
    const fill = Math.max(m.img.w / (m.body.width - 16), m.img.h / (m.body.height - 16))
    check(`poza umple cutia pe o latură — ${tag}`, fill > 0.98, `${fill.toFixed(2)}`)
    check(`proporțiile păstrate — ${tag}`, Math.abs(m.img.w / m.img.h - w / h) < 0.02, `${(m.img.w / m.img.h).toFixed(3)} vs ${(w / h).toFixed(3)}`)

    // `LB_SHOTS=<dosar>`: capturile pentru ochi, în ambele teme.
    if (LB_SHOTS) {
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
        await page.screenshot({ path: `${LB_SHOTS}/${vp.width}x${vp.height}-${name.split('-')[0]}-${theme}.png` })
      }
    }

    // Dublu-tap în centru → 2×; încă unul → înapoi întreagă. O atingere pe poză nu închide.
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })),
    })
    const cx = m.img.x + m.img.w / 2, cy = m.img.y + m.img.h / 2
    const imgW = () => page.evaluate(() => document.querySelector('.lb-body img').getBoundingClientRect().width)
    const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await page.waitForTimeout(30); await touch('touchEnd', []) }
    await tapAt(cx, cy); await page.waitForTimeout(80); await tapAt(cx, cy)
    await page.waitForTimeout(350)
    const w2 = await imgW()
    check(`dublu-tap mărește 2× — ${tag}`, Math.abs(w2 / m.img.w - 2) < 0.05, `${(w2 / m.img.w).toFixed(2)}×`)
    check(`atingerea pe poză nu închide — ${tag}`, await page.evaluate(() => window.__lb.open), 'închisă')
    if (LB_SHOTS) await page.screenshot({ path: `${LB_SHOTS}/${vp.width}x${vp.height}-${name.split('-')[0]}-zoom2x.png` })
    // Mărită, o tragere orizontală mută poza, nu trece la următoarea.
    await touch('touchStart', [[cx, cy]])
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - i * 10, cy]]); await page.waitForTimeout(16) }
    await touch('touchEnd', [])
    await page.waitForTimeout(50)
    check(`mărită, tragerea nu răsfoiește — ${tag}`, await page.evaluate(() => window.__lb.index === 0), 'a trecut la următoarea')
    await page.waitForTimeout(350)
    await tapAt(cx, cy); await page.waitForTimeout(80); await tapAt(cx, cy)
    await page.waitForTimeout(350)
    const w1 = await imgW()
    check(`al doilea dublu-tap revine la întreg — ${tag}`, Math.abs(w1 / m.img.w - 1) < 0.02, `${(w1 / m.img.w).toFixed(2)}×`)
    // Ciupit: degetele de la 60px la 180px distanță → ~3×.
    await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]])
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx - 30 - i * 6, cy], [cx + 30 + i * 6, cy]]); await page.waitForTimeout(16) }
    await touch('touchEnd', [])
    await page.waitForTimeout(50)
    const w3 = await imgW()
    check(`ciupitul mărește ~3× — ${tag}`, Math.abs(w3 / m.img.w - 3) < 0.15, `${(w3 / m.img.w).toFixed(2)}×`)
    check(`ciupitul nu închide și nu răsfoiește — ${tag}`, await page.evaluate(() => window.__lb.open && window.__lb.index === 0), 'stare schimbată')
    await page.keyboard.press('Escape')
    check(`Esc închide — ${tag}`, await page.evaluate(() => !window.__lb.open && !document.querySelector('.lb-back')), 'încă deschisă')
    await page.close()
  }
}

// Căsuțele din descriere — componentele REALE (MarkdownEditor cu CodeMirror,
// MarkdownView), împachetate cu esbuild. Regresia din 2026-10-16: căsuța
// BIFATĂ stătea mai jos decât cele goale (era aliniată pe linia de bază, iar
// SVG-ul bifei muta linia de bază). Aici: centrul fiecărei căsuțe (și al
// fiecărei buline) e la ±1px de centrul primului rând de text, bifată sau nu,
// în editor (cu și fără focus) și în cititor; rândul rupt e agățat sub text,
// nu sub căsuță; pe telefon rândurile cu căsuță sunt la ≥40px una de alta.
console.log('\nCăsuțele din descriere — aliniate pe primul rând, în editor și în cititor:')
const { outputFiles: [mdBundle] } = await esbuild.build({
  stdin: {
    contents: `
      import { createElement as h } from 'react'
      import { createRoot } from 'react-dom/client'
      import MarkdownEditor from './components/MarkdownEditor'
      import { MarkdownView } from './components/MarkdownView'
      window.__mount = (text, wrap) => {
        const noop = () => {}
        createRoot(document.getElementById('ed')).render(h(MarkdownEditor, { value: text, onChange: noop, onCommit: noop, ariaLabel: 'Descriere', prefixes: ['HZ'] }))
        createRoot(document.getElementById('rd')).render(h(MarkdownView, { text, prefixes: ['HZ'], onToggle: noop, className: 'issue-desc' }))
      }
    `,
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
})
const MD_TASKS = [
  '- [x] Intretinere - ebloc',
  '- [ ] Convertește revolut dolari cont Simona și eu',
  '- [x] Card de credit **ING**',
  '- [ ] taxa gunoi cisnadie - T a x e si i m p o z i t e 64 RON/luna https://mail.google.com/mail/u/1/#inbox/FMfcgzQgLrqbMKgGNPxtjwVBrMBLhQKq',
  '- [ ] Eon',
  '  - [x] factura din `octombrie`',
  '- [x] DIGI',
  '- notă fără căsuță, dar destul de lungă cât să se rupă pe încă un rând în coloana îngustă',
  '1. primul pas',
  '2. al doilea',
].join('\n')
const MD_SHOTS = process.env.MD_SHOTS
for (const [where, vp, wrapOpen, wrapClose] of [
  ['panou 1400', { width: 1400, height: 1000 }, '<div class="split-pane" style="position:static;width:560px;padding:16px"><div class="md-field desc-box desc-fixed" id="ed"></div><div style="height:24px"></div><div class="md issue-desc-wrap" id="rd"></div></div>', ''],
  ['foaie 390', { width: 390, height: 1200 }, '<div class="edit-sheet" style="position:static;transform:none;padding:0 18px"><div class="es-desc md-field desc-box" id="ed"></div><div style="height:24px"></div><div id="rd"></div></div>', ''],
]) for (const scale of [1, 1.5]) {
  const tag = `${where}, text ×${scale}`
  const page = await browser.newPage({ viewport: vp, ...(vp.width < 900 ? { hasTouch: true, isMobile: true } : {}) })
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${CSS}\n:root{--text-scale:${scale}}</style>${wrapOpen}${wrapClose}<script>${mdBundle.text}</script>`)
  await page.evaluate((t) => window.__mount(t), MD_TASKS)
  await page.waitForSelector('#ed .md-task')
  await page.evaluate(() => document.fonts.ready)
  const measure = () => page.evaluate(() => {
    // Primul caracter de text al rândului, în afara marcajului.
    const firstChar = (row, marker) => {
      const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (marker.contains(n) || n.parentElement.closest('.md-task,.md-bullet,.md-num')) continue
        const i = n.data.search(/\S/)
        if (i < 0) continue
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1)
        return r.getClientRects()[0]
      }
      return null
    }
    const scan = (root, rowSel) => [...root.querySelectorAll('.md-task, .md-bullet, ul > li.md-li:not(.md-li-task)')].map((m) => {
      const row = m.matches('li') ? m : m.closest(rowSel)
      const isPseudo = m.matches('li')
      let box
      if (isPseudo) {
        const cs = getComputedStyle(m, '::before'), lr = m.getBoundingClientRect()
        const top = lr.top + parseFloat(cs.top), h = parseFloat(cs.height)
        box = { cy: top + h / 2 }
      } else {
        const r = m.classList.contains('md-bullet')
          ? (() => { const lr = m.getBoundingClientRect(), cs = getComputedStyle(m, '::before'); return { top: lr.top + parseFloat(cs.top), height: parseFloat(cs.height) } })()
          : m.getBoundingClientRect()
        box = { cy: r.top + r.height / 2 }
      }
      // Rândul de text, nu sub-lista din el.
      const body = isPseudo ? m : row
      const c = firstChar(isPseudo ? [...body.childNodes].find((x) => x.nodeType === 1) ?? body : body, isPseudo ? document.createElement('i') : m)
      const left = m.matches('li') ? null : m.getBoundingClientRect().left
      return { kind: m.className.split(' ')[0] || 'li', on: m.classList.contains('on'), cy: box.cy, ty: c ? (c.top + c.bottom) / 2 : NaN, tx: c?.left, left, rowTop: row.getBoundingClientRect().top }
    })
    const ed = document.querySelector('#ed'), rd = document.querySelector('#rd')
    // Agățarea: rândul rupt (al 4-lea, cu URL) pornește sub text, nu sub căsuță.
    const hang = (root, sel) => {
      const m = root.querySelectorAll('.md-task')[3]
      const row = m.closest(sel)
      const text = row.matches('li') ? row.querySelector('.md-li-body') : row
      const r = document.createRange(); r.selectNodeContents(text)
      const tops = []
      for (const q of r.getClientRects()) if (q.width > 1 && q.left >= m.getBoundingClientRect().right - 0.5 && !tops.some((t) => Math.abs(t.top - q.top) < 2)) tops.push({ top: q.top, left: q.left })
      tops.sort((a, b) => a.top - b.top)
      return { lines: tops.length, first: tops[0]?.left, second: tops[1]?.left, box: m.getBoundingClientRect() }
    }
    return { ed: scan(ed, '.cm-line'), rd: scan(rd, 'li'), hangEd: hang(ed, '.cm-line'), hangRd: hang(rd, 'li') }
  })
  for (const focused of [false, true]) {
    if (focused) {
      // Cursorul pe rândul cu ING: sintaxa inline (`**`) se arată pe el.
      const cm = page.locator('#ed .cm-line').nth(2)
      const b = await cm.boundingBox()
      await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2)
      await page.waitForTimeout(150)
    }
    const m = await measure()
    const sides = focused ? [['editor cu focus', m.ed, m.hangEd]] : [['editor', m.ed, m.hangEd], ['cititor', m.rd, m.hangRd]]
    for (const [side, rows, hg] of sides) {
      const off = rows.filter((r) => !(Math.abs(r.cy - r.ty) <= 1))
      check(`${side} (${tag}): marcajul centrat pe primul rând, bifat sau nu`, rows.length >= 8 && off.length === 0,
        off.length ? off.map((r) => `${r.kind}${r.on ? '✓' : ''} Δ${(r.cy - r.ty).toFixed(1)}px`).join(' ') : `${rows.length} marcaje`)
      const tasks = rows.filter((r) => r.kind === 'md-task')
      const onOff = tasks.filter((r) => r.on).map((r) => r.cy - r.rowTop), offOn = tasks.filter((r) => !r.on).map((r) => r.cy - r.rowTop)
      check(`${side} (${tag}): bifată și goală la aceeași înălțime în rând`, Math.max(...onOff, ...offOn) - Math.min(...onOff, ...offOn) <= 1, `${onOff.map((x) => x.toFixed(1))} vs ${offOn.map((x) => x.toFixed(1))}`)
      check(`${side} (${tag}): rândul rupt e agățat sub text`, hg.lines >= 2 && Math.abs(hg.first - hg.second) <= 1 && hg.second > hg.box.right + 4,
        `${hg.lines} rânduri, ${hg.first?.toFixed(1)} / ${hg.second?.toFixed(1)}, căsuța până la ${hg.box.right.toFixed(1)}`)
      // Textul pornește în aceeași coloană la căsuță, bulină și număr (adâncimea 0).
      const xs = rows.filter((r) => Number.isFinite(r.tx)).map((r) => r.tx)
      const col = xs.length ? Math.min(...xs) : 0
      const top0 = rows.filter((r) => Math.abs(r.tx - col) <= 1).length
      check(`${side} (${tag}): textul în aceeași coloană pe căsuțe și buline`, top0 >= rows.length - 1, `${top0}/${rows.length} la x=${col.toFixed(1)}`)
      const pitch = tasks.slice(0, 3).map((r, i, a) => (i ? r.cy - a[i - 1].cy : null)).filter((x) => x !== null)
      if (vp.width < 900) check(`${side} (${tag}): pe telefon rândurile cu căsuță la ≥40px`, pitch.every((d) => d >= 40), pitch.map((d) => d.toFixed(1)).join(', '))
      else check(`${side} (${tag}): pe desktop rândul rămâne strâns`, pitch.every((d) => d <= 34), pitch.map((d) => d.toFixed(1)).join(', '))
    }
    if (MD_SHOTS) for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const slug = `${where.replace(' ', '-')}-x${scale}-${focused ? 'focus' : 'repaus'}-${theme}`
      await page.screenshot({ path: `${MD_SHOTS}/${slug}.png`, fullPage: true })
    }
  }
  await page.close()
}

/**
 * Mutarea în alt proiect (`MoveProject.tsx`): jetonul de proiect de lângă ID
 * în antetul formularului complet, foaia mică de proiecte de pe telefon și
 * jetonul de proiect din foaia de tichet, devenit buton. Un nume lung de
 * proiect se taie cu „…", nu împinge iconițele din antet pe alt rând și nu
 * lățește foaia.
 */
const LONG_PROJ = 'Aplicație Turism și încă ceva foarte lung de tot'
const moveHead = () => `
<div class="sheet on tall" style="position:static;transform:none;width:100%">
  <div class="sh-header">
    <span class="sh-id">TUR-128</span>
    <span class="sh-move"><button type="button" class="sh-move-btn"><span class="t-dot" style="background:#6e7bff"></span><span class="sh-move-t">${LONG_PROJ}</span><svg width="12" height="12"></svg></button></span>
    <button class="sh-close">x</button>
    <button class="sh-pin on"><svg width="15" height="15"></svg></button>
    <button class="sh-copy">c</button>
    <button class="sh-delete">d</button>
    <button class="sh-save">^</button>
    <span class="sh-break"></span>
    <button class="sh-check"><span class="ck"></span></button>
    <span class="sh-title-wrap"><textarea class="sh-title-input" rows="1">Adresă email proiect</textarea></span>
  </div>
</div>`
const moveSheet = () => `
<div class="kb-sheet action-sheet move-sheet" style="animation:none">
  <p class="as-title">Mută <span class="as-subject">${LONG}</span> în…</p>
  <div class="as-list mv-list">
    ${['Inbox', LONG_PROJ, 'Apologetica', 'Horizontal'].map((n) => `<button type="button" class="as-item mv-item"><span class="mv-mark"><span class="t-dot" style="background:#0ea5e9"></span></span><span class="mv-name">${n}</span></button>`).join('')}
  </div>
</div>`
console.log('\nMutarea în alt proiect (antetul formularului, foaia mică):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${moveHead()}`)
  const h = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect()
    const head = document.querySelector('.sh-header')
    const t = document.querySelector('.sh-move-t')
    return {
      overflow: head.scrollWidth - head.clientWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      chipW: Math.round(r('.sh-move-btn').width),
      chipH: Math.round(r('.sh-move-btn').height),
      sameRow: Math.abs(r('.sh-move-btn').top + r('.sh-move-btn').height / 2 - (r('.sh-close').top + r('.sh-close').height / 2)) <= 2,
      afterId: r('.sh-move-btn').left >= r('.sh-id').right,
      ellipsis: t.scrollWidth > t.clientWidth,
    }
  })
  await page.setContent(`<style>${CSS}</style>${moveSheet()}`)
  const s = await page.evaluate(() => {
    const sheet = document.querySelector('.move-sheet')
    const items = [...document.querySelectorAll('.mv-item')]
    const names = [...document.querySelectorAll('.mv-name')]
    return {
      overflow: sheet.scrollWidth - sheet.clientWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      lowest: Math.round(Math.min(...items.map((i) => i.getBoundingClientRect().height))),
      oneLine: names.every((n) => n.getBoundingClientRect().height <= 24),
    }
  })
  await page.close()
  check(`antetul cu proiectul nu iese din foaie @${width}px`, h.overflow <= 0 && h.docOverflow <= 0, `${h.overflow}px, pagina +${h.docOverflow}px`)
  check(`jetonul de proiect lângă ID, pe rândul iconițelor @${width}px`, h.afterId && h.sameRow, `după ID=${h.afterId}, același rând=${h.sameRow}`)
  check(`jetonul de proiect nestrivit, numele tăiat cu „…" @${width}px`, h.chipW >= 60 && h.chipH >= 28 && h.ellipsis, `${h.chipW}×${h.chipH}px, tăiat=${h.ellipsis}`)
  check(`foaia de mutare nu se lățește @${width}px`, s.overflow <= 0 && s.docOverflow <= 0, `${s.overflow}px, pagina +${s.docOverflow}px`)
  check(`proiectele atingibile, pe un rând @${width}px`, s.lowest >= 44 && s.oneLine, `cel mai scund ${s.lowest}px, un rând=${s.oneLine}`)
}

/**
 * Panoul de dată al foii de tichet (D-197) — componenta REALĂ (`DuePanel` în
 * `ChipPop` ca foaie de jos), pe un telefon cu locale `en-US`, ca al omului.
 * Înainte, foaia arăta două inputuri native goale: `10/16/2026` și
 * `--:-- --`. Ziua aleasă e 16 (> 12), deci ordinea zi/lună se vede.
 */
const { outputFiles: [dueBundle] } = await esbuild.build({
  stdin: {
    contents: `
      import { createElement as h, useRef } from 'react'
      import { createRoot } from 'react-dom/client'
      import { ChipPop } from './components/ChipPop'
      import { DuePanel } from './components/DuePanel'
      const noop = () => {}
      function Harness({ rrule }) {
        const row = useRef(null)
        const now = new Date(2026, 9, 16, 8, 0)
        return h('div', { className: 'edit-sheet kb-sheet' },
          h('div', { className: 'qs-bar', ref: row }, h('button', { className: 'qs-due on' }, 'Azi 17:30')),
          h(ChipPop, { anchor: null, rowRef: row, sheet: true, role: 'dialog', label: 'Scadența', className: 'fc-pop-date es-due-pop', onClose: noop },
            h(DuePanel, { now, dueDate: '2026-10-16', dueTime: '17:30',
              onPreset: noop, onPickDate: noop, onPickTime: noop, onClearTime: noop, onClear: noop,
              reminder: 'm30', onReminder: noop, rrule, onClearRrule: noop })))
      }
      window.__mount = (rrule) => createRoot(document.getElementById('app')).render(h(Harness, { rrule }))
    `,
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
})
const DUE_SHOTS = process.env.DUE_SHOTS
console.log('\nPanoul de dată din foaia de tichet (telefon en-US, componenta reală):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, locale: 'en-US' })
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${CSS}</style><div id="app"></div><script>${dueBundle.text}</script>`)
  await page.evaluate(() => window.__mount('FREQ=WEEKLY;BYDAY=MO,TH'))
  await page.waitForSelector('.fc-sheet .fc-recur')
  await page.evaluate(() => document.fonts.ready)
  const m = await page.evaluate(() => {
    const pop = document.querySelector('.fc-sheet')
    const r = (el) => el.getBoundingClientRect()
    const pres = [...pop.querySelectorAll('.fc-pre')]
    const picks = [...pop.querySelectorAll('.fc-pick, .fc-pick-x')]
    const cut = [...pop.querySelectorAll('.fc-pick-t, .fc-pick-sub')].filter((t) => t.scrollWidth > t.clientWidth + 1).length
    const fieldsOut = Math.round(Math.max(...[...pop.querySelectorAll('.fc-fields > *')].map((el) => r(el).right)) - r(pop).right)
    // Ce se VEDE: textul randat plus valorile câmpurilor vizibile. Inputurile
    // native (sub iconițe) trebuie să fie transparente — al lor e formatul
    // locale-ului, nu al nostru.
    const natives = [...pop.querySelectorAll('input[type=date], input[type=time]')]
    const shown = pop.innerText
    const typed = pop.querySelectorAll('input:not([type=date]):not([type=time])').length
    return {
      popW: Math.round(r(pop).width),
      popOverflow: pop.scrollWidth - pop.clientWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      preWrapped: pres.filter((p) => p.scrollWidth > p.clientWidth + 1 || r(p).right > r(pop).right).length,
      preCount: pres.length,
      preRow: new Set(pres.map((p) => Math.round(r(p).top))).size,
      pick: Math.round(Math.min(...picks.map((p) => Math.min(r(p).width, r(p).height)))),
      nativeVisible: natives.filter((i) => getComputedStyle(i).opacity !== '0').length,
      nativeCount: natives.length,
      cut, fieldsOut, typed,
      shown,
    }
  })
  const usFormat = /\b10\/16\/2026\b|--:--|\b(AM|PM)\b|mm\/dd/i.test(m.shown)
  const roFormat = /Azi/.test(m.shown) && m.shown.includes('vin 16 oct') && m.shown.includes('17:30')
  check(`foaia de dată pe toată lățimea @${width}px`, m.popW === width && m.popOverflow <= 0 && m.docOverflow <= 0, `${m.popW}px, +${m.popOverflow}px, pagina +${m.docOverflow}px`)
  // Cu textul mărit presetările trec, prin design, pe două coloane.
  const maxRows = Number(process.env.TEXT_SCALE ?? 1) > 1 ? 2 : 1
  check(`presetările încap întregi (${maxRows === 1 ? 'un rând' : 'max. două rânduri'}) @${width}px`, m.preCount === 4 && m.preWrapped === 0 && m.preRow <= maxRows,`${m.preCount} presetări, ${m.preWrapped} tăiate, ${m.preRow} rând(uri)`)
  check(`fără text în formatul nativ, fără câmp de scris @${width}px`, !usFormat && roFormat && m.nativeVisible === 0 && m.nativeCount === 2 && m.typed === 0, usFormat ? `găsit: ${m.shown.replace(/\s+/g, ' ').slice(0, 120)}` : `„Azi · vin 16 oct" + 24h, ${m.nativeCount} selectoare native transparente, ${m.typed} câmpuri scrise`)
  check(`butoanele zi/oră/✕ atingibile în foaie @${width}px`, m.pick >= 32, `cel mai mic ${m.pick}px`)
  check(`butoanele zi/oră încap, etichete întregi @${width}px`, m.fieldsOut <= 0 && m.cut === 0, `+${m.fieldsOut}px, ${m.cut} tăiate`)
  if (DUE_SHOTS && width === 390) for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.waitForTimeout(300) // culorile câmpurilor au `transition`
    await page.screenshot({ path: `${DUE_SHOTS}/date-panel-390-${theme}.png` })
  }
  await page.close()
}

/**
 * Panoul de dată al FOII RAPIDE — componenta reală (`QuickDue` = `DuePanel`
 * fără memento), inline deasupra rândului de controale, telefon `en-US`.
 * Înainte: fâșia cu două inputuri native (`10/16/2026`, `--:-- --`). Rândul
 * de sub panou rămâne cel obișnuit: „Mâine" și „Exemplu" se citesc întregi.
 */
const { outputFiles: [quickDueBundle] } = await esbuild.build({
  stdin: {
    contents: `
      import { createElement as h } from 'react'
      import { createRoot } from 'react-dom/client'
      import { QuickDue } from './components/QuickDue'
      const noop = () => {}
      window.__mount = (el) => createRoot(el).render(h(QuickDue, {
        dueAt: new Date(2026, 9, 16, 17, 30).toISOString(), allDay: false, fallbackDay: '2026-10-16',
        onDue: noop, onPicked: noop, onClear: noop,
      }))
    `,
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
})
console.log('\nPanoul de dată din foaia rapidă (telefon en-US, componenta reală):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, locale: 'en-US' })
  const html = quickBar({ day: 'Mâine', proj: 'Exemplu' }).replace('<div class="qs-bar">', '<div id="when"></div><div class="qs-bar">')
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${CSS}</style>${html}<script>${quickDueBundle.text}</script>`)
  await page.evaluate(() => { const at = document.getElementById('when'); window.__mount(at) })
  await page.waitForSelector('.qs-when .fc-presets')
  await page.evaluate(() => document.fonts.ready)
  const m = await page.evaluate(() => {
    const sheet = document.querySelector('.quick-sheet')
    const pan = document.querySelector('.qs-when')
    const r = (el) => el.getBoundingClientRect()
    const pres = [...pan.querySelectorAll('.fc-pre')]
    const picks = [...pan.querySelectorAll('.fc-pick, .fc-pick-x')]
    const cut = [...pan.querySelectorAll('.fc-pick-t, .fc-pick-sub')].filter((t) => t.scrollWidth > t.clientWidth + 1).length
    const fieldsOut = Math.round(Math.max(...[...pan.querySelectorAll('.fc-fields > *')].map((el) => r(el).right)) - r(pan).right)
    const natives = [...pan.querySelectorAll('input[type=date], input[type=time]')]
    const shown = pan.innerText
    const typed = pan.querySelectorAll('input:not([type=date]):not([type=time])').length
    return {
      overflow: Math.max(sheet.scrollWidth - sheet.clientWidth, pan.scrollWidth - pan.clientWidth),
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      preWrapped: pres.filter((p) => p.scrollWidth > p.clientWidth + 1 || r(p).right > r(pan).right).length,
      preCount: pres.length,
      preRow: new Set(pres.map((p) => Math.round(r(p).top))).size,
      pick: Math.round(Math.min(...picks.map((p) => Math.min(r(p).width, r(p).height)))),
      nativeVisible: natives.filter((i) => getComputedStyle(i).opacity !== '0').length,
      nativeCount: natives.length,
      cut, fieldsOut, typed,
      reminder: pan.querySelector('.fc-seg') !== null,
      above: r(pan).bottom <= r(document.querySelector('.qs-bar')).top,
      shown,
    }
  })
  const usFormat = /\b10\/16\/2026\b|--:--|\b(AM|PM)\b|mm\/dd/i.test(m.shown)
  const roFormat = /Vin 16 oct|Azi|Mâine|Ieri/.test(m.shown) && m.shown.includes('17:30')
  const maxRows = Number(process.env.TEXT_SCALE ?? 1) > 1 ? 2 : 1
  check(`foaia rapidă: panoul nu lățește foaia @${width}px`, m.overflow <= 0 && m.docOverflow <= 0 && m.above, `+${m.overflow}px, pagina +${m.docOverflow}px, deasupra rândului=${m.above}`)
  check(`foaia rapidă: presetările încap întregi @${width}px`, m.preCount === 4 && m.preWrapped === 0 && m.preRow <= maxRows, `${m.preCount} presetări, ${m.preWrapped} tăiate, ${m.preRow} rând(uri)`)
  check(`foaia rapidă: fără text în formatul nativ, fără memento, fără câmp de scris @${width}px`, !usFormat && roFormat && m.nativeVisible === 0 && m.nativeCount === 2 && !m.reminder && m.typed === 0, usFormat ? `găsit: ${m.shown.replace(/\s+/g, ' ').slice(0, 120)}` : `zi în cuvinte + 24h, memento=${m.reminder}`)
  check(`foaia rapidă: butoanele zi/oră/✕ atingibile @${width}px`, m.pick >= 32, `cel mai mic ${m.pick}px`)
  check(`foaia rapidă: butoanele zi/oră încap, etichete întregi @${width}px`, m.fieldsOut <= 0 && m.cut === 0, `+${m.fieldsOut}px, ${m.cut} tăiate`)
  if (width === 390) {
    const rd = await readable(page)
    check('foaia rapidă cu panoul: „Mâine" și „Exemplu" întregi', rd.day === 'întreg' && rd.proj === 'întreg', `${rd.day}, ${rd.proj}`)
  }
  if (DUE_SHOTS && width === 390) for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${DUE_SHOTS}/quick-date-390-${theme}.png` })
  }
  await page.close()
}

/**
 * Bara de captură de pe Linux (`QuickAdd rich`, varianta A din
 * `design/quick-bar`): fereastra de 720px, fără ramă. Markup-ul e cel al
 * componentei (copiat din DOM-ul real). Cazul cel mai lat: dată cu oră,
 * clopoțel și ✕, nume de proiect lung, inițiale, indiciul cel mai lung.
 * Invarianți: rândul nu iese din fereastră, Trimite și urgent nestriviți,
 * goală bara are ~96px (fără gol mort), niciun jeton fără fundal.
 */
const captureBar = ({ empty = false } = {}) => `
<div class="qab"><div class="qa qa-bar" style="--pc:#6e7bff"><form class="qa-form">
  <div class="qa-row"><span class="ck${empty ? '' : ' urg'}"></span><span class="qa-wrap"><span class="qa-mirror"></span><input class="qa-input" type="search" value="${empty ? '' : 'Trimite oferta revizuită clientului din Cluj'}" placeholder="Ce ai de făcut?"></span></div>
  <div class="qs-bar">
    <span class="qs-due${empty ? '' : ' on'}"><button type="button" class="qs-due-btn"><svg width="15" height="15"></svg><span class="qs-due-t">${empty ? 'Dată' : 'Mie 07/10'}</span>${empty ? '' : '<span class="qs-due-h">10:00</span><svg width="13" height="13"></svg>'}</button>${empty ? '' : '<button type="button" class="qs-due-x"><svg width="13" height="13"></svg></button>'}</span>
    <label class="qs-sel qs-proj${empty ? '' : ' tinted'}"><span class="t-dot" style="background:#6e7bff"></span><span class="qs-sel-t">${empty ? 'Inbox' : 'Aplicație Turism și încă ceva foarte lung'}</span><select><option>x</option></select></label>
    ${empty ? '' : '<span class="qs-who-badge">AP</span>'}
    <span class="qs-tools">
      <span class="qa-hint">${empty ? '<kbd>Esc</kbd> închide' : '<kbd>Tab</kbd> descriere · <kbd>↵</kbd> adaugă'}</span>
      <button type="button" class="qs-ico qs-urgent${empty ? '' : ' on'}"><svg width="15" height="15"></svg></button>
      <button type="submit" class="qs-send"${empty ? ' disabled' : ''}><svg width="16" height="16"></svg></button>
    </span>
  </div>
</form></div></div>`
console.log('\nBara de captură de pe Linux (720px, varianta A):')
for (const empty of [true, false]) {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 720, height: 300 } })
    await page.setContent(`<style>${CSS}</style>${captureBar({ empty })}`)
    // Bara e o fereastră de desktop (`installNarrow({ desktop })`), nu „îngustă”.
    await page.evaluate((t) => { document.documentElement.removeAttribute('data-narrow'); document.documentElement.setAttribute('data-theme', t) }, theme)
    await page.evaluate(() => document.fonts.ready)
    const m = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect()
      const bar = document.querySelector('.qs-bar')
      const ctl = [...bar.querySelectorAll('.qs-due, .qs-proj, .qs-urgent, .qs-send')]
      const invisible = ctl.filter((el) => {
        const cs = getComputedStyle(el)
        return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderStyle === 'none'
      }).map((el) => el.className)
      return {
        height: Math.ceil(r(document.querySelector('.qab')).height),
        overflow: Math.max(bar.scrollWidth - bar.clientWidth, document.documentElement.scrollWidth - innerWidth),
        rows: new Set(ctl.map((el) => Math.round(r(el).top))).size,
        send: Math.round(r(document.querySelector('.qs-send')).width),
        urgent: Math.round(r(document.querySelector('.qs-urgent')).width),
        proj: Math.round(r(document.querySelector('.qs-proj')).width),
        sendIn: r(document.querySelector('.qs-send')).right <= r(bar).right + 0.5,
        hint: (() => { const h = document.querySelector('.qa-hint'); return h.scrollWidth <= h.clientWidth + 0.5 })(),
        invisible,
      }
    })
    await page.close()
    const tag = `${empty ? 'goală' : 'plină'}, ${theme}`
    const maxRows = Number(process.env.TEXT_SCALE ?? 1) > 1 ? 2 : 1
    check(`bara (${tag}): rândul nu iese din fereastră`, m.overflow <= 0 && m.sendIn && m.rows <= maxRows, `+${m.overflow}px, ${m.rows} rând(uri)`)
    check(`bara (${tag}): Trimite și urgent nestriviți`, m.send >= 30 && m.urgent >= 30, `${m.send}px / ${m.urgent}px`)
    check(`bara (${tag}): proiectul vizibil, indiciul întreg`, m.proj >= 44 && m.hint, `${m.proj}px, indiciu ${m.hint ? 'întreg' : 'tăiat'}`)
    check(`bara (${tag}): jetoanele au fundal`, m.invisible.length === 0, m.invisible.join(', ') || 'toate')
    if (empty && !process.env.TEXT_SCALE) check(`bara (${tag}): ~96px, fără gol mort`, m.height >= 90 && m.height <= 100, `${m.height}px`)
  }
}

// Meniul de acțiuni al modului Vim (`ActionMenu.tsx`): același markup, rândurile
// stinse cu motivul lângă (cazul cel mai lat: trei ținte), apoi sub-meniul datei.
const amItem = (label, key, { off = null, danger = false, sub = false, cur = false } = {}) =>
  `<button class="am-item${cur ? ' cur' : ''}${off ? ' off' : ''}${danger ? ' danger' : ''}" role="menuitem">` +
  `<span class="am-label">${label}${sub ? '<span class="am-more"> ›</span>' : ''}</span>` +
  (off ? `<span class="am-why">${off}</span>` : '') + `<kbd class="am-key">${key}</kbd></button>`
const actionMenu = (level) => `<div class="am-menu" role="menu" style="left:8px;top:8px">` +
  `<div class="am-head">${level === 'date' ? '<span class="am-crumb">Acțiuni ›</span>' : ''}<span class="am-title">${level === 'date' ? 'Dată și oră' : 'Acțiuni'}</span></div>` +
  `<div class="am-subject">3 tichete</div>` +
  (level === 'date'
    ? [['Azi', 'a'], ['Mâine', 'm'], ['Luni', 'l'], ['+1 săptămână', 's'], ['Alege din calendar…', 'c'], ['Zi întreagă (scoate ora)', 'z'], ['Fără dată', '-']].map(([l, k], i) => amItem(l, k, { cur: i === 0 })).join('') +
      `<div class="am-time">Oră: scrie cifrele (<kbd>1530</kbd>, <kbd>9</kbd>) + <kbd>Enter</kbd><b class="am-time-v">15:30</b></div>`
    : amItem('Dată și oră', 't', { sub: true, cur: true }) + amItem('Mâine', 'D') + amItem('Fără dată (scoate data, ora, mementoul)', '-') +
      amItem('Urgent', '!') + amItem('Fixează sus', 'F') + amItem('Val', 'w', { sub: true }) +
      amItem('Mută în proiect', 'M', { sub: true, off: 'doar pe un tichet' }) + amItem('Pasează', '@', { off: 'doar pe un tichet' }) +
      amItem('Redenumește', 'r', { off: 'doar pe un tichet' }) + amItem('Gata', 'x') + amItem('Copiază linkul', 'y', { off: 'doar pe un tichet' }) +
      amItem('Șterge (u anulează)', 'Del', { danger: true })) +
  `<div class="am-foot">litera sau j / k + Enter · Esc închide</div></div>`

console.log('\nMeniul de acțiuni (m) — 390px și 1400px:')
for (const width of [390, 1400]) {
  for (const level of ['root', 'date']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.setContent(`<style>${CSS}</style>${actionMenu(level)}`)
    const m = await page.evaluate(() => {
      const box = document.querySelector('.am-menu').getBoundingClientRect()
      const items = [...document.querySelectorAll('.am-item')]
      const keyMin = Math.min(...items.map((i) => i.querySelector('.am-key').getBoundingClientRect().width))
      const out = items.filter((i) => i.getBoundingClientRect().right > box.right + 0.5).length
      // Eticheta poate ceda cu „…" doar când rândul are și motivul; cea cu motivul trebuie să rămână întreagă.
      const whyCut = [...document.querySelectorAll('.am-why')].filter((w) => w.scrollWidth > w.clientWidth + 1).length
      const cut = items.filter((i) => !i.querySelector('.am-why')).filter((i) => { const l = i.querySelector('.am-label'); return l.scrollWidth > l.clientWidth + 1 }).length
      const minH = Math.min(...items.map((i) => i.getBoundingClientRect().height))
      return { left: box.left, right: box.right, height: box.height, out, keyMin, whyCut, cut, minH, docOver: document.documentElement.scrollWidth - innerWidth }
    })
    check(`meniul (${level}) încape în fereastră @${width}px`, m.left >= 8 && m.right <= width - 8 + 0.5 && m.docOver <= 0 && m.height <= 900 - 16, `${m.left}…${m.right}px, înalt ${Math.round(m.height)}px`)
    check(`meniul (${level}): rânduri întregi, literele vizibile @${width}px`, m.out === 0 && m.keyMin >= 20 && m.whyCut === 0 && m.cut === 0 && m.minH >= 30, `ies=${m.out}, literă ${m.keyMin}px, motive tăiate=${m.whyCut}, etichete tăiate=${m.cut}, rând min ${m.minH}px`)
    await page.close()
  }
}

// ── Panoul dublu (spec 2026-10-22-split-pane): gazda = bara laterală + două
// iframe-uri; la 1200 (cel mai îngust la care apare butonul), 1366 și 1920.
console.log('\nPanoul dublu — gazda și bara panoului:')
for (const width of [1200, 1366, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.setContent(`<style>${CSS}</style><div id="app" class="split-host"><aside class="sidebar"></aside>
    <div class="split-panes"><div class="split-pane-frame focus"><iframe></iframe></div><div class="split-pane-frame"><iframe></iframe></div></div></div>`)
  const m = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.split-pane-frame')].map((e) => e.getBoundingClientRect())
    const line = getComputedStyle(document.querySelector('.split-pane-frame.focus'), '::before')
    return { a: Math.round(f[0].width), b: Math.round(f[1].width), right: Math.round(f[1].right), doc: document.documentElement.scrollWidth, line: line.height, bg: line.backgroundColor }
  })
  await page.close()
  check(`două panouri egale, fără derulare orizontală @${width}px`, Math.abs(m.a - m.b) <= 1 && m.a >= 420 && m.doc <= width && m.right <= width, `${m.a} + ${m.b}px, doc ${m.doc}px`)
  check(`linia accent de 2px pe panoul cu focus @${width}px`, m.line === '2px' && m.bg !== 'rgba(0, 0, 0, 0)', `${m.line}, ${m.bg}`)
}
for (const width of [420, 484, 567, 844]) {
  const page = await browser.newPage({ viewport: { width, height: 700 } })
  await page.setContent(`<script>document.documentElement.setAttribute('data-pane','L')</script><style>${CSS}</style>
    <div id="app"><div class="app-body"><div class="pane-bar">
      <button class="pane-bar-btn"><svg width="16" height="16"></svg></button>
      <span class="pane-crumb"><i class="pane-crumb-dot" style="--pc:#2F6BFF"></i><span class="pane-crumb-label">Un proiect cu un nume foarte, foarte lung de tot</span><span class="pane-crumb-sl">/</span><span class="pane-crumb-id">HORIZ-128</span></span>
      <span class="pane-twin">deschis și în celălalt panou</span><span class="pane-bar-sp"></span>
      <button class="pane-bar-btn pane-close"><svg width="16" height="16"></svg></button>
    </div><main></main></div></div>`)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.pane-bar').getBoundingClientRect()
    const x = document.querySelector('.pane-close').getBoundingClientRect()
    const app = document.getElementById('app')
    return { barW: Math.round(bar.width), xIn: x.right <= bar.right + 0.5 && x.width >= 31, h: Math.round(bar.height), cols: getComputedStyle(app).gridTemplateColumns, narrow: document.documentElement.hasAttribute('data-narrow') }
  })
  await page.close()
  check(`bara panoului: ✕ întreg, pe un rând @${width}px`, m.xIn && m.h === 44 && m.barW <= width, `bară ${m.barW}×${m.h}px`)
  check(`panoul e desktop (o coloană, fără layoutul de telefon) @${width}px`, !m.narrow && !/\s/.test(m.cols.trim()), `coloane: ${m.cols}`)
}

/**
 * Coșul (`TrashSheet.tsx`): rândul are titlul, coada (ID · proiect · când ·
 * cine) și două butoane care nu se micșorează. La 320px cu textul mărit
 * „Restaurează" n-are voie să strivească titlul la zero, și nimic nu iese din
 * foaie.
 */
const trashSheet = () => `
<div class="sheet on"><div class="sheet-scroll trash"><ul class="trash-list">
  <li class="trash-row" id="tr"><span class="trash-text"><span class="trash-title">Pregătește lansarea versiunii noi pentru toți clienții din regiune</span><span class="trash-meta"><span class="trash-id">HORIZ-128</span> · Un proiect cu nume lung · ieri 23:59 · Ionuț Popescu</span></span>
    <button class="btn-ghost trash-restore"><svg width="14" height="14"></svg> <span class="trash-restore-label">Restaurează</span></button>
    <button class="sh-delete trash-purge"><svg width="14" height="14"></svg></button></li>
  <li class="trash-row"><span class="trash-text"><span class="trash-title">Scurt</span><span class="trash-meta"><span class="trash-id">HZ-02</span> · Inbox · azi 09:05</span></span>
    <button class="btn-ghost trash-restore"><svg width="14" height="14"></svg> <span class="trash-restore-label">Restaurează</span></button>
    <button class="sh-delete trash-purge"><svg width="14" height="14"></svg></button></li>
</ul></div></div>`

console.log('\nCoșul — rândul cu Restaurează și Șterge definitiv:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${trashSheet()}`)
  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect()
    const row = document.querySelector('#tr')
    const title = row.querySelector('.trash-title')
    const restore = row.querySelector('.trash-restore')
    const purge = row.querySelector('.trash-purge')
    const label = row.querySelector('.trash-restore-label')
    const line = getComputedStyle(row, '::after')
    return {
      rowOverflow: Math.round(row.scrollWidth - r(row).width),
      titleW: Math.round(r(title).width),
      restoreIn: r(restore).right <= window.innerWidth + 0.5 && restore.scrollWidth <= restore.clientWidth + 1,
      labelShown: getComputedStyle(label).display !== 'none',
      purgeW: Math.round(r(purge).width),
      purgeIn: r(purge).right <= window.innerWidth + 0.5,
      restoreH: Math.round(r(restore).height),
      hair: line.height,
      hairBg: line.backgroundColor,
    }
  })
  await page.close()
  check(`rândul din coș fără overflow @${width}px`, m.rowOverflow <= 0, `${m.rowOverflow}px`)
  check(`titlul din coș mai are loc @${width}px`, m.titleW >= 90, `${m.titleW}px`)
  check(`„Restaurează" întreg și în ecran @${width}px`, m.restoreIn && m.restoreH >= 34, `în ecran=${m.restoreIn}, înalt=${m.restoreH}px, cuvânt=${m.labelShown}`)
  check(`„Șterge definitiv" rotund, întreg @${width}px`, m.purgeIn && m.purgeW === 34, `${m.purgeW}px`)
  check(`linia de păr dintre rânduri se vede @${width}px`, m.hair === '1px' && m.hairBg !== 'rgba(0, 0, 0, 0)', `${m.hair}, ${m.hairBg}`)
}

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} invarianți de layout încălcați:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nToți invarianții de layout trec.')
