import { useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { isReminderAction, isReminderArrived } from '../lib/pushPayload'
import { reminderMutation } from '../lib/reminderAction'
import { announceChime, playChime, unlockChime } from '../lib/chime'

/**
 * Mesajele service worker-ului (butoanele notificării, sunetul) și deblocarea
 * clopoțelului. Erau în `Shell`; stau aici, la rădăcina lui `App`, fiindcă au
 * UN singur executant pe filă: în panoul dublu `Shell` din documentul de sus
 * nu e montat (sunt panourile), iar panourile nu le ascultă deloc — o bifă din
 * notificare s-ar fi executat de trei ori (`App` nu randează asta în panou).
 */
export function ServiceWorkerBridge() {
  const { byId, dueIssues, toggleDone, updateIssue } = useHorizontal()
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const dueRef = useRef(dueIssues)
  dueRef.current = dueIssues

  /**
   * Butoanele notificării („Gata", „Amână"). Cu o filă deschisă, PAGINA e
   * executantul preferat: nu doar poate scrie cu drepturile userului, ci își și
   * actualizează interfața pe loc. Fără nicio filă, workerul se descurcă singur
   * cu un token semnat (vezi `resolveAction` din `src/sw.ts`) — deci ăsta nu mai
   * e singurul drum, doar cel mai bun când e disponibil.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      // Mementoul a sosit și anunțaserăm că putem cânta, deci notificarea a
      // plecat `silent` și sunetul e treaba noastră. Vezi `src/lib/chime.ts`.
      if (isReminderArrived(e.data)) { playChime(); return }
      if (!isReminderAction(e.data)) return
      const { action, id } = e.data
      const m = reminderMutation(action, byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id), new Date())
      if (m.kind === 'toggle') void toggleDone(id)
      else if (m.kind === 'patch') void updateIssue(id, m.patch)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [toggleDone, updateIssue])

  // Contextul audio se deblochează la PRIMA atingere a paginii, nu la primul
  // memento: politica de autoplay cere un gest al utilizatorului, iar mesajul
  // service worker-ului nu e un gest — `resume()` ar fi refuzat în silență, și
  // primul memento ar veni mut. `once: true`, fiindcă o dată e de ajuns.
  useEffect(() => {
    // La pornire ȘTERGEM anunțul: audio nu e deblocat încă, iar un anunț rămas
    // din sesiunea de dinaintea unui refresh ar face workerul să tacă degeaba.
    // Asta e ce ține minciuna imposibilă, nu un termen de expirare.
    void announceChime()

    const unlock = () => { unlockChime(); void announceChime() }
    // `capture: true` nu e decorativ: în faza de bubble, orice `stopPropagation`
    // dintr-un handler al aplicației ar înghiți gestul, contextul audio n-ar fi
    // deblocat niciodată, și mementourile ar veni mute pentru totdeauna. Captura
    // pe document rulează înaintea oricui ar putea opri propagarea.
    const opts = { once: true, capture: true } as const
    document.addEventListener('pointerdown', unlock, opts)
    document.addEventListener('keydown', unlock, opts)
    // Browserul poate suspenda contextul cât fila e ascunsă. La revenire se
    // reanunță starea REALĂ — altfel anunțul ar rămâne un „da" învechit.
    const onVis = () => { void announceChime() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      // `capture` trebuie repetat la scoatere, altfel nu se potrivește ascultătorul.
      document.removeEventListener('pointerdown', unlock, { capture: true })
      document.removeEventListener('keydown', unlock, { capture: true })
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return null
}
