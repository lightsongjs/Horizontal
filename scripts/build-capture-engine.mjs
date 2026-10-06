// Împachetează `src/capture/engine.ts` pentru motorul JS al ferestrei de quick
// add de pe telefon. Rulat de `npm run android:apk`; ieșirea e gitignorată.
// `write: false` întoarce codul (testul îl rulează în `node:vm`).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OUT = path.join(root, 'mobile/android/app/src/main/assets/capture-engine.js')

export async function buildCaptureEngine({ write = true } = {}) {
  const r = await build({
    entryPoints: [path.join(root, 'src/capture/engine.ts')],
    bundle: true, format: 'iife', target: 'es2020', minify: true, write,
    outfile: OUT, logLevel: 'silent',
  })
  return write ? OUT : r.outputFiles[0].text
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`motorul de captură → ${path.relative(root, await buildCaptureEngine())}`)
}
