import type { AndroidStatus } from './androidBridge'
import { ANDROID_API_REQUIRED } from './androidBridge'

export type CardNeed = 'update-app' | 'permission' | 'reconnect' | 'chrome-subs' | null

/**
 * Ce cere cardul din „Azi" pe Android — un singur lucru o dată, cel mai
 * blocant primul. Nimic de cerut = nimic de arătat: un card permanent pentru
 * ceva ce se setează o dată e zgomot (aceeași regulă ca `PushToggle`).
 */
export function cardNeed(o: { api: number; status: AndroidStatus; chromeSubs: number; webSignedIn: boolean }): CardNeed {
  if (o.api < ANDROID_API_REQUIRED) return 'update-app'
  if (o.status.notifications !== 'granted') return 'permission'
  // Nelogat în pagină: parola o cere ecranul de login, iar logarea dă și
  // cutiei sesiunea ei — un al doilea câmp de parolă aici ar fi redundant.
  if (o.status.session === 'missing' && o.webSignedIn) return 'reconnect'
  if (o.chromeSubs > 0) return 'chrome-subs'
  return null
}

/** Abonamentele web push ale lui Chrome de pe telefon — cele care ar dubla mementoul cutiei. */
export function isAndroidChromeSub(ua: string | null): boolean {
  return !!ua && /Android/.test(ua)
}

/**
 * Producătorii care opresc aplicațiile în fundal peste ce cere Android-ul
 * (dontkillmyapp.com). Doar la ei optimizarea bateriei merită un îndemn: pe
 * un Android curat alarmele exacte sună oricum, iar un „Setări" fără motiv
 * învață omul să ignore îndemnurile.
 */
const AGGRESSIVE_OEMS = ['xiaomi', 'redmi', 'poco', 'samsung', 'huawei', 'honor', 'oneplus', 'oppo', 'vivo', 'realme']

export function batteryNeedsHint(s: AndroidStatus): boolean {
  return s.batteryOptimized && AGGRESSIVE_OEMS.includes(s.manufacturer.toLowerCase())
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `zz.ll HH:mm`, ora locală. `null` pentru lipsă SAU dată nevalidă — ecranul de verificare n-are voie să arate „NaN". */
export function formatStamp(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** „prompt" nu e „blocate": nimeni n-a refuzat nimic încă, iar cererea o face cardul din „Azi". */
export function notificationsLabel(n: AndroidStatus['notifications']): string {
  return n === 'granted' ? 'permise' : n === 'denied' ? 'blocate' : 'necerute încă'
}

/**
 * A picat un apel fiindcă cutia nu ARE metoda/pluginul — singurul caz în care
 * „actualizează aplicația" e adevărat. Orice altă eroare (o punte ocupată, un
 * răspuns stricat) nu spune nimic despre versiune, iar un îndemn fals la
 * actualizare ar trimite omul după o versiune pe care o are deja.
 *
 * Formele: `UNIMPLEMENTED` / „not implemented" sunt ale lui Capacitor;
 * „unable to find plugin" e mesajul lui `Bridge.java` pentru un plugin
 * neînregistrat. (O METODĂ lipsă dintr-un plugin existent nu respinge deloc
 * pe Android — se loghează și promisiunea atârnă —, dar `getInfo` a venit
 * odată cu pluginul, deci acel caz nu există în practică.)
 */
export function isMissingNative(e: unknown): boolean {
  if (e == null) return false
  const o = (typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  if (o.code === 'UNIMPLEMENTED') return true
  const msg = typeof e === 'string' ? e : typeof o.message === 'string' ? o.message : ''
  return /not implemented|unimplemented|unable to find plugin/i.test(msg)
}
