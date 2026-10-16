import { useEffect, useState } from 'react'
import { ANDROID_API_SHADE, getAndroidBridge } from '../lib/androidBridge'
import { errorMessage } from '../lib/errorMessage'

/**
 * Comutatorul notificării fixe din bară (D-185), în rotița de setări — e a
 * telefonului, ca fundalul și mărimea textului. Numai în cutia de Android, și
 * numai de la API 5: un apel către o metodă pe care cutia n-o are nu e respins
 * de Capacitor, atârnă. Fără ea, nimic.
 */
export function AndroidShadeSetting() {
  const bridge = getAndroidBridge()
  const [on, setOn] = useState<boolean | null>(null)
  const [denied, setDenied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void (async () => {
      const info = await bridge.getInfo().catch(() => null)
      if (!alive || !info || info.api < ANDROID_API_SHADE) return
      const [s, st] = await Promise.all([bridge.getShade(), bridge.status().catch(() => null)])
      if (!alive) return
      setOn(s.enabled)
      setDenied(st?.notifications === 'denied')
    })().catch((e) => { if (alive) setErr(errorMessage(e)) })
    return () => { alive = false }
  }, [bridge])

  if (!bridge || on === null) return null

  const toggle = async (next: boolean) => {
    setOn(next)
    setErr(null)
    try {
      setOn((await bridge.setShade({ enabled: next })).enabled)
    } catch (e) {
      setOn(!next)
      setErr(errorMessage(e))
    }
  }

  return (
    <>
      <div className="sheet-section-t">Bara de notificări</div>
      <label className="int-cal">
        <span className="int-cal-name">Azi în bara de notificări</span>
        <input type="checkbox" className="int-switch" checked={on} onChange={(e) => void toggle(e.target.checked)} />
      </label>
      <p className="int-note">
        {denied
          ? 'Notificările aplicației sunt oprite, deci nu apare. Le pornești din „Referință” → Aplicația de Android.'
          : 'Câte sarcini ai azi, prima dintre ele și „+” pentru o sarcină nouă — fără sunet, mereu acolo.'}
      </p>
      {err && <p className="int-err">{err}</p>}
    </>
  )
}
