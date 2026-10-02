// desktop/scripts/install.mjs — rulat de `npm run desktop:install` după `electron-builder --linux dir`.
// Re-rulabil: fiecare pas suprascrie ce a scris data trecută.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatStrv, KEYBINDING_PATH, parseStrv, withPath } from './gsettings.mjs'

const HOME = homedir()
const here = new URL('..', import.meta.url).pathname
const built = join(here, 'release', 'linux-unpacked')
const opt = join(HOME, '.local', 'opt', 'horizontal')
const bin = join(HOME, '.local', 'bin')
const exe = join(bin, 'horizontal')
const quick = join(bin, 'horizontal-quick-add')
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

if (!existsSync(join(built, 'horizontal'))) throw new Error(`lipsește ${built}/horizontal — rulează întâi electron-builder`)

// 1. Oprește instanța care rulează (binarul nu se poate înlocui de sub ea).
try { run('gdbus', ['call', '--session', '--dest', 'ro.horizontal.App', '--object-path', '/ro/horizontal/App', '--method', 'ro.horizontal.App.Quit']) } catch { /* nu rula */ }
// `Quit` doar cere închiderea; înlocuirea fișierelor de sub o instanță încă vie
// ar strica copia. Așteaptă (max ~5 s) să se elibereze numele de pe magistrală.
const hasOwner = () => {
  try { return run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'ro.horizontal.App']).includes('true') } catch { return false }
}
for (let i = 0; i < 25 && hasOwner(); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)

// 2. Programul.
rmSync(opt, { recursive: true, force: true })
mkdirSync(opt, { recursive: true })
cpSync(built, opt, { recursive: true })
mkdirSync(bin, { recursive: true })
rmSync(exe, { force: true })
symlinkSync(join(opt, 'horizontal'), exe)

// 3. Scurtătura: `gdbus call` (~10 ms) cu rezervă pe a doua lansare, dacă aplicația nu rulează.
writeFileSync(quick, `#!/bin/sh
gdbus call --session --dest ro.horizontal.App --object-path /ro/horizontal/App --method ro.horizontal.App.QuickAdd >/dev/null 2>&1 || exec "${exe}" --quick-add
`)
chmodSync(quick, 0o755)

// 4. Iconițele, în tema utilizatorului (vezi DESKTOP-INSTALL-HOWTO.md).
const icons = join(HOME, '.local', 'share', 'icons', 'hicolor')
const pub = join(here, '..', 'public')
for (const [size, file] of [['512x512', 'pwa-512x512.png'], ['192x192', 'pwa-192x192.png']]) {
  mkdirSync(join(icons, size, 'apps'), { recursive: true })
  cpSync(join(pub, file), join(icons, size, 'apps', 'horizontal.png'))
}
mkdirSync(join(icons, 'scalable', 'apps'), { recursive: true })
cpSync(join(pub, 'icon.svg'), join(icons, 'scalable', 'apps', 'horizontal.svg'))
try { run('gtk-update-icon-cache', ['-f', '-t', icons]) } catch { /* opțional */ }

// 5. Lansatorul și autostart-ul. Numele `horizontal.desktop` = `desktopName` din package.json,
//    ca GNOME să lege fereastra de iconiță. Suprascrie un lansator PWA mai vechi cu același nume.
const entry = (extra) => `[Desktop Entry]
Type=Application
Name=Horizontal
Comment=Planificare și sarcini
Exec=${exe}${extra} %U
Icon=horizontal
Categories=Office;ProjectManagement;
StartupWMClass=horizontal
`
const apps = join(HOME, '.local', 'share', 'applications')
mkdirSync(apps, { recursive: true })
writeFileSync(join(apps, 'horizontal.desktop'), entry(''))
const autostart = join(HOME, '.config', 'autostart')
mkdirSync(autostart, { recursive: true })
writeFileSync(join(autostart, 'horizontal.desktop'), entry(' --hidden') + 'X-GNOME-Autostart-enabled=true\n')

// 6. Ctrl+Shift+A, adăugată la lista existentă (custom0 rămâne).
const KB = 'org.gnome.settings-daemon.plugins.media-keys'
const list = parseStrv(run('gsettings', ['get', KB, 'custom-keybindings']))
run('gsettings', ['set', KB, 'custom-keybindings', formatStrv(withPath(list, KEYBINDING_PATH))])
const kb = `${KB}.custom-keybinding:${KEYBINDING_PATH}`
run('gsettings', ['set', kb, 'name', 'Horizontal — captură'])
run('gsettings', ['set', kb, 'command', quick])
run('gsettings', ['set', kb, 'binding', '<Control><Shift>a'])

console.log(`Instalat în ${opt}. Pornește-l din meniu sau cu: ${exe}`)
