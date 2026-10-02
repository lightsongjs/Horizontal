// Proba de butoane: GNOME pliază butoanele dacă notificarea nu e extinsă, iar
// asta nu se vede din cod — se verifică pe ecran, cu exact hint-urile cutiei.
// Rulează: node desktop/scripts/notify-probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const dbus = require('dbus-next')
const { Variant } = dbus

const bus = dbus.sessionBus()
const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
const n = obj.getInterface('org.freedesktop.Notifications')
const id = await n.Notify('Horizontal', 0, 'horizontal', 'Sună la bancă', '10:00 · Personal',
  ['default', 'Deschide', 'done', 'Gata', 'snooze15', '15 min', 'snooze30', '30 min'],
  { urgency: new Variant('y', 2), resident: new Variant('b', true), 'desktop-entry': new Variant('s', 'horizontal') }, -1)
console.log('notificare', id, '— apasă un buton (Ctrl+C ca să ieși)')
n.on('ActionInvoked', (nid, key) => { if (nid === id) console.log('acțiune:', key) })
n.on('NotificationClosed', (nid, reason) => { if (nid === id) { console.log('închisă, motiv', reason); bus.disconnect() } })
