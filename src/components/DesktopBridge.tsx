import { useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { getDesktopBridge, upcomingReminders } from '../lib/desktopBridge'
import { reminderMutation } from '../lib/reminderAction'

/** Cât de des se retrimite lista chiar fără nicio schimbare: fereastra de 24 h alunecă. */
const RESEND_MS = 15 * 60_000
/**
 * Cât de des își aduce fereastra ascunsă datele din nou. Singurul refresh al
 * store-ului e la `visibilitychange`, iar aici fereastra nu devine vizibilă
 * zile întregi: fără asta, un memento creat pe telefon nu sună niciodată, iar
 * unul bifat acolo sună oricum.
 */
const REFRESH_MS = 5 * 60_000

/**
 * Puntea către aplicația de Linux. Fără `window.horizontalDesktop` (browser,
 * telefon) nu face nimic. Pagina e cea care ȘTIE ce urmează (store + cache
 * offline); cutia e cea care SUNĂ — timerele din pagină ar fi sugrumate de
 * Chromium cât fereastra stă ascunsă, de-aia stau în procesul principal.
 */
export function DesktopBridge() {
  const { dueLoaded, dueIssues, issues, projects, byId, refresh, toggleDone, updateIssue } = useHorizontal()
  const bridge = getDesktopBridge()
  const lastSent = useRef('')
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const dueRef = useRef(dueIssues)
  dueRef.current = dueIssues

  useEffect(() => {
    // Până nu s-au încărcat scadențele, lista ar fi goală — iar cutia retrage
    // orice notificare a cărei cheie lipsește din listă. După o reîncărcare a
    // ferestrei, un `[]` trimis prea devreme ar închide notificările de pe
    // ecran, iar ele ar rămâne în `fired` și n-ar mai reveni.
    if (!bridge || !dueLoaded) return
    const send = () => {
      const list = upcomingReminders([...dueIssues, ...issues], projects, new Date())
      const json = JSON.stringify(list)
      if (json === lastSent.current) return
      lastSent.current = json
      bridge.setReminders(list)
    }
    send()
    const t = setInterval(send, RESEND_MS)
    return () => clearInterval(t)
  }, [bridge, dueLoaded, dueIssues, issues, projects])

  // `refresh` ridică `refreshing`, nu `loading`: ecranul nu se golește. Calea
  // explicită nu trece prin pragul de 30 s. Lista se retrimite singură: efectul
  // de mai sus rulează din nou când store-ul se schimbă.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!bridge) return
    const t = setInterval(() => { void refreshRef.current() }, REFRESH_MS)
    const off = bridge.onResync?.(() => { void refreshRef.current() })
    return () => { clearInterval(t); off?.() }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    return bridge.onReminderAction(({ action, id, minutes }) => {
      // Click pe corpul notificării: același drum ca un deep link, prin
      // `popstate`-ul din App.tsx — nu un al doilea mod de a deschide un tichet.
      if (action === 'open') {
        history.pushState(null, '', `/${id}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
        return
      }
      const issue = byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id)
      const m = reminderMutation(action, issue, new Date(), minutes)
      if (m.kind === 'toggle') void toggleDone(id)
      else if (m.kind === 'patch') void updateIssue(id, m.patch)
    })
  }, [bridge, toggleDone, updateIssue])

  return null
}
