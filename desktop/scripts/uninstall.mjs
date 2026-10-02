// desktop/scripts/uninstall.mjs
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatStrv, KEYBINDING_PATH, parseStrv, withoutPath } from './gsettings.mjs'

const HOME = homedir()
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
try { run('gdbus', ['call', '--session', '--dest', 'ro.horizontal.App', '--object-path', '/ro/horizontal/App', '--method', 'ro.horizontal.App.Quit']) } catch { /* nu rula */ }
for (const p of [
  join(HOME, '.local', 'opt', 'horizontal'),
  join(HOME, '.local', 'bin', 'horizontal'),
  join(HOME, '.local', 'bin', 'horizontal-quick-add'),
  join(HOME, '.local', 'share', 'applications', 'horizontal.desktop'),
  join(HOME, '.config', 'autostart', 'horizontal.desktop'),
]) rmSync(p, { recursive: true, force: true })
const KB = 'org.gnome.settings-daemon.plugins.media-keys'
const list = parseStrv(run('gsettings', ['get', KB, 'custom-keybindings']))
run('gsettings', ['set', KB, 'custom-keybindings', formatStrv(withoutPath(list, KEYBINDING_PATH))])
for (const k of ['name', 'command', 'binding']) run('gsettings', ['reset', `${KB}.custom-keybinding:${KEYBINDING_PATH}`, k])
console.log('Dezinstalat. Iconițele din ~/.local/share/icons rămân (le folosește și varianta PWA).')
