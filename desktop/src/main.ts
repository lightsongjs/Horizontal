import { app, BrowserWindow, ipcMain, powerMonitor, shell, type WebContents } from 'electron'
import * as path from 'node:path'
import { parseReminders, planReminders, type Reminder } from './scheduler'
import { createNotifier, type Notifier, type NotifyAction } from './notify'
import { exportAppService } from './dbusService'

const START_URL = process.env.HORIZONTAL_URL ?? 'https://horizontal-dyx.pages.dev'
const ORIGIN = new URL(START_URL).origin
// `--quick-add` = rezerva scurtăturii cu aplicația oprită: omul a cerut bara,
// nu fereastra principală (care pornește ascunsă și se încarcă în spate).
const HIDDEN = process.argv.includes('--hidden') || process.argv.includes('--quick-add')

// Limba Chromium-ului, înainte de `ready`: câmpurile native de dată/oră din bară
// își iau formatul din ea, iar fără asta arătau ll/zz/aaaa (10/04/2026) lângă
// jetonul din aplicație, care scrie zz.ll.aaaa.
app.commandLine.appendSwitch('lang', 'ro-RO')

let mainWin: BrowserWindow | null = null
let barWin: BrowserWindow | null = null
let quitting = false
let notifier: Notifier | null = null

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  additionalArguments: [`--hz-origin=${ORIGIN}`, `--hz-version=${app.getVersion()}`],
})

/**
 * Doar scheme inofensive: pagina arată linkuri din comentarii scrise de oameni,
 * iar `openExternal` pe `file:`, `smb:` sau un handler înregistrat ar rula altceva.
 */
function openSafely(url: string) {
  try {
    if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url)
  } catch { /* URL invalid: ignorat */ }
}

/** Orice altă origine pleacă în browserul sistemului; fereastra rămâne Horizontal. */
function guard(wc: WebContents) {
  wc.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); openSafely(url) }
  })
  wc.setWindowOpenHandler(({ url }) => { openSafely(url); return { action: 'deny' } })
}

function createMain() {
  mainWin = new BrowserWindow({ width: 1400, height: 900, show: false, title: 'Horizontal', autoHideMenuBar: true, webPreferences: webPreferences() })
  guard(mainWin.webContents)
  void mainWin.loadURL(START_URL)
  // Închiderea ascunde: fereastra principală e cea care știe mementourile, deci
  // trebuie să rămână încărcată. Ieșirea reală: meniul (Alt → File → Quit, Ctrl+Q).
  mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin?.hide() } })
  if (!HIDDEN) mainWin.once('ready-to-show', () => mainWin?.show())
}

function createBar() {
  // Creată o dată și refolosită: proba de focus (2026-10-02) a arătat că pe
  // GNOME Wayland `show()` + `focus()` pe aceeași fereastră primește tastatura
  // din prima. Pe Wayland poziția o alege compozitorul (centrat).
  barWin = new BrowserWindow({
    width: 720, height: 150, show: false, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, center: true, title: 'Horizontal — captură',
    webPreferences: webPreferences(),
  })
  guard(barWin.webContents)
  void barWin.loadURL(`${START_URL}/quick-add`)
  // Pierderea focusului ascunde — dar nu imediat: popup-ul unui `<select>` sau
  // al unui câmp de dată din rândul de butoane ia focusul o clipă. Ascundem
  // doar dacă, după o pauză, fereastra chiar nu l-a primit înapoi.
  barWin.on('blur', () => setTimeout(() => { if (barWin && !barWin.isFocused()) barWin.hide() }, 150))
}

function showBar() {
  if (!barWin || barWin.isDestroyed()) createBar()
  barWin!.show(); barWin!.focus(); barWin!.webContents.focus()
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain()
  mainWin!.show(); mainWin!.focus()
}

// ── Mementourile ────────────────────────────────────────────────────────────
const timers = new Map<string, NodeJS.Timeout>()
const fired = new Set<string>()
let reminders: Reminder[] = []

/**
 * De la zero de fiecare dată: lista e mică (24 h), iar un singur drum de
 * planificare înseamnă că o listă nouă, un timer ajuns la termen și trezirea
 * din somn aplică exact aceeași regulă.
 */
function reschedule() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  if (!notifier) return
  const plan = planReminders(reminders, Date.now(), fired, notifier.shownKeys())
  for (const key of plan.close) void notifier.close(key)
  for (const r of plan.fireNow) { fired.add(r.key); void notifier.show(r).catch((e) => console.error('notificare', e)) }
  for (const { reminder, delayMs } of plan.arm) {
    timers.set(reminder.key, setTimeout(reschedule, delayMs))
  }
}

// Obiectul întreg, nu `{action, id}` reconstruit: `minutes` (15/30) ar dispărea
// pe drum, iar pagina ar amâna cu valoarea implicită a web-ului.
function onNotifyAction(a: NotifyAction) {
  if (a.action === 'open') showMain()
  mainWin?.webContents.send('hz:reminder-action', a)
}

function start() {
  app.on('second-instance', (_e, argv) => (argv.includes('--quick-add') ? showBar() : showMain()))
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* rezident: nu iese când se ascund ferestrele */ })

  void app.whenReady().then(async () => {
    createMain()
    createBar()
    if (process.argv.includes('--quick-add')) mainWin!.webContents.once('did-finish-load', showBar)

    ipcMain.on('hz:set-reminders', (e, list) => {
      if (e.sender !== mainWin?.webContents) return // doar fereastra principală știe lista
      reminders = parseReminders(list)
      reschedule()
    })
    ipcMain.on('hz:hide-bar', (e) => { if (e.sender === barWin?.webContents) barWin?.hide() })

    try { notifier = await createNotifier(onNotifyAction) } catch (e) { console.error('D-Bus Notifications indisponibil', e) }
    try { await exportAppService({ quickAdd: showBar, show: showMain, quit: () => app.quit() }) } catch (e) { console.error('D-Bus ro.horizontal.App', e) }

    powerMonitor.on('resume', reschedule)
    powerMonitor.on('unlock-screen', reschedule)
    reschedule()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else start()
