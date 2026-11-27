import { getAndroidBridge } from './androidBridge'
import { getDesktopBridge } from './desktopBridge'

/**
 * „Fereastră nouă" (H-16): încă un Horizontal pe ruta de acum, de mutat pe alt
 * ecran — alternativa la panoul dublu, în care nu se mai investește.
 *
 * - Cutia de Linux: puntea (`newWindow`) — `window.open` acolo pleacă în
 *   browserul sistemului. Cutie veche, fără metodă → `null`, fără buton.
 * - APK: `null` — o fereastră nouă n-are sens pe telefon/tabletă.
 * - Browser / PWA instalat: o fereastră popup pe aceeași adresă (în PWA,
 *   adresa e în scope, deci se deschide ca fereastră a aplicației).
 */
export function newWindowOpener(): (() => void) | null {
  const desktop = getDesktopBridge()
  if (desktop) return desktop.newWindow ? () => desktop.newWindow!() : null
  if (getAndroidBridge()) return null
  return () => { window.open(location.href, '_blank', 'popup,width=1200,height=850') }
}
