import { useEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { repository } from '../data'
import { getDesktopBridge, upcomingReminders, type DesktopAction } from '../lib/desktopBridge'
import { ANDROID_API_WIDGETS, ANDROID_WINDOW, agendaKey, androidListKey, canTakeActions, getAndroidBridge, pageReadAt } from '../lib/androidBridge'
import { agendaItems } from '../lib/agenda'
import { parseTicketPath } from '../lib/deepLink'
import { runNativeAction } from '../lib/nativeAction'
import { supabase } from '../lib/supabase'

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
  // Recalculat la fiecare randare: o citire de rețea reușită a scadențelor pune
  // `dueRaw` din nou în store, deci randează și mută `dueFetchedAt` deodată.
  const fresh = dueLoaded && canTakeActions(repository.sync)
  const freshRef = useRef(fresh); freshRef.current = fresh
  const lastDesktop = useRef('')
  const lastAndroid = useRef('')
  const byIdRef = useRef(byId); byIdRef.current = byId
  const dueRef = useRef(dueIssues); dueRef.current = dueIssues
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  // Versiunea cutiei: metodele widget-urilor există doar de la API 2 (un apel către
  // o metodă lipsă nu e respins de Capacitor — atârnă).
  const [androidApi, setAndroidApi] = useState(0)
  useEffect(() => { if (android) void android.getInfo().then((i) => setAndroidApi(i.api), () => {}) }, [android])
  const widgets = !!android && androidApi >= ANDROID_API_WIDGETS
  const lastAgenda = useRef('')

  // Reatribuit la fiecare randare: listenerii (puși o dată) văd mereu store-ul de acum.
  const run = useRef<(a: DesktopAction) => void>(() => {})
  run.current = (a) => runNativeAction(a, {
    find: (id) => byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id),
    toggleDone, updateIssue,
    // Același drum ca un deep link, prin `popstate`-ul din App.tsx — nu un al doilea mod de a deschide un tichet.
    open: (id) => { history.pushState(null, '', `/${id}`); window.dispatchEvent(new PopStateEvent('popstate')) },
    now: () => new Date(),
    resolveId: (id) => repository.sync?.resolveId(id) ?? id,
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
        const readAt = pageReadAt(syncStatus, repository.sync, now)
        // `readAt` se mișcă doar la o citire de rețea (sau offline ↔ online), deci
        // intră în comparație: lista paginii a devenit mai proaspătă decât cea nativă.
        const json = androidListKey(list, heldIds, readAt)
        if (json !== lastAndroid.current) { lastAndroid.current = json; await android.setReminders({ list, heldIds, readAt }).catch(() => { lastAndroid.current = '' }) }
      }
      if (android && widgets) {
        const items = agendaItems(all, projects, now)
        const readAt = pageReadAt(syncStatus, repository.sync, now)
        const key = agendaKey(items, readAt)
        if (key !== lastAgenda.current) { lastAgenda.current = key; await android.setAgenda({ items, readAt }).catch(() => { lastAgenda.current = '' }) }
      }
    }
    void send().catch(() => {})
    const t = setInterval(() => void send().catch(() => {}), RESEND_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [desktop, android, widgets, dueLoaded, dueIssues, issues, projects, syncStatus])

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

  // Bătaia de inimă a laptopului: fiecare „activ" se scrie (ora e a serverului),
  // „inactiv" doar la trecere. Un eșec e tăcut: telefonul sună atunci la minut.
  useEffect(() => {
    if (!desktop?.onPresence || !supabase) return
    const db = supabase
    let last = false
    return desktop.onPresence((active) => {
      if (!active && !last) return
      last = active
      void db.rpc('touch_presence', { p_device: 'linux', p_active: active }).then(() => {}, () => {})
    })
  }, [desktop])

  // Android: acțiunile vin pe două căi. Cu aplicația vizibilă, cutia le dă
  // direct (`reminderAction`) — doar cât pagina ascultă; altfel le pune în coada
  // ei, iar pagina le PREIA la deschidere. O acțiune preluată nu mai pleacă din
  // cutie, deci nu se execută de două ori (o bifă dublă pe o recurentă ar sări de două ori).
  useEffect(() => {
    // Abia după încărcare: `open` (atingerea pe notificare, reținută de cutie)
    // are nevoie de store ca să găsească tichetul.
    if (!android || !dueLoaded) return
    const subs = [
      android.addListener('reminderAction', (a) => run.current(a)),
      // Cutia a scris ceva pe server (coada ei, sincronizarea): datele paginii sunt vechi.
      android.addListener('changed', () => { void refreshRef.current() }),
    ]
    return () => { for (const s of subs) void s.then((l) => l.remove()).catch(() => {}) }
  }, [android, dueLoaded])

  // Ce s-a deschis din widget. Când omul iese de acolo (Back, X, trimite), istoricul
  // face un `popstate` pe un ecran care nu mai e tichet sau foaie: atunci cutia se
  // duce în fundal, ca Back să ducă pe ecranul de start, nu pe ecranul de sub foaie.
  const fromWidget = useRef(false)
  useEffect(() => {
    if (!android || !widgets || !dueLoaded) return
    const sub = android.addListener('widget', (e) => {
      if (e.kind === 'open') {
        run.current({ action: 'open', id: e.id })
      } else {
        window.dispatchEvent(new Event('hz:widget-quick'))
        void android.showKeyboard().catch(() => {})
      }
      fromWidget.current = true
    })
    const onPop = () => {
      if (!fromWidget.current) return
      const st = history.state as { hzSheet?: unknown } | null
      if (parseTicketPath(location.pathname) || st?.hzSheet) return
      fromWidget.current = false
      void android.leave().catch(() => {})
    }
    const onVis = () => { if (document.visibilityState === 'hidden') fromWidget.current = false }
    window.addEventListener('popstate', onPop)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      void sub.then((l) => l.remove()).catch(() => {})
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [android, widgets, dueLoaded])

  useEffect(() => {
    // Preluarea abia după prima citire de REȚEA a scadențelor, nu pe cadrul din
    // cache: garda recurenței din `runNativeAction` compară cu scadența din store,
    // iar una veche ar arunca un „Gata" bun. Nepreluate, le trimite cutia singură.
    if (!android || !fresh) return
    let alive = true
    const take = async () => {
      const { actions } = await android.takeActions()
      // Preluată înseamnă scoasă din cutie: se execută chiar dacă efectul s-a
      // reîncheiat între timp (`run` e mereu cel de acum).
      for (const a of actions) run.current(a)
    }
    void take().catch(() => {})
    const onVis = () => { if (alive && freshRef.current && document.visibilityState === 'visible') void take().catch(() => {}) }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis) }
  }, [android, fresh])

  return null
}
