// cli/install.mjs — pune `hz` pe PATH: symlink ~/.local/bin/hz → cli/hz.mjs din
// repo. Un symlink, nu o copie: `git pull` actualizează CLI-ul fără reinstalare.
//
//   node cli/install.mjs              (npm run hz:install)
//   node cli/install.mjs --uninstall  (npm run hz:uninstall)
//
// HZ_BIN_DIR mută directorul (testele îl țin departe de ~/.local/bin).

import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = join(dirname(fileURLToPath(import.meta.url)), 'hz.mjs')
const binDir = resolve(process.env.HZ_BIN_DIR || join(homedir(), '.local', 'bin'))
const link = join(binDir, 'hz')

function isLink(p) {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

if (process.argv.includes('--uninstall')) {
  if (isLink(link)) {
    const to = resolve(binDir, readlinkSync(link))
    if (to !== target) {
      console.error(`${link} duce la ${to}, nu la acest repo; îl las în pace.`)
      process.exit(1)
    }
    unlinkSync(link)
    console.log(`șters: ${link}`)
  } else if (existsSync(link)) {
    console.error(`${link} nu e un symlink pus de hz:install; îl las în pace.`)
    process.exit(1)
  } else {
    console.log(`nimic de șters: ${link} nu există`)
  }
  process.exit(0)
}

chmodSync(target, 0o755)
mkdirSync(binDir, { recursive: true })
if (isLink(link)) unlinkSync(link) // reinstalare / alt clone: înlocuim legătura
else if (existsSync(link)) {
  console.error(`${link} există și nu e un symlink; mută-l și rulează din nou.`)
  process.exit(1)
}
symlinkSync(target, link)
console.log(`instalat: ${link} → ${target}`)

const onPath = (process.env.PATH ?? '').split(delimiter).some((d) => d && resolve(d) === binDir)
if (!onPath) {
  console.warn(`\natenție: ${binDir} nu e în PATH. Adaugă în ~/.bashrc:\n  export PATH="${binDir}:$PATH"`)
}
console.log('\nUrmătorii pași: hz login   apoi, în rădăcina unui repo: hz init <proiect>')
