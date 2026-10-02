import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getAndroidBridge, type AndroidStatus } from '../lib/androidBridge'
import { cardNeed } from '../lib/androidCard'
import { deleteAndroidChromeSubs, readAndroidChromeSubIds } from '../lib/androidSubs'
import { supabaseAnonKey, supabaseUrl } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'
import { playChime, unlockChime } from '../lib/chime'
import { useAuth } from '../auth'
import { Icon } from './Icon'

const DISMISS_KEY = 'horizontal:android-card-dismissed'

interface Snapshot { api: number; status: AndroidStatus; chromeSubIds: string[] }

/**
 * Cardul din capul listei „Azi", în aplicația de Android. Ține locul
 * comutatorului de web push: acolo mementourile le sună cutia (alarme exacte),
 * iar ce poate lipsi e altceva — permisiunea, sesiunea cutiei, sau un Chrome
 * rămas abonat pe același telefon (fiecare memento ar suna de două ori).
 *
 * Arată un singur lucru o dată (`cardNeed`) și dispare când nu mai e nimic de
 * cerut. Marcajul e al lui `PushToggle`, ca cele două să arate identic.
 */
export function AndroidReminderCard() {
  const bridge = getAndroidBridge()
  const { session } = useAuth()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  const read = useCallback(async () => {
    if (!bridge) return
    try {
      const [info, status, chromeSubIds] = await Promise.all([
        bridge.getInfo(),
        bridge.status(),
        // O interogare picată (offline) nu trebuie să ascundă o permisiune
        // lipsă: abonamentele sunt ultimul pe listă, deci „necunoscut" = 0.
        readAndroidChromeSubIds().catch(() => [] as string[]),
      ])
      setSnap({ api: info.api, status, chromeSubIds })
    } catch {
      // O cutie fără `getInfo` (prea veche pentru metodă) e chiar cazul
      // „actualizează aplicația": api 0 o duce acolo.
      try { setSnap({ api: 0, status: await bridge.status(), chromeSubIds: [] }) } catch { /* puntea tace: nimic de arătat */ }
    }
  }, [bridge])

  useEffect(() => {
    void read()
    // Omul pleacă în setările telefonului și se întoarce: starea s-a schimbat
    // fără ca pagina să afle altfel.
    const onVis = () => { if (document.visibilityState === 'visible') void read() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [read])

  if (!bridge || !snap || dismissed) return null
  const need = cardNeed({ api: snap.api, status: snap.status, chromeSubs: snap.chromeSubIds.length, webSignedIn: !!session })
  if (!need) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try { await fn() } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  const askPermission = () => {
    // ÎNAINTE de `await`: Web Audio se deblochează doar din gestul omului.
    unlockChime()
    void run(async () => {
      const r = await bridge.requestNotificationPermission()
      // Ca pe web: sunetul de la activare e singura dovadă că sunetul merge.
      if (r.notifications === 'granted') playChime()
      await read()
    })
  }

  const reconnect = (e: FormEvent) => {
    e.preventDefault()
    const email = session?.user.email
    const pw = password
    const url = supabaseUrl
    const anonKey = supabaseAnonKey
    // Parola nu stă în stare mai mult decât trimiterea, oricare ar fi rezultatul.
    setPassword('')
    if (!email || !url || !anonKey) { setErr('Contul nu are e-mail sau aplicația nu e configurată.'); return }
    void run(async () => {
      await bridge.signIn({ url, anonKey, email, password: pw })
      await read()
    })
  }

  const stopChrome = () => void run(async () => {
    await deleteAndroidChromeSubs(snap.chromeSubIds)
    await read()
  })

  const denied = snap.status.notifications === 'denied'
  let title: string
  let hint: string
  let action: ReactNode = null
  switch (need) {
    case 'update-app':
      title = 'Actualizează aplicația Android'
      hint = 'Versiunea instalată e prea veche pentru această pagină.'
      break
    case 'permission':
      title = 'Activează mementourile'
      hint = denied ? 'Notificările sunt blocate din setările telefonului.' : 'Fără permisiune, alarmele nu pot suna.'
      action = denied
        ? <button className="push-cta-btn" onClick={() => void run(() => bridge.openSettings({ kind: 'notifications' }))} disabled={busy}>Setări</button>
        // Cererea pleacă din gestul omului, niciodată la pornire.
        : <button className="push-cta-btn" onClick={askPermission} disabled={busy}>{busy ? '…' : 'Activează'}</button>
      break
    case 'reconnect':
      title = 'Reconectează mementourile'
      hint = 'Aplicația nu mai are sesiune: mementourile nu se sincronizează.'
      break
    case 'chrome-subs':
      title = 'Oprește notificările din Chrome pe telefon'
      hint = 'Altfel fiecare memento sună de două ori.'
      action = <button className="push-cta-btn" onClick={stopChrome} disabled={busy}>{busy ? '…' : 'Oprește'}</button>
      break
  }

  return (
    <div className="push-cta">
      <span className="push-cta-ico"><Icon name="bell" size={20} /></span>
      <div className="push-cta-txt">
        <strong>{title}</strong>
        <span>{err ?? hint}</span>
        {need === 'reconnect' && (
          // Câmpul stă în coloana de text, nu în rândul cardului: acolo ar
          // fi împărțit lățimea cu iconița, butonul și „×" și ar fi ajuns
          // strivit pe un telefon îngust (vezi `npm run test:layout`).
          <form className="android-pass" onSubmit={reconnect}>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Parola"
              aria-label="Parola"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="push-cta-btn" disabled={busy || !password}>{busy ? '…' : 'Conectează'}</button>
          </form>
        )}
      </div>
      {action}
      <button
        className="push-cta-x"
        aria-label="Ascunde"
        onClick={() => {
          setDismissed(true)
          try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* fără stocare: ascuns doar până la remontare */ }
        }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
