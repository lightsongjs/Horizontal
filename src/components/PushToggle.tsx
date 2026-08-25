import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushHint, readPushState, type PushState } from '../lib/push'
import { errorMessage } from '../lib/errorMessage'
import { announceChime, playChime, unlockChime } from '../lib/chime'

/**
 * Comutatorul de notificări. Trăiește în capul listei „Azi" fiindcă acolo e
 * momentul în care întrebarea are sens: ai sarcini cu oră, deci vrei să suni.
 *
 * Se ascunde singur când e pornit — un comutator permanent pentru ceva ce se
 * setează o dată e zgomot. Reapare doar dacă starea se schimbă.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Ascunsă manual în sesiunea asta: cineva care nu vrea notificări nu trebuie
  // să fie întrebat la fiecare deschidere a listei.
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('horizontal:push-dismissed') === '1',
  )

  useEffect(() => { void readPushState().then(setState) }, [])

  // Nimic de arătat: încă nu știm, e deja pornit, sau nu se poate oricum.
  if (state === null || state === 'on' || state === 'unsupported' || state === 'no-account') return null
  if (dismissed) return null

  const act = async () => {
    setBusy(true)
    setErr(null)
    // ÎNAINTE de `await`: deblocarea audio are nevoie de gestul utilizatorului,
    // iar după prima așteptare browserul nu mai consideră că suntem în el.
    const enabling = state === 'off'
    if (enabling) unlockChime()
    try {
      const next = enabling ? await enablePush() : await disablePush()
      setState(next)
      // Sunetul se aude O DATĂ, aici, la activare. Nu e o floare: e singurul
      // moment în care userul află cum sună mementoul ȘI în care se confirmă că
      // sunetul funcționează deloc. Altfel prima dovadă ar veni la prima
      // scadență — iar dacă ar fi mută, n-ar avea de unde să știe că e mută.
      if (next === 'on') { playChime(); void announceChime() }
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="push-cta">
      <span className="push-cta-ico" aria-hidden="true">◔</span>
      <div className="push-cta-txt">
        <strong>Activează mementourile</strong>
        <span>{err ?? pushHint(state)}</span>
      </div>
      {state !== 'denied' && (
        // Butonul e singurul declanșator: `Notification.requestPermission()`
        // trebuie chemat din gestul userului, altfel pe iOS eșuează.
        <button className="push-cta-btn" onClick={() => void act()} disabled={busy}>
          {busy ? '…' : 'Activează'}
        </button>
      )}
      <button
        className="push-cta-x"
        aria-label="Ascunde"
        onClick={() => { setDismissed(true); sessionStorage.setItem('horizontal:push-dismissed', '1') }}
      >
        ✕
      </button>
    </div>
  )
}
