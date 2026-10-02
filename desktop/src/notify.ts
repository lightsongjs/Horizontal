import * as dbus from 'dbus-next'
import type { Reminder } from './scheduler'

export type NotifyAction = { action: 'done' | 'snooze' | 'open'; id: string }

export interface Notifier {
  show(r: Reminder): Promise<void>
  close(key: string): Promise<void>
  /** Cheile notificărilor încă pe ecran — planificatorul le retrage pe cele care nu mai sunt în listă. */
  shownKeys(): Set<string>
}

/**
 * Notificările merg direct pe D-Bus, nu prin `Notification` din Electron
 * (n-are acțiuni pe Linux) și nici prin portal (v1 n-are ce trebuie).
 * `urgency=2` extinde notificarea în GNOME, deci butoanele se văd; `resident`
 * o ține pe ecran după o acțiune — o retragem noi, când pagina confirmă.
 */
export async function createNotifier(onAction: (a: NotifyAction) => void): Promise<Notifier> {
  const bus = dbus.sessionBus()
  const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
  const n = obj.getInterface('org.freedesktop.Notifications')
  const byKey = new Map<string, number>()
  const byNid = new Map<number, { key: string; id: string }>()

  n.on('ActionInvoked', (nid: number, actionKey: string) => {
    const hit = byNid.get(nid)
    if (!hit) return
    if (actionKey === 'done' || actionKey === 'snooze') onAction({ action: actionKey, id: hit.id })
    else if (actionKey === 'default') onAction({ action: 'open', id: hit.id })
  })
  n.on('NotificationClosed', (nid: number) => {
    const hit = byNid.get(nid)
    if (!hit) return
    byNid.delete(nid)
    byKey.delete(hit.key)
  })

  return {
    async show(r) {
      const nid: number = await n.Notify('Horizontal', 0, 'horizontal', r.title, r.body,
        ['default', 'Deschide', 'done', 'Gata', 'snooze', 'Amână 5 min'],
        { urgency: new dbus.Variant('y', 2), resident: new dbus.Variant('b', true), 'desktop-entry': new dbus.Variant('s', 'horizontal') },
        -1)
      byKey.set(r.key, nid)
      byNid.set(nid, { key: r.key, id: r.id })
    },
    async close(key) {
      const nid = byKey.get(key)
      if (nid === undefined) return
      byKey.delete(key)
      byNid.delete(nid)
      await n.CloseNotification(nid).catch(() => {})
    },
    shownKeys: () => new Set(byKey.keys()),
  }
}
