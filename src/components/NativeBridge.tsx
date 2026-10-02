import { useEffect, useMemo, useRef } from 'react'
import { useHorizontal } from '../store'
import { repository } from '../data'
import { getDesktopBridge, upcomingReminders, type DesktopAction } from '../lib/desktopBridge'
import { ANDROID_WINDOW, getAndroidBridge, pageReadAt } from '../lib/androidBridge'
import { runNativeAction } from '../lib/nativeAction'

/** Cât de des se retrimite lista chiar fără nicio schimbare: fereastra alunecă. */
const RESEND_MS = 15 * 60_000
/**
 * Doar pe Linux: singurul refresh al store-ului e la `visibilitychange`, iar
 * fereastra ascunsă nu devine vizibilă zile întregi. Fără asta, un memento creat
 * pe telefon nu sună niciodată, iar unul bifat acolo sună oricum.
 */
const REFRESH_MS = 5 * 60_000

/**
 * Puntea către cutiile native: Linux (`window.horizontalDesktop`) și Android
 * (`window.Capacitor` → pluginul `HorizontalAndroid`). Fără niciuna (browser)
 * nu face nimic. Pagina ȘTIE ce urmează (store + cache offline); cutia SUNĂ —
 * timerele din pagină ar fi sugrumate cât fereastra stă ascunsă.
 */
export function NativeBridge() {
  const { dueLoaded, dueIssues, issues, projects, byId, refresh, toggleDone, updateIssue, syncStatus } = useHorizontal()
  // O dată pe montare: obiectele intră în dependențele efectelor de mai jos.
  const desktop = useMemo(() => getDesktopBridge(), [])
  const android = useMemo(() => getAndroidBridge(), [])
  const loadedRef = useRef(dueLoaded); loadedRef.current = dueLoaded
  const lastDesktop = useRef('')
  const lastAndroid = useRef('')
  const byIdRef = useRef(byId); byIdRef.current = byId
  const dueRef = useRef(dueIssues); dueRef.current = dueIssues
  const refreshRef = useRef(refresh); refreshRef.current = refresh

  // Reatribuit la fiecare randare: listenerii (puși o dată) văd mereu store-ul de acum.
  const run = useRef<(a: DesktopAction) => void>(() => {})
  run.current = (a) => runNativeAction(a, {
    find: (id) => byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id),
    toggleDone, updateIssue,
    // Același drum ca un deep link, prin `popstate`-ul din App.tsx — nu un al doilea mod de a deschide un tichet.
    open: (id) => { history.pushState(null, '', `/${id}`); window.dispatchEvent(new PopStateEvent('popstate')) },
    now: () => new Date(),
  })

  useEffect(() => {
    // Până nu s-au încărcat scadențele, lista ar fi goală — iar cutia retrage
    // orice notificare a cărei cheie lipsește. Un `[]` timpuriu ar închide
    // notificările de pe ecran, iar ele ar rămâne în `fired` și n-ar mai reveni.
    if ((!desktop && !android) || !dueLoaded) return
    // Rulări suprapuse (heldIds e asincron): una mai veche nu are voie să
    // trimită după una mai nouă o listă depășită.
    let cancelled = false
    const send = async () => {
      const now = new Date()
      const all = [...dueIssues, ...issues]
      if (desktop) {
        const list = upcomingReminders(all, projects, now)
        const json = JSON.stringify(list)
        if (json !== lastDesktop.current) { lastDesktop.current = json; desktop.setReminders(list) }
      }
      if (android) {
        const list = upcomingReminders(all, projects, now, ANDROID_WINDOW)
        const heldIds = (await repository.sync?.heldIds()) ?? []
        if (cancelled) return
        const readAt = pageReadAt(syncStatus, now)
        // `readAt` nu intră în comparație (s-ar schimba la fiecare minut), dar
        // trecerea offline → online da: atunci lista paginii redevine proaspătă.
        const json = JSON.stringify([list, heldIds, readAt === 0])
        if (json !== lastAndroid.current) { lastAndroid.current = json; await android.setReminders({ list, heldIds, readAt }).catch(() => { lastAndroid.current = '' }) }
      }
    }
    void send().catch(() => {})
    const t = setInterval(() => void send().catch(() => {}), RESEND_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [desktop, android, dueLoaded, dueIssues, issues, projects, syncStatus])

  // Linux: `refresh` ridică `refreshing`, nu `loading`, deci ecranul nu se
  // golește; calea explicită nu trece prin pragul de 30 s.
  useEffect(() => {
    if (!desktop) return
    const t = setInterval(() => { void refreshRef.current() }, REFRESH_MS)
    const off = desktop.onResync?.(() => { void refreshRef.current() })
    return () => { clearInterval(t); off?.() }
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    return desktop.onReminderAction((a) => run.current(a))
  }, [desktop])

  // Android: acțiunile vin pe două căi. Cu aplicația vizibilă, cutia le dă
  // direct (`reminderAction`). Altfel le pune în coada ei, iar pagina le
  // PREIA la deschidere — o acțiune preluată nu mai pleacă din cutie, deci
  // nu se execută de două ori (o bifă dublă pe o sarcină recurentă ar sări de două ori).
  useEffect(() => {
    // Abia după încărcare: o acțiune preluată înainte ca store-ul să aibă
    // datele n-ar mai avea de unde să fie rezolvată, iar cutia a scos-o deja.
    if (!android || !dueLoaded) return
    let alive = true
    const take = async () => {
      const { actions } = await android.takeActions()
      // Preluată înseamnă scoasă din cutie: se execută chiar dacă efectul s-a
      // reîncheiat între timp (`run` e mereu cel de acum).
      for (const a of actions) run.current(a)
    }
    void take().catch(() => {})
    const onVis = () => { if (alive && loadedRef.current && document.visibilityState === 'visible') void take().catch(() => {}) }
    document.addEventListener('visibilitychange', onVis)
    const subs = [
      android.addListener('reminderAction', (a) => run.current(a)),
      // Cutia a scris ceva pe server (coada ei, sincronizarea): datele paginii sunt vechi.
      android.addListener('changed', () => { void refreshRef.current() }),
    ]
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      for (const s of subs) void s.then((l) => l.remove()).catch(() => {})
    }
  }, [android, dueLoaded])

  return null
}
