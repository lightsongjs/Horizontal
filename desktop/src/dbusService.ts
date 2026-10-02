import * as dbus from 'dbus-next'

const NAME = 'ro.horizontal.App'
const PATH = '/ro/horizontal/App'

/**
 * Ușa pentru scurtătura GNOME: `gdbus call … QuickAdd` (~10 ms) e mult mai
 * rapid decât o a doua lansare a binarului, care pornește tot Chromium doar ca
 * să afle că există deja o instanță. `Quit` e pentru instalator.
 */
export async function exportAppService(h: { quickAdd(): void; show(): void; quit(): void }): Promise<boolean> {
  const { Interface } = dbus.interface
  class AppIface extends Interface {
    QuickAdd() { h.quickAdd() }
    Show() { h.show() }
    Quit() { h.quit() }
  }
  AppIface.configureMembers({
    methods: {
      QuickAdd: { inSignature: '', outSignature: '' },
      Show: { inSignature: '', outSignature: '' },
      Quit: { inSignature: '', outSignature: '' },
    },
  })
  const bus = dbus.sessionBus()
  const reply = await bus.requestName(NAME, dbus.NameFlag.DO_NOT_QUEUE)
  if (reply !== dbus.RequestNameReply.PRIMARY_OWNER) return false
  bus.export(PATH, new AppIface(NAME))
  return true
}
