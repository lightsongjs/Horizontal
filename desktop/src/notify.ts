import * as dbus from 'dbus-next'
import type { Reminder } from './scheduler'

/** Aceeași formă ca `DesktopAction` din src/lib/desktopBridge.ts — `minutes` doar la `snooze`. */
export type NotifyAction = { action: 'done' | 'snooze' | 'open'; id: string; minutes?: number }

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
 * o ține pe ecran după o acțiune, deci o închidem noi imediat după ce am
 * transmis acțiunea. GNOME arată cel mult 3 butoane, de-aia „Gata” plus două
 * amânări (15/30 min); web-ul rămâne la 5 min, fiindcă notificarea de pe telefon
 * o construiește serverul.
 */
export async function createNotifier(onAction: (a: NotifyAction) => void): Promise<Notifier> {
  const bus = dbus.sessionBus()
  const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
  const n = obj.getInterface('org.freedesktop.Notifications')
  const byKey = new Map<string, number>()
  const byNid = new Map<number, { key: string; id: string }>()

  const closeKey = async (key: string) => {
    const nid = byKey.get(key)
    if (nid === undefined) return
    byKey.delete(key)
    byNid.delete(nid)
    await n.CloseNotification(nid).catch(() => {})
  }

  n.on('ActionInvoked', (nid: number, actionKey: string) => {
    const hit = byNid.get(nid)
    if (!hit) return
    if (actionKey === 'done') onAction({ action: 'done', id: hit.id })
    else if (actionKey === 'snooze15') onAction({ action: 'snooze', id: hit.id, minutes: 15 })
    else if (actionKey === 'snooze30') onAction({ action: 'snooze', id: hit.id, minutes: 30 })
    else if (actionKey === 'default') onAction({ action: 'open', id: hit.id })
    else return
    // Rezidentă: n-ar dispărea singură. Și la „deschide” o închidem — omul merge la tichet.
    void closeKey(hit.key)
  })
  n.on('NotificationClosed', (nid: number) => {
    const hit = byNid.get(nid)
    if (!hit) return
    byNid.delete(nid)
    byKey.delete(hit.key)
  })

  return {
    async show(r) {
      // Un eveniment de calendar nu se bifează și nu se amână: doar „Deschide".
      const actions = r.kind === 'event'
        ? ['default', 'Deschide']
        : ['default', 'Deschide', 'done', 'Gata', 'snooze15', '15 min', 'snooze30', '30 min']
      const nid: number = await n.Notify('Horizontal', 0, 'horizontal', r.title, r.body,
        actions,
        { urgency: new dbus.Variant('y', 2), resident: new dbus.Variant('b', true), 'desktop-entry': new dbus.Variant('s', 'horizontal') },
        -1)
      byKey.set(r.key, nid)
      byNid.set(nid, { key: r.key, id: r.id })
    },
    close: closeKey,
    shownKeys: () => new Set(byKey.keys()),
  }
}
