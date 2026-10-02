import type { DesktopAction, DesktopReminder } from './desktopBridge'

/**
 * Contractul cu cutia de Android (`mobile/`, pluginul Kotlin `HorizontalAndroid`).
 * Pagina NU ia `@capacitor/core` ca dependință — build-ul site-ului rămâne
 * neatins — ci vorbește direct cu puntea injectată de Capacitor în pagină
 * (`window.Capacitor`). Schimbă tipurile de aici doar împreună cu
 * `mobile/android/.../HorizontalAndroidPlugin.kt` — același contract, scris de două ori.
 */
export const ANDROID_API_REQUIRED = 1
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
  addListener(event: 'reminderAction', fn: (a: DesktopAction) => void): Promise<Listener>
  addListener(event: 'changed', fn: () => void): Promise<Listener>
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
    async addListener(eventName: string, fn: (d: never) => void) {
      const callbackId = cap.nativeCallback(NAME, 'addListener', { eventName }, fn as (d: unknown) => void)
      return { remove: async () => { await cap.nativePromise(NAME, 'removeListener', { eventName, callbackId }) } }
    },
  } as HorizontalAndroidPlugin
}

/**
 * Cât de proaspătă e lista trimisă cutiei. Offline, store-ul arată cache-ul,
 * care poate fi vechi; o listă nativă citită de la server trebuie să câștige
 * atunci, altfel un memento mutat pe laptop ar suna la ora veche.
 */
export function pageReadAt(status: { offline: boolean }, now: Date): number {
  return status.offline ? 0 : now.getTime()
}
