import { useCallback, useEffect, useState } from 'react'
import { ANDROID_API_SHOTS, getAndroidBridge } from '../lib/androidBridge'

export interface ShotOffer { id: string; thumb: string }

/**
 * Captura de ecran proaspătă, oferită în foaia rapidă din APK — același gest ca
 * fereastra nativă de quick add („am o poză în clipboard, o lipesc"). Pe telefon
 * captura ajunge în galerie, nu în clipboard, deci o caută cutia (`getScreenshot`,
 * API 7). Se caută la deschiderea foii și la revenirea în aplicație (captura se
 * face cu foaia deschisă). În afara APK-ului nu face nimic: pe desktop e Ctrl+V.
 */
export function useScreenshotOffer() {
  const [offer, setOffer] = useState<ShotOffer | null>(null)

  useEffect(() => {
    const bridge = getAndroidBridge()
    if (!bridge) return
    let alive = true
    const look = async () => {
      const info = await bridge.getInfo().catch(() => null)
      if (!info || info.api < ANDROID_API_SHOTS) return
      const r = await bridge.getScreenshot().catch(() => ({}) as { id?: string; thumb?: string })
      if (alive) setOffer(r.id && r.thumb ? { id: r.id, thumb: r.thumb } : null)
    }
    void look()
    const onVisible = () => { if (document.visibilityState === 'visible') void look() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  /** Captura ca `File`, gata de pus printre fișierele foii; `null` = n-a putut fi citită. */
  const take = useCallback(async (): Promise<File | null> => {
    const bridge = getAndroidBridge()
    if (!bridge || !offer) return null
    setOffer(null)
    try {
      const r = await bridge.takeScreenshot({ id: offer.id })
      const bin = atob(r.data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new File([bytes], r.name, { type: r.type })
    } catch {
      return null
    }
  }, [offer])

  /** Sarcina a plecat fără ea: nu se mai oferă, nici aici, nici în fereastra nativă. */
  const skip = useCallback(() => {
    const bridge = getAndroidBridge()
    if (bridge && offer) void bridge.skipScreenshot({ id: offer.id }).catch(() => {})
    setOffer(null)
  }, [offer])

  return { offer, take, skip }
}
