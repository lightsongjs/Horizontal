import { useEffect, useState } from 'react'
import { buildTitle, formatBuildAge } from '../lib/buildAge'

const BUILT = new Date(__BUILD_TIME__)
const TITLE = buildTitle(BUILT, __BUILD_COMMIT__)

/**
 * „Versiune · acum 2 min”, sub numele omului (sertar + bara laterală): omul
 * vede dacă ultimul push a ajuns pe dispozitiv. Își ține singur ceasul (30 s,
 * plus la revenirea în tab), ca bara laterală să nu se randeze întreagă.
 */
export function BuildAge() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, 30_000)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  const age = formatBuildAge(BUILT, now)
  if (!age) return null
  return <span className="me-build" title={TITLE}>Versiune · {age}</span>
}
