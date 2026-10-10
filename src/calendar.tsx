// Starea calendarului Google în pagină: conturile, calendarele și evenimentele
// din fereastră. Un context separat de `store.tsx`, fiindcă nu e o entitate a
// aplicației — e o oglindă doar-de-citit (vezi `src/data/calendar.ts`).
//
// Reîmprospătarea merge pe urmele store-ului: de câte ori store-ul pornește un
// `refresh()` (revenire în tab peste pragul de 30 s, butonul din header,
// tragerea în jos, reconectarea), calendarul cere și el o rundă. Așa pragul
// rămâne într-un singur loc (`refreshGate.ts`), iar serverul mai pune unul,
// de un minut, pe sincronizarea cu Google.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHorizontal } from './store'
import { useUI } from './ui'
import {
  cachedCalendar, calendarAvailable, connectErrorText, listCalendarAccounts, listCalendarEvents, syncCalendars,
} from './data/calendar'
import { enabledCalendars, type CalendarAccount, type CalendarEvent, type CalendarInfo } from './lib/calendarEvents'

interface CalendarState {
  /** Există integrarea (Supabase)? În modul local secțiunea nu apare. */
  available: boolean
  accounts: CalendarAccount[]
  events: CalendarEvent[]
  /** Calendarele pornite, după id — ce se vede în liste. */
  calendars: Map<string, CalendarInfo>
  loaded: boolean
  /** Recitește din bază (și, cu `sync`, cere întâi o rundă la Google). */
  reload(opts?: { sync?: boolean; force?: boolean }): Promise<void>
  /** Comută local, înainte de răspunsul serverului — comutatorul nu așteaptă rețeaua. */
  patchCalendar(id: string, enabled: boolean): void
}

const Ctx = createContext<CalendarState | null>(null)

/**
 * Parametrii cu care se întoarce omul de la Google (`?calendar=…`) sau atinge o
 * notificare de eveniment (`?event=…`). Citiți O DATĂ, la încărcarea
 * modulului — înainte ca efectele din App să rescrie URL-ul (`settleUrl`).
 */
const initial = (() => {
  if (typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search)
  const calendar = q.get('calendar')
  const event = q.get('event')
  if (!calendar && !event) return null
  return { calendar, reason: q.get('reason'), email: q.get('email'), event }
})()

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { refreshing } = useHorizontal()
  const [accounts, setAccounts] = useState<CalendarAccount[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const running = useRef<Promise<void> | null>(null)

  const readAll = useCallback(async () => {
    const [a, e] = await Promise.all([listCalendarAccounts(), listCalendarEvents()])
    setAccounts(a)
    setEvents(e)
    setLoaded(true)
  }, [])

  const reload = useCallback(async (opts: { sync?: boolean; force?: boolean } = {}) => {
    if (!calendarAvailable) return
    // Una singură odată: două reveniri în tab apropiate nu fac două runde.
    if (running.current) return running.current
    const run = (async () => {
      try {
        await readAll()
        if (opts.sync) {
          await syncCalendars(opts.force)
          await readAll()
        }
      } catch (e) {
        // Tăcut: calendarul e o secțiune a listelor, nu o condiție a lor. O
        // tabelă lipsă (migrarea nerulată) sau o rețea căzută nu au voie să
        // pună un banner peste „Azi".
        console.warn('calendarul nu s-a putut reîmprospăta', e)
        setLoaded(true)
      } finally {
        running.current = null
      }
    })()
    running.current = run
    return run
  }, [readAll])

  // Pornirea: cache-ul întâi (primul cadru fără rețea), apoi rețeaua + o rundă la Google.
  useEffect(() => {
    if (!calendarAvailable) return
    let alive = true
    void cachedCalendar().then((c) => {
      if (!alive || !c) return
      setAccounts((cur) => (cur.length ? cur : c.accounts))
      setEvents((cur) => (cur.length ? cur : c.events))
      setLoaded(true)
    })
    void reload({ sync: true })
    return () => { alive = false }
  }, [reload])

  // Pe urmele store-ului: fiecare `refresh()` al lui e și unul al calendarului.
  const wasRefreshing = useRef(refreshing)
  useEffect(() => {
    if (refreshing && !wasRefreshing.current) void reload({ sync: true })
    wasRefreshing.current = refreshing
  }, [refreshing, reload])

  const patchCalendar = useCallback((id: string, enabled: boolean) => {
    setAccounts((cur) => cur.map((a) => ({ ...a, calendars: a.calendars.map((c) => (c.id === id ? { ...c, enabled } : c)) })))
  }, [])

  const calendars = useMemo(() => enabledCalendars(accounts), [accounts])

  const value = useMemo<CalendarState>(
    () => ({ available: calendarAvailable, accounts, events, calendars, loaded, reload, patchCalendar }),
    [accounts, events, calendars, loaded, reload, patchCalendar],
  )
  return <Ctx.Provider value={value}>{children}<CalendarLanding /></Ctx.Provider>
}

export function useCalendar(): CalendarState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCalendar must be used within CalendarProvider')
  return ctx
}

/**
 * Ce face aplicația când omul aterizează din afară: întors de la Google
 * (toast + Setări deschise, ca să-și vadă calendarele), dintr-o notificare de
 * eveniment (foaia evenimentului), sau dintr-o notificare a cutiei de Linux
 * (`hz:open-event`, trimis de NativeBridge).
 */
function CalendarLanding() {
  const { showToast, openAppSettings, openEvent } = useUI()
  const { events, loaded, reload } = useCalendar()
  const handled = useRef(false)
  const wantEvent = useRef<string | null>(initial?.event ?? null)

  useEffect(() => {
    if (handled.current || !initial) return
    handled.current = true
    // Parametrii pleacă din bară: un refresh n-are voie să repete toastul.
    const url = new URL(location.href)
    for (const k of ['calendar', 'reason', 'email', 'event']) url.searchParams.delete(k)
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    if (initial.calendar === 'connected') {
      showToast(initial.email ? `Calendar conectat: ${initial.email}` : 'Calendar conectat')
      openAppSettings()
      void reload({ sync: false })
    } else if (initial.calendar === 'error') {
      showToast(connectErrorText(initial.reason))
      openAppSettings()
    }
  }, [showToast, openAppSettings, reload])

  // Foaia evenimentului se deschide abia când evenimentul e în listă — la o
  // pornire rece din notificare, citirea vine după primul cadru.
  useEffect(() => {
    const id = wantEvent.current
    if (!id || !loaded) return
    if (events.some((e) => e.id === id)) { wantEvent.current = null; openEvent(id) }
  }, [events, loaded, openEvent])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id) { wantEvent.current = id; if (events.some((x) => x.id === id)) { wantEvent.current = null; openEvent(id) } }
    }
    window.addEventListener('hz:open-event', onOpen)
    return () => window.removeEventListener('hz:open-event', onOpen)
  }, [events, openEvent])

  return null
}
