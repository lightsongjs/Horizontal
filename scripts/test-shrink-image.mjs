// Verificarea în browser a micșorării: canvas, EXIF, toBlob — lucruri pe care
// testele unitare nu le pot atinge.
//
// Rulează cu `npm run test:shrink`. Nu e în suita implicită (cere browser și
// server de dezvoltare); își pornește singur serverul, ca să nu aibă pași de
// pregătire pe care cineva să-i uite.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = Number(process.env.SHRINK_PORT ?? 5311)
const APP = process.env.APP_URL ?? `http://localhost:${PORT}`
let server = null

if (!process.env.APP_URL) {
  // Comandă ca un singur șir: cu `shell: true` și listă de argumente, Node
  // avertizează (DEP0190) că argumentele se concatenează, nu se escapează.
  server = spawn(`npx vite --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true })
  const deadline = Date.now() + 60000
  for (;;) {
    try { if ((await fetch(APP)).ok) break } catch { /* încă nu răspunde */ }
    if (Date.now() > deadline) {
      server.kill()
      console.error('Serverul de dezvoltare nu a pornit în 60s.')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
process.on('exit', () => { if (server) server.kill() })

const out = []
const check = (n, c, d = '') => out.push(`${c ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`)

/**
 * MODUL DE CALIBRARE: `npm run test:shrink -- --calibrate <cale-poza>`
 *
 * Trece o imagine REALĂ prin mai multe combinații, scrie rezultatele pe disc și
 * taie din fiecare o bucată la scară 1:1 din zona cu text dens. Constantele din
 * `SHRINK_DEFAULTS` se aleg uitându-te la bucățile alea, nu la kilobytes.
 */
const COMBOS = [
  { maxEdge: 3072, photoQuality: 0.92 }, // implicitul propus
  { maxEdge: 3072, photoQuality: 0.85 },
  { maxEdge: 3072, photoQuality: 0.78 },
  { maxEdge: 2048, photoQuality: 0.85 },
]

async function calibrate(page, filePath) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { basename, join, extname } = await import('node:path')
  const raw = readFileSync(filePath)
  const dir = join(process.cwd(), 'tmp-calibrare')
  mkdirSync(dir, { recursive: true })
  const ext = extname(filePath).toLowerCase()
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  console.log(`original: ${basename(filePath)}, ${(raw.length / 1024).toFixed(0)} KB, ${type}`)

  const results = await page.evaluate(async ({ b64, combos, type }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const { shrinkImage } = await import('/src/lib/shrinkImage.ts')
    const file = new File([bin], `proba${type === 'image/png' ? '.png' : '.jpg'}`, { type })
    const toB64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const byte of buf) s += String.fromCharCode(byte)
      return btoa(s)
    }
    const dimsOf = async (f) => {
      const b = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const d = { w: b.width, h: b.height }
      b.close()
      return d
    }
    const src = await dimsOf(file)
    const list = []
    for (const c of combos) {
      const shrunk = await shrinkImage(file, {
        ...c,
        photoSkipUnderBytes: 0,
        shotSkipUnderBytes: 0,
      })
      const d = await dimsOf(shrunk)
      // Bucată la scară 1:1 din treimea de sus, unde textul e cel mai dens.
      const cw = Math.min(1000, d.w)
      const ch = Math.min(560, d.h)
      const cv = document.createElement('canvas')
      cv.width = cw; cv.height = ch
      const bmp = await createImageBitmap(shrunk, { imageOrientation: 'from-image' })
      cv.getContext('2d').drawImage(bmp, Math.round((d.w - cw) / 2), Math.round(d.h * 0.08), cw, ch, 0, 0, cw, ch)
      bmp.close()
      const cropBlob = await new Promise((r) => cv.toBlob(r, 'image/png'))
      list.push({ ...c, size: shrunk.size, outType: shrunk.type, w: d.w, h: d.h, img: await toB64(shrunk), crop: await toB64(cropBlob) })
    }
    return { src, list }
  }, { b64: raw.toString('base64'), combos: COMBOS, type })

  console.log(`decodat: ${results.src.w}×${results.src.h}`)
  console.log('latura  calitate  marime      ieșire       dimensiuni     raport')
  for (const r of results.list) {
    const name = `${r.maxEdge}-q${String(r.photoQuality).replace('.', '')}`
    const outExt = r.outType === 'image/webp' ? 'webp' : r.outType === 'image/png' ? 'png' : 'jpg'
    writeFileSync(join(dir, `proba-${name}.${outExt}`), Buffer.from(r.img, 'base64'))
    writeFileSync(join(dir, `crop-${name}.png`), Buffer.from(r.crop, 'base64'))
    console.log(
      `${String(r.maxEdge).padEnd(7)} ${String(r.photoQuality).padEnd(9)} ` +
      `${(r.size / 1024).toFixed(0).padStart(6)} KB  ${r.outType.padEnd(12)} ` +
      `${`${r.w}×${r.h}`.padEnd(14)} de ${(raw.length / r.size).toFixed(1)}× mai mic`,
    )
  }
  console.log(`\nFisierele si bucatile 1:1 sunt in ${dir}`)
  console.log('Uita-te la crop-*.png: se citeste textul mic? Aia e conditia, nu kilobytes.')
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => out.push(`FAIL eroare JS — ${e.message}`))
await page.goto(APP)

const calibIdx = process.argv.indexOf('--calibrate')
if (calibIdx >= 0) {
  const path = process.argv[calibIdx + 1]
  if (!path) {
    console.error('Lipseste calea: npm run test:shrink -- --calibrate C:\\cale\\poza.png')
    await browser.close()
    process.exit(1)
  }
  await calibrate(page, path)
  await browser.close()
  process.exit(0)
}

const run = async (name, bytes, type) => page.evaluate(async ({ name, bytes, type }) => {
  const { shrinkImage } = await import('/src/lib/shrinkImage.ts')
  const file = new File([new Uint8Array(bytes)], name, { type })
  const outFile = await shrinkImage(file)
  const dims = async (f) => {
    // Întoarce null pe ce nu se decodează, în loc să arunce. Cazul real:
    // GIF-ul fals din verificarea 5. `shrinkImage` îl întoarce neatins, exact
    // cum trebuie — dar harness-ul îl mai măsoară o dată după aceea, iar
    // `createImageBitmap` aruncă. Fără garda asta, scriptul moare înainte de
    // tally și pare că verificările n-au rulat, când în realitate au trecut.
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const d = { w: bmp.width, h: bmp.height }
      bmp.close()
      return d
    } catch {
      return null
    }
  }
  return {
    inSize: file.size, outSize: outFile.size,
    inName: file.name, outName: outFile.name,
    outType: outFile.type, same: outFile === file,
    outDims: outFile.type.startsWith('image/') ? await dims(outFile) : null,
  }
}, { name, bytes: [...bytes], type })

// ── 1. fotografie uriașă: se micșorează, iese JPEG, latura lungă sub maxEdge
const photo = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 6000; c.height = 4000
  const x = c.getContext('2d')
  x.fillStyle = '#cbb'; x.fillRect(0, 0, c.width, c.height)
  x.fillStyle = '#123'; x.font = '90px Georgia'
  for (let y = 200; y < c.height; y += 200) x.fillText('detaliu fin 0123456789', 100, y)
  const img = x.getImageData(0, 0, c.width, 400)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.sin(i) * 12) | 0
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
  }
  x.putImageData(img, 0, 0)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r1 = await run('IMG_0001.jpg', Buffer.from(photo), 'image/jpeg')
check('fotografia uriasa se micsoreaza', r1.outSize < r1.inSize, JSON.stringify({ in: r1.inSize, out: r1.outSize }))
check('latura lunga ajunge sub maxEdge (3072)', r1.outDims && Math.max(r1.outDims.w, r1.outDims.h) <= 3072, JSON.stringify(r1.outDims))
check('scara e un divizor intreg (6000/2 = 3000)', r1.outDims && r1.outDims.w === 3000 && r1.outDims.h === 2000, JSON.stringify(r1.outDims))
check('fotografia iese JPEG', r1.outType === 'image/jpeg', r1.outType)
check('numele primeste .jpg', r1.outName === 'IMG_0001.jpg', r1.outName)

// ── 2. PNG mare cu text: iese WEBP, NICIODATA JPEG
const shot = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 4000; c.height = 2200
  const x = c.getContext('2d')
  x.fillStyle = '#1e1e1e'; x.fillRect(0, 0, c.width, c.height)
  x.fillStyle = '#9cdcfe'; x.font = '18px monospace'
  for (let y = 30; y < c.height; y += 24) x.fillText('const x = foo(bar, baz) // 0123456789 il1I O0', 20, y)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r2 = await run('ecran.png', Buffer.from(shot), 'image/png')
check('PNG-ul NU iese niciodata JPEG', r2.outType !== 'image/jpeg', r2.outType)
check('PNG mare iese WEBP sau rămâne PNG neatins', r2.outType === 'image/webp' || r2.same === true, JSON.stringify({ type: r2.outType, same: r2.same }))
check('nicio ieșire nu e mai mare decat intrarea', r2.outSize <= r2.inSize, JSON.stringify({ in: r2.inSize, out: r2.outSize }))

// ── 3. imagine mica: nu se atinge, si e CHIAR acelasi obiect
const small = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 600; c.height = 400
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r3 = await run('mica.jpg', Buffer.from(small), 'image/jpeg')
check('imaginea mica nu se atinge (acelasi fisier, nu o copie)', r3.same === true && r3.outSize === r3.inSize, JSON.stringify(r3))

// ── 4. PDF: nu se atinge
const r4 = await run('raport.pdf', Buffer.from('%PDF-1.4 fake'), 'application/pdf')
check('PDF-ul nu se atinge', r4.same === true, JSON.stringify(r4))

// ── 5. GIF: nu se atinge (animatia ar muri)
const r5 = await run('anim.gif', Buffer.from('GIF89a fake'), 'image/gif')
check('GIF-ul nu se atinge', r5.same === true, JSON.stringify(r5))

await browser.close()
console.log(out.join('\n'))
console.log(`\n${out.filter((l) => l.startsWith('OK')).length} ok, ${out.filter((l) => l.startsWith('FAIL')).length} fail`)
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)
