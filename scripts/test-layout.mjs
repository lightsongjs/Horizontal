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
    <div class="due-inputs">
      <input class="due-input due-input-date" value="17/09/2026">
      <input class="due-native" type="date">
      <button class="due-pick"><svg width="13" height="13"></svg></button>
      <input class="due-input due-input-time" value="09:30">
      <input class="due-native" type="time">
      <button class="due-pick"><svg width="13" height="13"></svg></button>
    </div>
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
  await page.setContent(`<style>${CSS}</style><div class="split" style="height:900px;width:1000px"><div class="split-list"></div><aside class="split-pane">${formHead(datePop(false))}</aside></div>`)
  const m = await page.evaluate(() => {
    const pane = document.querySelector('.split-pane')
    const pop = document.querySelector('.fc-pop')
    const r = (el) => el.getBoundingClientRect()
    return {
      paneW: Math.round(r(pane).width),
      popOut: Math.round(r(pop).right - r(pane).right),
      popOverflow: pop.scrollWidth - pop.clientWidth,
      dueOut: Math.round(r(document.querySelector('.due-inputs')).right - r(pop).right),
    }
  })
  const row = await page.evaluate(measureRow)
  await page.close()
  check('panoul are lățimea de panou', m.paneW >= 440 && m.paneW <= 620, `${m.paneW}px`)
  check('rândul nu iese din panou', row.overflow <= 0 && row.out === 0, `${row.overflow}px, ${row.out} jetoane afară`)
  check('jetoane nestrivite în panou', row.crushed === 0, `${row.crushed} sub 28px`)
  check('aliniat cu titlul în panou', Math.abs(row.alignGap) <= 1, `${row.alignGap}px`)
  check('popoverul datei încape în panou', m.popOut <= 0 && m.popOverflow <= 0, `${m.popOut}px peste panou, ${m.popOverflow}px în el`)
  check('câmpul datei încape în popover', m.dueOut <= 0, `${m.dueOut}px peste`)
}

console.log('\nPopoverul datei ca foaie de jos (telefon):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style><div class="sheet on tall" style="position:static;transform:none;width:100%">${formHead()}</div>${datePop(true)}`)
  const m = await page.evaluate(() => {
    const pop = document.querySelector('.fc-sheet')
    const field = document.querySelector('.fc-sheet .due-inputs')
    const picks = [...document.querySelectorAll('.fc-sheet .due-pick')]
    const pres = [...document.querySelectorAll('.fc-sheet .fc-pre')]
    const r = (el) => el.getBoundingClientRect()
    return {
      popW: Math.round(r(pop).width),
      popOverflow: pop.scrollWidth - pop.clientWidth,
      fieldOut: Math.round(r(field).right - r(pop).right),
      fieldOverflow: field.scrollWidth - Math.round(r(field).width),
      pick: Math.round(Math.min(...picks.map((p) => Math.min(r(p).width, r(p).height)))),
      preWrapped: pres.some((p) => p.scrollWidth > p.clientWidth + 1),
      docOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  await page.close()
  check(`foaia pe toată lățimea @${width}px`, m.popW === width && m.docOverflow <= 0, `${m.popW}px, pagina +${m.docOverflow}px`)
  check(`nimic nu iese din foaie @${width}px`, m.popOverflow <= 0 && m.fieldOut <= 0, `${m.popOverflow}px / câmp +${m.fieldOut}px`)
  check(`câmp nestrivit @${width}px`, m.fieldOverflow <= 0, `${m.fieldOverflow}px peste câmp`)
  check(`calendar/ceas atingibile @${width}px`, m.pick >= 32, `cel mai mic ${m.pick}px`)
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
    <button type="button" class="qs-ico qs-urgent on"><svg width="16" height="16"></svg></button>
    <label class="qs-sel qs-proj"><span class="t-dot" style="background:#6e7bff"></span><span class="qs-sel-t">${proj}</span><select><option>x</option></select></label>
    ${send ? '' : '<button type="button" class="qs-ico qs-who-badge">MIH</button>'}
    ${ATTACH(menu)}
    <button type="button" class="qs-ico qs-more"><svg width="16" height="16"></svg></button>
    ${send ? '<button type="submit" class="qs-send"><svg width="18" height="18"></svg></button>' : ''}
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
    const kids = [...bar.children].filter((el) => !el.classList.contains('qs-attach-wrap')).concat([document.querySelector('.qs-attach')])
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
      invisible,
    }
  })
  await page.close()
  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste rând`)
  check(`${send ? 'trimite' : '„…"'} nestrivit @${width}px`, m.sendW >= 34 && m.sendInside, `${m.sendW}px${m.sendInside ? '' : ', împins afară'}`)
  check(`agrafa nestrivită @${width}px`, m.attachW >= 34, `${m.attachW}px`)
  check(`proiectul vizibil @${width}px`, m.proj >= 40, `${m.proj}px`)
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
    <span class="dr-who"><span class="dr-name">Ionuț Salonariu Popescu-Vlădescu</span><span class="dr-email">ionut.foarte.lung@exemplu-domeniu.ro</span></span>
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

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} invarianți de layout încălcați:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nToți invarianții de layout trec.')
