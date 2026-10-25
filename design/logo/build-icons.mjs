// node design/logo/build-icons.mjs — logoul D-207 în toate formatele aplicației.
// Semnul e redesenat după „Horizontal App Logo Style Guide.png” (atașat la D-207,
// copie în export/style-guide.png), măsurat pe pixeli. Sursa unică: SYMBOL mai jos.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const out = (p) => new URL(p, root)

// Inelul (R 159 / 109, centru 256,256) tăiat de un gol în care stă bara.
// Căi fără mască, ca să meargă identic în SVG și în VectorDrawable.
const UPPER = 'M97.81 272A159 159 0 1 1 414.19 272L363.82 272A109 109 0 1 0 148.18 272Z'
const LOWER = 'M122.91 343L190.33 343A109 109 0 0 0 321.67 343L389.09 343A159 159 0 0 1 122.91 343Z'
const BAR = 'M77 286H435A22 22 0 0 1 435 330H77A22 22 0 0 1 77 286Z'
const STOPS = [['0', '#2366FF'], ['.5', '#1DA1DC'], ['1', '#16D0A4']]
const GRAD = { x1: 131, y1: 221, x2: 381, y2: 395 }

const gradDef = `<linearGradient id="hz" gradientUnits="userSpaceOnUse" x1="${GRAD.x1}" y1="${GRAD.y1}" x2="${GRAD.x2}" y2="${GRAD.y2}">${STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`
const symbol = (fill = 'url(#hz)', scale = 1) => {
  const t = scale === 1 ? '' : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`
  return `<g fill="${fill}"${t}><path d="${UPPER}"/><path d="${LOWER}"/><path d="${BAR}"/></g>`
}
const svg = (body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${extra}<defs>${gradDef}</defs>${body}</svg>\n`

const card = (bg) => svg(`<rect width="512" height="512" rx="115" fill="${bg}"/>${symbol()}`)
const square = (scale) => svg(`<rect width="512" height="512" fill="#FFFFFF"/>${symbol('url(#hz)', scale)}`)

// Favicon: alb pe tema luminoasă, fundalul întunecat al aplicației pe cea întunecată.
const favicon = svg(
  `<rect class="c" width="512" height="512" rx="115" fill="#FFFFFF"/>${symbol()}`,
  '<style>@media (prefers-color-scheme: dark){.c{fill:#141517}}</style>',
)

const browser = await chromium.launch()
const page = await browser.newPage()
async function png(svgText, size, file) {
  await page.setViewportSize({ width: size, height: size })
  const s = svgText.replace('<svg ', `<svg width="${size}" height="${size}" `)
  await page.setContent(`<html><body style="margin:0;background:transparent">${s}</body></html>`)
  await page.locator('svg').screenshot({ path: out(file).pathname, omitBackground: true })
}

// Web / PWA / iOS / Linux
writeFileSync(out('public/icon.svg'), favicon)
await png(card('#FFFFFF'), 192, 'public/pwa-192x192.png')
await png(card('#FFFFFF'), 512, 'public/pwa-512x512.png')
await png(square(0.8), 512, 'public/pwa-maskable-512x512.png') // zona sigură: cercul de 80%
await png(square(0.86), 180, 'public/apple-touch-icon.png')     // iOS își rotunjește singur colțurile
await png(card('#FFFFFF'), 512, 'desktop/assets/icon.png')

// Android: adaptive icon (fundal alb + semnul în zona sigură de 66/108dp) + monocrom.
const res = 'mobile/android/app/src/main/res/'
const FG = 0.72 // colțul barei ajunge la ~32,5dp de centru: în cercul sigur de 33dp
const fgSvg = svg(symbol('url(#hz)', FG))
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [d, s] of Object.entries(legacy)) {
  await png(fgSvg, Math.round(s * 2.25), `${res}mipmap-${d}/ic_launcher_foreground.png`)
  await png(card('#FFFFFF'), s, `${res}mipmap-${d}/ic_launcher.png`)
  await png(svg(`<circle cx="256" cy="256" r="256" fill="#FFFFFF"/>${symbol('url(#hz)', 0.86)}`), s, `${res}mipmap-${d}/ic_launcher_round.png`)
}
// Monocromul e vector: sistemul îl colorează (iconițe tematice, Android 13+).
const vd = (d) => `    <path android:fillColor="#FFFFFFFF" android:pathData="${d}"/>`
writeFileSync(out(`${res}drawable/ic_launcher_monochrome.xml`), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generat de design/logo/build-icons.mjs (D-207). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">
  <group android:pivotX="256" android:pivotY="256" android:scaleX="${FG}" android:scaleY="${FG}">
${[UPPER, LOWER, BAR].map(vd).join('\n')}
  </group>
</vector>
`)
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  writeFileSync(out(`${res}mipmap-anydpi-v26/${f}`), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
`)
}
await browser.close()
console.log('ok')
