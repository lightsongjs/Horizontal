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

// `.replace(/^﻿/, '')`: `styles.css` are BOM (salvat de un editor Windows).
// Injectat inline într-un `<style>` (nu ca foaie externă), BOM-ul rămâne text
// literal înaintea `@import`-ului — Chromium aruncă atunci nu doar @import-ul,
// ci și `:root{}` de după, deci NICIO variabilă CSS (`--surface-3`, `--amb`
// etc.) nu se mai rezolvă. Latent până acum: niciun check de mai jos n-a citit
// o culoare calculată — abia bara de om verifică fundal/umbră.
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/^﻿/, '')

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
 * Bara de filtre de om stă pe rând PROPRIU, frate al `.wave-sel` — nu al
 * treilea copil al lui. Un check pe LĂȚIME nu prinde greșeala asta: sub
 * 899px `.wave-sel` are deja `flex-wrap: wrap`, deci rândurile se despart
 * oricum indiferent unde stă elementul, iar la 1000px+ diferența e reală
 * (970px vs. 579px) dar tot rămâne peste orice prag rezonabil de „lățime minimă" —
 * verificat empiric, mutând bara ca al treilea copil: testul pe lățimi trecea
 * la fel. De-aia verificarea de mai jos e STRUCTURALĂ (`.who-bar` nu are voie
 * să aibă `.wave-sel` ca părinte), nu geometrică. Celelalte trei — înălțimea
 * jetonului, derularea, vizibilitatea — chiar testează ce pretind și rămân.
 */
const whoBar = () => `
<div class="wave-sel">
  <div class="wave-tabs"><button>Val 1</button><button>Val 2</button><button>Val 3</button></div>
  <div class="wave-actions"><button>A</button><button>B</button></div>
</div>
<div class="who-bar">
  <button class="who-chip">Toți <span class="n">12</span></button>
  <button class="who-chip">Nepasate <span class="n">7</span></button>
  <button class="who-chip on">Alexandru <span class="n">3</span></button>
  <button class="who-chip">Maria Popescu <span class="n">2</span></button>
</div>`

console.log('Bara de filtre de om (ListView):')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${whoBar()}`)
  const isSibling = await page.evaluate(() => {
    const bar = document.querySelector('.who-bar')
    const waveSel = document.querySelector('.wave-sel')
    return bar.parentElement !== waveSel
  })
  await page.close()
  check(
    '`.who-bar` nu e al treilea copil al `.wave-sel`',
    isSibling,
    isSibling ? 'e frate, nu copil' : 'COPIL — ar fura din `.wave-tabs` (flex:1)',
  )
}

for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${whoBar()}`)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.who-bar')
    const chip = document.querySelector('.who-chip')
    const barStyle = getComputedStyle(bar)
    const chipStyle = getComputedStyle(chip)
    return {
      chipH: Math.round(chip.getBoundingClientRect().height),
      // Bara își duce singură depășirea, prin scroll orizontal — nu o împinge
      // în pagină și nu se înfășoară. (Proprietatea de derulat trăiește pe
      // BARĂ, nu pe jeton — jetonul nu se derulează pe cont propriu.)
      scrolls: bar.scrollWidth > Math.round(bar.getBoundingClientRect().width),
      overflowX: barStyle.overflowX,
      // Un control fără fundal ȘI fără chenar e invizibil.
      visible: chipStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' || chipStyle.boxShadow !== 'none',
    }
  })
  await page.close()

  check(`jeton atingibil @${width}px`, m.chipH >= 28, `${m.chipH}px înălțime`)
  check(`bara se derulează @${width}px`, !m.scrolls || m.overflowX === 'auto', `overflow-x: ${m.overflowX}`)
  check(`jeton vizibil @${width}px`, m.visible, m.visible ? 'are fundal sau umbră' : 'INVIZIBIL')
}

/**
 * Bara de jos (`TabBar` din App.tsx, Task 9) — patru butoane cu `flex: 1`.
 * „Proiecte" e eticheta cea mai lungă, la cel mai îngust ecran. Trei lucruri
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
  <button data-tab="projects"><span class="tb-ico"><svg width="21" height="21"></svg></span>Proiecte</button>
</nav>`

console.log('\nBara de jos (`TabBar`) — patru butoane pe telefon:')
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
 * Meta colapsată din `IssueForm.tsx`, pe telefon: rămân pe ecran doar
 * urgentul și scadența, iar scadența e UN câmp cu cinci controale care nu se
 * micșorează (două câmpuri de cifre, calendarul, ceasul, ștergerea). Cu
 * butoanele crescute la deget, rândul e cel mai aproape de a se rupe — și tot
 * aici se verifică ordinea: bara stă DEASUPRA rezumatului „Detalii", ceea ce
 * vine dintr-un `order: -1`, adică exact genul de regulă pe care o rescrie
 * din greșeală următoarea atingere a secțiunii.
 */
const collapsedMeta = (open = false) => `
<div class="sheet"><div class="sheet-scroll if-body">
  <div class="sh-meta-section${open ? '' : ' meta-collapsed'}">
    <div class="if-fast-zone">
      <div class="if-bar if-bar-fast">
        <button class="if-ctl icon ghost"><svg width="15" height="15"></svg></button>
        <div class="due-inputs">
          <input class="due-input due-input-date" value="17/09/2026">
          <input class="due-native" type="date">
          <button class="due-pick"><svg width="13" height="13"></svg></button>
          <input class="due-input due-input-time" value="09:30">
          <input class="due-native" type="time">
          <button class="due-pick"><svg width="13" height="13"></svg></button>
          <button class="due-clear">×</button>
        </div>
      </div>
      <div class="if-bar-sub"></div>
    </div>
    <button class="meta-recap">
      <span class="meta-recap-label">Detalii</span>
      <span class="meta-recap-sep">·</span>
      <span class="meta-recap-text">Val 1 · Alexandru</span>
    </button>
    <div class="meta-body">
      <div class="if-bar">
        <button class="if-ctl ghost"><span class="if-av nobody">+</span><span class="if-ctl-txt">Nimeni</span></button>
        <div class="if-seg"><button class="on">I</button><button>II</button></div>
        <div class="if-theme-wrap"><button class="if-ctl"><span class="if-ctl-txt">temă</span></button></div>
      </div>
    </div>
  </div>
</div></div>`

console.log('\nMeta colapsată (IssueForm, mobil) — urgentul și scadența:')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${collapsedMeta()}`)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.if-bar-fast')
    const field = document.querySelector('.due-inputs')
    const picks = [...document.querySelectorAll('.due-pick')]
    const recap = document.querySelector('.meta-recap')
    const body = document.querySelector('.meta-body')
    const r = (el) => el.getBoundingClientRect()
    return {
      // Câmpul de scadență nu iese din bară, iar ce e în el nu iese din câmp.
      barOverflow: Math.round(r(field).right - r(bar).right),
      fieldOverflow: field.scrollWidth - Math.round(r(field).width),
      pick: Math.round(Math.min(...picks.map((p) => Math.min(r(p).width, r(p).height)))),
      aboveRecap: r(bar).top < r(recap).top,
      // Scadența ia tot golul rămas pe rând, după urgent.
      gapRight: Math.round(r(bar).right - r(field).right),
      dateW: Math.round(document.querySelector('.due-input-date').getBoundingClientRect().width),
      // Colaps = „Detalii" chiar e închis.
      bodyHidden: getComputedStyle(body).display === 'none',
    }
  })
  await page.close()

  check(`scadența în bară @${width}px`, m.barOverflow <= 1, `${m.barOverflow}px peste bară`)
  check(`câmp nestrivit @${width}px`, m.fieldOverflow <= 0, `${m.fieldOverflow}px peste câmp`)
  check(`calendar/ceas atingibile @${width}px`, m.pick >= 32, `cel mai mic ${m.pick}px`)
  check(`scadența umple rândul @${width}px`, Math.abs(m.gapRight) <= 1, `${m.gapRight}px gol la dreapta`)
  check(`câmpul datei crește @${width}px`, m.dateW > 82, `${m.dateW}px (peste cei 82px de desktop)`)
  check(`bara peste „Detalii" @${width}px`, m.aboveRecap, m.aboveRecap ? 'deasupra rezumatului' : 'SUB rezumat')
  check(`„Detalii" chiar e închis @${width}px`, m.bodyHidden, m.bodyHidden ? 'corpul e ascuns' : 'corpul rămâne vizibil')
}

/**
 * Desfacerea „Detaliilor" arată DOAR ce se schimbă rar. Scadența și urgentul
 * stau în afara corpului, deci un click pe rezumat nu mai are cum să le mute:
 * structural, nu geometric — un check pe poziții ar trece și cu ele înăuntru,
 * atâta timp cât nimic nu se suprapune.
 */
console.log('\n„Detalii" desfăcut (mobil) — ce intră sub capac:')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await page.setContent(`<style>${CSS}</style>${collapsedMeta(true)}`)
  const m = await page.evaluate(() => {
    const body = document.querySelector('.meta-body')
    const fast = document.querySelector('.if-fast-zone')
    const r = (el) => el.getBoundingClientRect()
    return {
      hasDue: !!body.querySelector('.due-inputs'),
      hasUrgent: !!body.querySelector('.if-ctl.icon'),
      visible: getComputedStyle(body).display !== 'none',
      fastStays: r(fast).height > 0 && r(fast).bottom <= r(body).top + 1,
    }
  })
  await page.close()
  check('corpul apare', m.visible, m.visible ? 'vizibil' : 'ASCUNS')
  check('scadența nu intră sub capac', !m.hasDue, m.hasDue ? 'e ÎN corp' : 'rămâne afară')
  check('urgentul nu intră sub capac', !m.hasUrgent, m.hasUrgent ? 'e ÎN corp' : 'rămâne afară')
  check('rândul rapid rămâne sus', m.fastStays, m.fastStays ? 'deasupra corpului' : 'mutat')
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
const quickBar = ({ day = 'Mie 07/10', time = '10:00', proj = 'Aplicație Turism și încă ceva lung', send = true } = {}) => `
<div class="kb-sheet quick-sheet" style="animation:none"><form class="qs-form">
  <span class="qa-wrap"><span class="qa-mirror"></span><input class="qa-input" value="Sună la bancă"></span>
  <textarea class="qa-desc" rows="1" placeholder="Descriere"></textarea>
  <div class="qs-bar">
    <button type="button" class="qs-due on"><svg width="15" height="15"></svg><span class="qs-due-t">${day}</span><span class="qs-due-h">${time}</span></button>
    <button type="button" class="qs-ico qs-urgent on"><svg width="16" height="16"></svg></button>
    <label class="qs-sel qs-proj"><span class="t-dot" style="background:#6e7bff"></span><span class="qs-sel-t">${proj}</span><select><option>x</option></select></label>
    <label class="qs-sel qs-who on"><svg width="15" height="15"></svg><select><option>x</option></select></label>
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

console.log('\nRândul de controale al foii rapide (`.qs-bar`):')
for (const width of PHONE_WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  await page.setContent(`<style>${CSS}</style>${quickBar()}`)
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.qs-bar')
    const r = (sel) => document.querySelector(sel).getBoundingClientRect()
    const barR = bar.getBoundingClientRect()
    const send = r('.qs-send')
    const kids = [...bar.children]
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
      invisible,
    }
  })
  await page.close()
  check(`fără overflow @${width}px`, m.overflow <= 0, `${m.overflow}px peste rând`)
  check(`trimite nestrivit @${width}px`, m.sendW >= 36 && m.sendInside, `${m.sendW}px${m.sendInside ? '' : ', împins afară'}`)
  check(`proiectul vizibil @${width}px`, m.proj >= 40, `${m.proj}px`)
  check(`jetonul de dată vizibil @${width}px`, m.due >= 34, `${m.due}px`)
  check(`fiecare control are fundal @${width}px`, m.invisible.length === 0, m.invisible.length ? `INVIZIBIL: ${m.invisible.join(', ')}` : 'toate')
}

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} invarianți de layout încălcați:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nToți invarianții de layout trec.')
