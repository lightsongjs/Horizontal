// node design/logo/build-svg.mjs — scrie variant-a..d.svg din variants.js
import { readFileSync, writeFileSync } from 'node:fs'
const dir = new URL('.', import.meta.url)
const window = {}
new Function('window', readFileSync(new URL('variants.js', dir), 'utf8'))(window)
for (const v of window.HZ_VARIANTS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <rect width="512" height="512" rx="112" fill="${v.bg}"/>\n  ${v.fg}\n</svg>\n`
  writeFileSync(new URL(`variant-${v.id}.svg`, dir), svg)
}
console.log('ok')
