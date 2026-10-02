import { useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { getDesktopBridge, upcomingReminders } from '../lib/desktopBridge'
import { reminderMutation } from '../lib/reminderAction'

/** Cât de des se retrimite lista chiar fără nicio schimbare: fereastra de 24 h alunecă. */
const RESEND_MS = 15 * 60_000

/**
 * Puntea către aplicația de Linux. Fără `window.horizontalDesktop` (browser,
 * telefon) nu face nimic. Pagina e cea care ȘTIE ce urmează (store + cache
 * offline); cutia e cea care SUNĂ — timerele din pagină ar fi sugrumate de
 * Chromium cât fereastra stă ascunsă, de-aia stau în procesul principal.
 */
export function DesktopBridge() {
  const { dueIssues, issues, projects, byId, toggleDone, updateIssue } = useHorizontal()
  const bridge = getDesktopBridge()
  const lastSent = useRef('')
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const dueRef = useRef(dueIssues)
  dueRef.current = dueIssues

  useEffect(() => {
    if (!bridge) return
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
  }, [bridge, dueIssues, issues, projects])

  useEffect(() => {
    if (!bridge) return
    return bridge.onReminderAction(({ action, id }) => {
      // Click pe corpul notificării: același drum ca un deep link, prin
      // `popstate`-ul din App.tsx — nu un al doilea mod de a deschide un tichet.
      if (action === 'open') {
        history.pushState(null, '', `/${id}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
        return
      }
      const issue = byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id)
      const m = reminderMutation(action, issue, new Date())
      if (m.kind === 'toggle') void toggleDone(id)
      else if (m.kind === 'patch') void updateIssue(id, m.patch)
    })
  }, [bridge, toggleDone, updateIssue])

  return null
}
