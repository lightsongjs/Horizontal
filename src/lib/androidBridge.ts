import type { AgendaItem } from './agenda'
import type { DesktopAction, DesktopReminder } from './desktopBridge'
import { isInboxProject } from './captureTokens'

/**
 * Contractul cu cutia de Android (`mobile/`, pluginul Kotlin `HorizontalAndroid`).
 * Pagina NU ia `@capacitor/core` ca dependință — build-ul site-ului rămâne
 * neatins — ci vorbește direct cu puntea injectată de Capacitor în pagină
 * (`window.Capacitor`). Schimbă tipurile de aici doar împreună cu
 * `mobile/android/.../HorizontalAndroidPlugin.kt` — același contract, scris de două ori.
 */
export const ANDROID_API_REQUIRED = 1
/** API 2: widget-urile (`setAgenda`, `leave`, `showKeyboard`, evenimentul `widget`). */
export const ANDROID_API_WIDGETS = 2
/** API 3: fereastra nativă de quick add (`setCaptureData`). */
export const ANDROID_API_CAPTURE = 3

/** Ce îi trebuie ferestrei de quick add: proiectele în care se poate scrie și oamenii. */
export interface CaptureData {
  projects: { id: string; name: string; prefix: string; type: string }[]
  assignees: { id: string; name: string }[]
  readAt: number
}

/** Atingere pe widget, reținută de cutie până pune pagina ascultătorul. */
export type WidgetEvent = { kind: 'open'; id: string } | { kind: 'quick' }
/** Un telefon nedeschis câteva zile trebuie să aibă tot planul. */
export const ANDROID_WINDOW = { horizonMs: 7 * 24 * 3_600_000, limit: 100 }

export interface AndroidStatus {
  notifications: 'granted' | 'denied' | 'prompt'
  /** `canScheduleExactAlarms()`. */
  exactAlarms: boolean
  /** Ultima alarmă chiar a fost pusă exactă (altfel `setAndAllowWhileIdle`, cu minute de întârziere). */
  exactUsed: boolean
  batteryOptimized: boolean
  manufacturer: string
  session: 'ok' | 'missing'
  lastSyncAt: string | null
  nextAlarmAt: string | null
  queued: number
}

export interface Listener { remove(): Promise<void> }

export interface HorizontalAndroidPlugin {
  getInfo(): Promise<{ version: string; api: number }>
  setReminders(o: { list: DesktopReminder[]; heldIds: string[]; readAt: number }): Promise<void>
  /** Acțiunile din notificare încă netrimise de cutie, PRELUATE: cutia nu le mai trimite. */
  takeActions(): Promise<{ actions: DesktopAction[] }>
  signIn(o: { url: string; anonKey: string; email: string; password: string }): Promise<void>
  signOut(): Promise<void>
  status(): Promise<AndroidStatus>
  requestNotificationPermission(): Promise<{ notifications: AndroidStatus['notifications'] }>
  openSettings(o: { kind: 'notifications' | 'exact-alarms' | 'battery' }): Promise<void>
  /** API 2. Rândurile widget-ului de agendă, negrupate (gruparea e a cutiei). */
  setAgenda(o: { items: AgendaItem[]; readAt: number }): Promise<void>
  /** API 2. Pagina a închis ce deschisese widget-ul: înapoi pe ecranul de start. */
  leave(): Promise<void>
  /** API 2. Ridică tastatura pe WebView (foaia rapidă deschisă din widget). */
  showKeyboard(): Promise<void>
  /** API 3. */
  setCaptureData(o: CaptureData): Promise<void>
  addListener(event: 'reminderAction', fn: (a: DesktopAction) => void): Promise<Listener>
  addListener(event: 'changed', fn: () => void): Promise<Listener>
  addListener(event: 'widget', fn: (e: WidgetEvent) => void): Promise<Listener>
}

interface CapacitorGlobal {
  isNativePlatform?(): boolean
  getPlatform?(): string
  nativePromise(plugin: string, method: string, options: unknown): Promise<unknown>
  nativeCallback(plugin: string, method: string, options: unknown, cb: (data: unknown) => void): string
}

const NAME = 'HorizontalAndroid'

/**
 * Același obiect la fiecare apel (cât timp `window.Capacitor` e același):
 * componentele îl pun în dependențele efectelor, iar un obiect nou la fiecare
 * randare ar fi demontat și remontat ascultătorii la fiecare schimbare de store.
 */
let cached: { cap: CapacitorGlobal; bridge: HorizontalAndroidPlugin } | null = null

export function getAndroidBridge(): HorizontalAndroidPlugin | null {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return null
  if (cached?.cap === cap) return cached.bridge
  const bridge = buildBridge(cap)
  cached = { cap, bridge }
  return bridge
}

function buildBridge(cap: CapacitorGlobal): HorizontalAndroidPlugin {
  // Fără @capacitor/core, `registerPlugin` nu există: apelurile merg prin
  // primitivele punții, exact cum le face și `registerPlugin` intern.
  const call = (method: string) => (o: unknown = {}) => cap.nativePromise(NAME, method, o)
  return {
    getInfo: call('getInfo'),
    setReminders: call('setReminders'),
    takeActions: call('takeActions'),
    signIn: call('signIn'),
    signOut: call('signOut'),
    status: call('status'),
    requestNotificationPermission: call('requestNotificationPermission'),
    openSettings: call('openSettings'),
    setAgenda: call('setAgenda'),
    leave: call('leave'),
    showKeyboard: call('showKeyboard'),
    setCaptureData: call('setCaptureData'),
    async addListener(eventName: string, fn: (d: never) => void) {
      const callbackId = cap.nativeCallback(NAME, 'addListener', { eventName }, fn as (d: unknown) => void)
      return { remove: async () => { await cap.nativePromise(NAME, 'removeListener', { eventName, callbackId }) } }
    },
  } as HorizontalAndroidPlugin
}

/** Ce știe stratul offline despre vârsta scadențelor (`SyncControl.dueFetchedAt`). */
export interface DueFreshness { dueFetchedAt(): number }

/**
 * `readAt` al listei trimise cutiei = vârsta DATELOR, nu ora trimiterii: PORNIREA
 * ultimei citiri de rețea reușite a scadențelor (0 = doar cache). Cutia păstrează
 * lista citită mai recent; cu `acum`, o listă din cache (primul cadru, sau o citire
 * căzută pe cache) ar fi bătut o listă nativă mai proaspătă — un memento mutat pe
 * laptop ar fi sunat la ora veche, iar unul sunat de cutie s-ar fi retras.
 * Offline tot 0: atunci store-ul arată cache-ul. Fără strat offline (nu e cazul pe
 * Android, unde e mereu Supabase) datele vin direct de la server.
 */
export function pageReadAt(status: { offline: boolean }, sync: DueFreshness | undefined, now: Date): number {
  if (status.offline) return 0
  return sync ? sync.dueFetchedAt() : now.getTime()
}

/**
 * Acțiunile preluate din cutie se execută abia peste date de la server. Peste
 * cache, garda recurenței ar compara cu o scadență veche și ar arunca un „Gata"
 * bun (sau, fără gardă, l-ar executa pe o stare depășită); nepreluate, le trimite
 * cutia singură când are rețea.
 */
export function canTakeActions(sync: DueFreshness | undefined): boolean {
  return !sync || sync.dueFetchedAt() > 0
}

/** Cheia de deduplicare a retrimiterii. `readAt` intră: o citire nouă de rețea
 *  face lista paginii mai proaspătă decât cea nativă, chiar cu același conținut. */
export function androidListKey(list: DesktopReminder[], heldIds: string[], readAt: number): string {
  return JSON.stringify([list, heldIds, readAt])
}

/** Cheia de deduplicare a agendei trimise widget-ului; `readAt` intră, ca la `androidListKey`. */
export function agendaKey(items: AgendaItem[], readAt: number): string {
  return JSON.stringify([readAt, items])
}

export function captureData(
  projects: { id: string; name: string; prefix: string; type: string }[],
  assignees: { id: string; name: string }[],
  readAt: number,
): CaptureData {
  return {
    // Inbox primul: un APK dinainte de `inboxProjectId` îl caută după numele
    // vechi („Daily"), nu-l găsește și cade pe primul proiect personal — care,
    // așa, e tot Inbox. Și în selectorul ferestrei e primul, ca în rol.
    projects: [...projects.filter(isInboxProject), ...projects.filter((p) => !isInboxProject(p))]
      .map(({ id, name, prefix, type }) => ({ id, name, prefix, type })),
    assignees: assignees.map(({ id, name }) => ({ id, name })),
    readAt,
  }
}

/** Fără `readAt`: lista se retrimite doar când se schimbă ce vede fereastra. */
export function captureKey(d: CaptureData): string {
  return JSON.stringify([d.projects, d.assignees])
}
