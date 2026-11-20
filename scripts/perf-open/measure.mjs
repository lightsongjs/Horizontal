// Cât durează deschiderea unui tichet: atingere → foaia cu descrierea în editor.
// `npm run perf:open -- [eticheta] [phone|desktop|both] [rulări]`
//
// Aplicația reală, build de producție, pe backendul local învelit în stratul
// offline (IndexedDB, ca pe Supabase) cu latență injectată din măsurători
// făcute pe producție (vite.config.ts de aici). Date sintetice cu mărimile din
// producție (dataset.mjs). Telefon = 390×844, CPU 4×, ~4G; desktop = 1440×900.
// Rezultate și metodă: docs/agent/viteza-deschidere.md.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DB } from './dataset.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const WORK = mkdtempSync(join(tmpdir(), 'perf-open-'))
const DIST = process.env.PERF_DIST ?? join(WORK, 'dist')
if (!process.env.PERF_DIST) {
  execFileSync('npx', ['vite', 'build', '--config', new URL('./vite.config.ts', import.meta.url).pathname], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PERF_OUT: DIST, VITE_DATA_SOURCE: 'local', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  })
}

const label = process.argv[2] ?? 'run'
const which = process.argv[3] ?? 'both'
const RUNS = Number(process.argv[4] ?? 3)
const PORT = Number(process.env.PERF_PORT ?? 5299), BASE = `http://localhost:${PORT}`
const srv = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } })
await new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error('preview')), 30000); srv.stdout.on('data', (d) => { if (d.toString().includes(String(PORT))) { clearTimeout(t); ok() } }) })

const PROFILES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, cpu: 4, lat: { rtt: 150, bytesPerMs: 750 } },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, cpu: 1, lat: { rtt: 100, bytesPerMs: 5000 } },
}

// Instalat înainte de atingere: rAF + MutationObserver, timpi relativi la evenimentul `click`.
const probe = (want) => new Promise((resolve) => {
  const st = { t0: null, sheet: null, desc: null, last: null, shifts: 0, lt: [] }
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) st.lt.push([e.startTime, e.duration]) })
  po.observe({ type: 'longtask', buffered: false })
  const rootSel = '.edit-sheet, .split-pane:not([hidden]), .sheet.on'
  const onClick = (e) => { if (st.t0 === null) st.t0 = e.timeStamp }
  window.addEventListener('click', onClick, true)
  const mo = new MutationObserver((ms) => { if (st.t0 !== null && ms.some((m) => (m.target instanceof Element ? m.target : m.target.parentElement)?.closest(rootSel))) st.last = performance.now() })
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  let titleTop = null
  const tick = () => {
    const now = performance.now()
    if (st.t0 !== null) {
      const root = document.querySelector(rootSel)
      const has = root && (root.textContent ?? '').includes(want)
      if (has && st.sheet === null) st.sheet = now - st.t0
      if (has && st.desc === null && root.querySelector('.md-editor .cm-content')) st.desc = now - st.t0
      if (has && st.desc !== null) {
        // Poziția descrierii în foaie (nu pe ecran: foaia de telefon crește de jos).
        const f = root.querySelector('.md-field')
        const t = f ? f.getBoundingClientRect().top - root.getBoundingClientRect().top : null
        if (titleTop === null) titleTop = t; else if (t !== null && Math.abs(t - titleTop) > 2) { st.shifts++; st.jumpPx = (st.jumpPx ?? 0) + Math.round(Math.abs(t - titleTop)); titleTop = t }
      }
      if (now - st.t0 > 4000) { mo.disconnect(); window.removeEventListener('click', onClick, true); const net = (globalThis.__NET?.log ?? []).filter((x) => x.t0 >= st.t0 - 5).map((x) => `${x.k}${x.arg ? '(' + x.arg + ')' : ''}@${Math.round(x.t0 - st.t0)}-${Math.round(x.t1 - st.t0)}`); const chunks = performance.getEntriesByType('resource').filter((r) => r.startTime >= st.t0 && /\.js/.test(r.name)).map((r) => r.name.split('/').pop()); po.disconnect(); const lts = st.lt.filter(([a]) => a >= st.t0); resolve({ jumpPx: st.jumpPx, longMax: Math.round(Math.max(0, ...lts.map((x) => x[1]))), longSum: Math.round(lts.reduce((a, x) => a + x[1], 0)), sheet: st.sheet && Math.round(st.sheet), desc: st.desc && Math.round(st.desc), settled: st.last && Math.round(st.last - st.t0), shifts: st.shifts, net, chunks }); return }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

async function measureOpen(page, rowText, closeAfter = true) {
  const p = page.evaluate(probe, rowText)
  await page.waitForTimeout(50)
  await page.locator('.list-row .list-title', { hasText: new RegExp(`^${rowText}$`) }).first().click()
  const r = await p
  if (closeAfter) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
  return r
}

async function session(browser, prof, name, warm) {
  const P = PROFILES[prof]
  const dir = warm
  const ctx = await chromium.launchPersistentContext(dir, { viewport: P.viewport, isMobile: P.isMobile, hasTouch: P.hasTouch, serviceWorkers: 'block' })
  await ctx.addInitScript(({ db, lat }) => { globalThis.__LAT = lat; if (!localStorage.getItem('horizontal:v2')) localStorage.setItem('horizontal:v2', db) }, { db: JSON.stringify(DB), lat: P.lat })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu })
  return { ctx, page }
}

const out = []
for (const prof of which === 'both' ? ['phone', 'desktop'] : [which]) {
  for (let run = 0; run < RUNS; run++) {
    const dir = mkdtempSync(join(WORK, 'prof-'))
    // Încălzire: o sesiune anterioară a deschis proiectele (baza IndexedDB plină, ca la omul care folosește zilnic).
    {
      const { ctx, page } = await session(null, prof, 'warm', dir)
      await page.goto(BASE, { waitUntil: 'networkidle' })
      for (const slug of ['inbox', 'mate-cu-sens', 'katalist']) { await page.goto(`${BASE}/project/${slug}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500) }
      await ctx.close()
    }
    const rec = (surface, n, r) => { out.push({ prof, run, surface, n, ...r }); console.log(prof, run, surface.padEnd(14), n, `sheet=${r.sheet} desc=${r.desc} settled=${r.settled} jump=${r.shifts}/${r.jumpPx ?? 0}px long=${r.longMax}/${r.longSum}`, '| net:', r.net.join(' '), '| js:', r.chunks.join(',')) }
    // „Azi": pornire proaspătă, atingere după 3s.
    {
      const { ctx, page } = await session(null, prof, 'azi', dir)
      await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(3000)
      rec('azi', '1-MS', await measureOpen(page, 'Mate cu Sens — sarcina 1'))
      rec('azi', '2-MS', await measureOpen(page, 'Mate cu Sens — sarcina 2'))
      rec('azi', '3-KATA', await measureOpen(page, 'Katalist — sarcina 1'))
      rec('azi', '4-D', await measureOpen(page, 'Inbox — sarcina 1'))
      await ctx.close()
    }
    // Atingere grăbită: la 0.5s după pornire (înaintea preîncărcării editorului).
    {
      const { ctx, page } = await session(null, prof, 'azi-fast', dir)
      await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.locator('.list-row .list-title').first().waitFor(); await page.waitForTimeout(500)
      rec('azi-rapid', '1-MS', await measureOpen(page, 'Mate cu Sens — sarcina 1'))
      await ctx.close()
    }
    for (const [slug, nm] of [['inbox', 'Inbox'], ['mate-cu-sens', 'Mate cu Sens']]) {
      const { ctx, page } = await session(null, prof, slug, dir)
      await page.goto(`${BASE}/project/${slug}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(3000)
      if (prof === 'desktop') { const tab = page.locator('.tab', { hasText: /^List/ }).first(); if (await tab.isVisible().catch(() => false)) { await tab.click(); await page.waitForTimeout(500) } }
      const rows = await page.locator('.list-row .list-title').allTextContents()
      const pick = rows.filter((t) => t.startsWith(nm + ' — ')).slice(0, 2)
      rec(`proiect:${slug}`, '1', await measureOpen(page, pick[0]))
      rec(`proiect:${slug}`, '2', await measureOpen(page, pick[1]))
      await ctx.close()
    }
  }
}
// Mediane
const groups = {}
for (const r of out) { const k = `${r.prof} ${r.surface} ${r.n}`; (groups[k] ??= []).push(r) }
const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
console.log(`\n== ${label} (mediane din ${RUNS}) ==`)
for (const [k, rs] of Object.entries(groups)) console.log(k.padEnd(32), `sheet=${med(rs.map((r) => r.sheet))} desc=${med(rs.map((r) => r.desc))} settled=${med(rs.map((r) => r.settled))} jump=${med(rs.map((r) => r.shifts))} longMax=${med(rs.map((r) => r.longMax))} longSum=${med(rs.map((r) => r.longSum))}`)
srv.kill()
rmSync(WORK, { recursive: true, force: true })
