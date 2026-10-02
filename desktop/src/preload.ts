import { contextBridge, ipcRenderer } from 'electron'

/**
 * Puntea, și NUMAI pe originea aplicației: dacă fereastra ar ajunge vreodată pe
 * altă pagină (un link, o redirecționare), pagina aceea nu primește nimic. Rulează
 * în sandbox — fără Node; originea și versiunea vin prin `additionalArguments`.
 * Contractul e `HorizontalDesktop` din `src/lib/desktopBridge.ts`.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

if (location.origin === arg('hz-origin')) {
  contextBridge.exposeInMainWorld('horizontalDesktop', {
    version: arg('hz-version') ?? '0',
    setReminders: (list: unknown) => ipcRenderer.send('hz:set-reminders', list),
    onReminderAction: (fn: (a: unknown) => void) => {
      const h = (_e: unknown, a: unknown) => fn(a)
      ipcRenderer.on('hz:reminder-action', h)
      return () => { ipcRenderer.removeListener('hz:reminder-action', h) }
    },
    onResync: (fn: () => void) => {
      const h = () => fn()
      ipcRenderer.on('hz:resync', h)
      return () => { ipcRenderer.removeListener('hz:resync', h) }
    },
    hideBar: () => ipcRenderer.send('hz:hide-bar'),
  })
}
