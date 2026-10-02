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
