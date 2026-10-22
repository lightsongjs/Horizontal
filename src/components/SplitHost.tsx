// Gazda panoului dublu: documentul de sus, cu bara laterală comună și două
// `<iframe src="/?pane=L|R">` — fiecare e aplicația întreagă, complet separată.
// Spec: docs/superpowers/specs/2026-10-22-split-pane-design.md.
//
// Ce face gazda și numai ea:
// - bara laterală (cu store-ul gazdei, pentru numere) conduce panoul cu focus;
// - linia accent de 2px pe panoul cu focus; Ctrl+Shift+[ / ] îl schimbă;
// - Back-ul browserului: o intrare-santinelă în istoricul de sus, pusă la loc
//   după fiecare Back, iar Back-ul pleacă la panoul cu focus;
// - URL-ul de sus = ruta panoului cu focus;
// - ✕: panoul se închide după garda lui; celălalt NU se reîncarcă — iframe-ul
//   lui se lărgește și rămâne aplicația până la următoarea reîncărcare, care
//   pornește un singur panou normal, din ruta lui (decizia omului, 2026-10-22).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { Sidebar } from './Sidebar'
import { appHistory } from '../lib/historyPort'
import { forgetPane, readPaneView, seedPane, type PaneId } from '../lib/pane'
import { isPaneToHost, paneSwitchTarget, sidebarMarks, type HostToPane, type NavAction, type PaneRoute } from '../lib/paneProtocol'
import { clearSplit, deepLinkForPane, isSentinel, otherPane, saveSplit, seedFor, sentinelState, type SplitState } from '../lib/splitState'
import { parseTicketPath } from '../lib/deepLink'

const LAST_VIEW = 'horizontal:last-view'
const LAST_PROJECT = 'horizontal:last-project'

const depthOf = (state: unknown) => (state as { hzDepth?: number } | null)?.hzDepth ?? 0

function navType(): string {
  try {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return e?.type ?? 'navigate'
  } catch { return 'navigate' }
}

/** Ce scrie gazda în `localStorage` ca o reîncărcare să pornească aplicația normală din ruta panoului rămas. */
function adoptView(id: PaneId) {
  const v = readPaneView(id)
  try {
    if (v.lastView) localStorage.setItem(LAST_VIEW, v.lastView)
    else localStorage.removeItem(LAST_VIEW)
    if (v.lastProject) localStorage.setItem(LAST_PROJECT, v.lastProject)
    else localStorage.removeItem(LAST_PROJECT)
  } catch { /* stocare blocată */ }
}

/** `boot`: pornită la încărcarea paginii (reîncărcare / navigare), nu dintr-un clic acum. */
export function SplitHost({ initial, boot }: { initial: SplitState; boot: boolean }) {
  const { inbox } = useHorizontal()
  const [panes, setPanes] = useState<PaneId[]>(() => [...initial.panes])
  const [focus, setFocus] = useState<PaneId>(initial.focus)
  const [routes, setRoutes] = useState<Partial<Record<PaneId, PaneRoute>>>({})
  const frames = useRef<Partial<Record<PaneId, HTMLIFrameElement | null>>>({})
  const ready = useRef<Partial<Record<PaneId, boolean>>>({})
  const pendingPath = useRef<string | null>(null)
  const panesRef = useRef(panes)
  panesRef.current = panes
  const focusRef = useRef(focus)
  focusRef.current = focus
  const routesRef = useRef(routes)
  routesRef.current = routes

  const send = useCallback((id: PaneId, m: HostToPane) => {
    frames.current[id]?.contentWindow?.postMessage(m, window.location.origin)
  }, [])

  /** Tastatura în panou: focusul cadrului, apoi panoul își readuce ultimul element. */
  const giveFocus = useCallback((id: PaneId) => {
    frames.current[id]?.contentWindow?.focus()
    send(id, { hz: 'host', kind: 'focus' })
  }, [send])

  // Starea de reîncărcat: numai cât sunt DOUĂ panouri.
  useEffect(() => {
    if (panes.length === 2) saveSplit({ panes: [panes[0], panes[1]], focus })
    else clearSplit()
  }, [panes, focus])

  // Santinela: la montare (pornire sau reîncărcare peste ea, ori o navigare
  // care a pus altă intrare), plus deep linkul unei navigări.
  useEffect(() => {
    if (!isSentinel(appHistory.state)) {
      // Un tichet în calea unei NAVIGĂRI (clic pe notificare) se deschide în
      // panoul cu focus; la pornirea dintr-un clic, calea e a tichetului care
      // tocmai a trecut în stânga — deja acolo.
      if (boot) pendingPath.current = deepLinkForPane(navType(), appHistory.pathname, (p) => parseTicketPath(p) !== null)
      appHistory.pushState(sentinelState(depthOf(appHistory.state) + 1), appHistory.pathname)
    }
    // Back-ul browserului a părăsit santinela: o punem la loc și îl dăm
    // panoului cu focus. Pe rădăcina panoului `back()` nu face nimic.
    return appHistory.onPop(() => {
      if (isSentinel(appHistory.state)) return
      const r = routesRef.current[focusRef.current]
      appHistory.pushState({ ...(r?.state as object | null ?? {}), ...sentinelState(depthOf(appHistory.state) + 1) }, r?.path ?? appHistory.pathname)
      send(focusRef.current, { hz: 'host', kind: 'back' })
    })
  }, [send]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL-ul de sus = ruta panoului cu focus (fără intrare nouă).
  const focusedRoute = routes[focus] ?? null
  useEffect(() => {
    if (!focusedRoute || !isSentinel(appHistory.state)) return
    appHistory.replaceState({ ...(focusedRoute.state as object | null ?? {}), ...sentinelState(depthOf(appHistory.state)) }, focusedRoute.path)
    // Un singur panou rămas e aplicația: o reîncărcare trebuie să pornească de aici.
    if (panes.length === 1) adoptView(focus)
  }, [focusedRoute, focus, panes.length])

  // Fiecare panou află ce are celălalt deschis, dacă mai e split și dacă are focusul.
  useEffect(() => {
    for (const id of panes) {
      const o = panes.find((x) => x !== id)
      send(id, { hz: 'host', kind: 'peer', otherTicketId: o ? routes[o]?.ticketId ?? null : null, split: panes.length === 2, focused: id === focus })
    }
  }, [panes, focus, routes, send])

  const close = useCallback((id: PaneId) => {
    const rest = panesRef.current.filter((x) => x !== id)
    if (rest.length === 0) return
    forgetPane(id)
    delete frames.current[id]
    delete ready.current[id]
    setRoutes((r) => { const n = { ...r }; delete n[id]; return n })
    setPanes(rest)
    setFocus(rest[0])
    adoptView(rest[0])
    giveFocus(rest[0])
  }, [giveFocus])

  const switchTo = useCallback((side: 'L' | 'R') => {
    const ps = panesRef.current
    if (ps.length < 2) return
    const id = side === 'L' ? ps[0] : ps[1]
    setFocus(id)
    giveFocus(id)
  }, [giveFocus])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const id = (Object.keys(frames.current) as PaneId[]).find((k) => frames.current[k]?.contentWindow === e.source)
      if (!id || !isPaneToHost(e.data)) return
      const m = e.data
      if (m.kind === 'ready') {
        ready.current[id] = true
        if (pendingPath.current && id === focusRef.current) {
          send(id, { hz: 'host', kind: 'open-path', path: pendingPath.current })
          pendingPath.current = null
        }
        if (id === focusRef.current) giveFocus(id)
      } else if (m.kind === 'focus') { if (focusRef.current !== id) setFocus(id) }
      // Un focus pus din cod (titlul unui formular la pornire) a tras tastatura
      // în panoul fără focus: o dăm înapoi celui activ.
      else if (m.kind === 'yield') { if (focusRef.current !== id) giveFocus(focusRef.current) }
      else if (m.kind === 'route') setRoutes((r) => ({ ...r, [id]: m.route }))
      else if (m.kind === 'switch') switchTo(m.to)
      else if (m.kind === 'close') close(id)
    }
    // Tastele cât focusul e în bara laterală (documentul de sus).
    const onKey = (e: KeyboardEvent) => {
      const to = paneSwitchTarget(e)
      if (!to) return
      e.preventDefault()
      e.stopImmediatePropagation()
      switchTo(to)
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [send, giveFocus, switchTo, close])

  const nav = useCallback((a: NavAction) => {
    const id = focusRef.current
    send(id, { hz: 'host', kind: 'nav', action: a })
    giveFocus(id)
  }, [send, giveFocus])

  const toggle = useCallback(() => {
    const ps = panesRef.current
    if (ps.length === 2) {
      // „Un singur panou": se închide cel fără focus, prin garda lui.
      send(ps.find((x) => x !== focusRef.current)!, { hz: 'host', kind: 'close-request' })
      return
    }
    // Al doilea panou, lângă cel rămas: același ecran, fără tichet.
    const keep = ps[0]
    const add = otherPane(keep)
    const r = routesRef.current[keep]
    const v = readPaneView(keep)
    const screen = r?.screen && r.screen !== 'users' ? r.screen : null
    seedPane(add, seedFor({ screen: screen ?? (v.lastProject ? null : 'today'), projectSlug: v.lastProject, ticketId: null }, false))
    setPanes([keep, add])
  }, [send])

  const marks = useMemo(() => {
    const other = panes.find((x) => x !== focus)
    return sidebarMarks(routes[focus] ?? null, other ? routes[other] ?? null : null)
  }, [panes, focus, routes])
  const screen = marks.screen
  const filterId = screen?.startsWith('filter:') ? screen.slice(7) : null
  const smartList = screen === 'today' || screen === 'week' ? screen : null
  const focusIx = panes.length === 2 ? (panes.indexOf(focus) as 0 | 1) : null

  return (
    <div id="app" className="split-host">
      <Sidebar
        showUsers={screen === 'users'}
        smartList={smartList}
        onSmartList={(kind) => nav({ type: 'screen', screen: kind })}
        inboxActive={screen === 'inbox'}
        inboxUnread={inbox.fresh.length}
        inboxTotal={inbox.fresh.length + inbox.rest.length}
        onInbox={() => nav({ type: 'screen', screen: 'inbox' })}
        filterId={filterId}
        onFilter={(id) => nav({ type: 'screen', screen: `filter:${id}` })}
        onFilterForm={(id) => nav({ type: 'filter-form', id })}
        onSearch={() => nav({ type: 'search' })}
        split={{ marks, focusIx, onNav: nav, onToggle: toggle }}
      />
      <div className="split-panes">
        {panes.map((id) => (
          <div key={id} className={`split-pane-frame${panes.length === 2 && id === focus ? ' focus' : ''}`} data-pane={id}>
            <iframe
              ref={(el) => { frames.current[id] = el }}
              src={`/?pane=${id}`}
              title={id === panes[0] ? 'Panoul din stânga' : 'Panoul din dreapta'}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
