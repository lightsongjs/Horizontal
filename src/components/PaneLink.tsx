// Partea de PANOU a panoului dublu: ce spune panoul gazdei și ce face la ce
// îi cere ea. Montat numai într-un panou (`isPane()`), din `Shell`.
// Spec: docs/superpowers/specs/2026-10-22-split-pane-design.md.

import { useEffect, useRef, useState } from 'react'
import { appHistory } from '../lib/historyPort'
import { isHostToPane, paneSwitchTarget, type NavAction, type PaneRoute, type PaneToHost } from '../lib/paneProtocol'
import { Icon } from './Icon'

const post = (m: PaneToHost) => {
  if (window.parent !== window) window.parent.postMessage(m, window.location.origin)
}

export interface PanePeer { otherTicketId: string | null; split: boolean; focused: boolean }

/**
 * Leagă panoul de gazdă. `route` se trimite la fiecare schimbare (bara
 * laterală, URL-ul de sus); `onNav` execută un clic din bara laterală a gazdei
 * ca pe unul propriu; `tryClose` aplică garda de modificări nesalvate a
 * panoului (aceeași ca la închiderea unui tichet) și spune dacă se poate
 * închide.
 */
export function usePaneLink(enabled: boolean, route: PaneRoute, onNav: (a: NavAction) => void, tryClose: () => boolean): PanePeer {
  const [peer, setPeer] = useState<PanePeer>({ otherTicketId: null, split: true, focused: false })
  const onNavRef = useRef(onNav)
  onNavRef.current = onNav
  const tryCloseRef = useRef(tryClose)
  tryCloseRef.current = tryClose
  const peerRef = useRef(peer)
  peerRef.current = peer

  // Ruta: o dată pe schimbare, nu pe randare.
  const sent = useRef('')
  useEffect(() => {
    if (!enabled) return
    const s = JSON.stringify(route)
    if (s === sent.current) return
    sent.current = s
    post({ hz: 'pane', kind: 'route', route })
  })

  useEffect(() => {
    if (!enabled) return
    post({ hz: 'pane', kind: 'ready' })
    // Ultimul element cu focus: Ctrl+Shift+[ ] și un clic în bara laterală
    // a gazdei întorc tastatura exact acolo, nu pe <body>.
    let last: HTMLElement | null = null
    // Ultimul gest al omului ÎN panou: un focus fără gest e pus din cod.
    let gestureAt = 0
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) last = e.target
      if (Date.now() - gestureAt < 1000) post({ hz: 'pane', kind: 'focus' })
      // Un `focus()` din cod (titlul formularului la pornire) mută tastatura
      // în cadrul lui chiar dacă nu e panoul activ — Chromium o face. Nu e o
      // alegere a omului: gazda o dă înapoi panoului activ.
      else if (!peerRef.current.focused) post({ hz: 'pane', kind: 'yield' })
    }
    const onPointer = () => { gestureAt = Date.now(); post({ hz: 'pane', kind: 'focus' }) }
    const onKeyGesture = () => { gestureAt = Date.now() }
    // În CAPTURĂ pe window: înaintea câmpurilor, a CodeMirror și a dispecerului
    // Vim — trebuie să meargă și dintr-un câmp de text.
    const onKey = (e: KeyboardEvent) => {
      const to = paneSwitchTarget(e)
      if (!to) return
      e.preventDefault()
      e.stopImmediatePropagation()
      // Poziția (stânga/dreapta), nu id-ul: gazda știe ce panou stă unde.
      post({ hz: 'pane', kind: 'switch', to })
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return
      const m = e.data
      if (!isHostToPane(m)) return
      if (m.kind === 'nav') onNavRef.current(m.action)
      else if (m.kind === 'back') appHistory.back()
      else if (m.kind === 'focus') {
        window.focus()
        const el = last && last.isConnected ? last : null
        if (el) el.focus({ preventScroll: true })
        else (document.querySelector<HTMLElement>('main') ?? document.body).focus?.({ preventScroll: true })
      } else if (m.kind === 'open-path') {
        // Același drum ca un deep link din notificare (`NativeBridge`).
        appHistory.pushState(null, m.path)
        appHistory.dispatchPop()
      } else if (m.kind === 'close-request') {
        if (tryCloseRef.current()) post({ hz: 'pane', kind: 'close' })
      } else if (m.kind === 'peer') setPeer({ otherTicketId: m.otherTicketId, split: m.split, focused: m.focused })
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKeyGesture, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('message', onMessage)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKeyGesture, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('message', onMessage)
    }
  }, [enabled])

  return peer
}

/**
 * Bara de sus a panoului (macheta `design/dual-pane-v2`, varianta A):
 * ← (doar cu un tichet deschis: „înapoi la listă"), firimitura, ✕.
 */
export function PaneBar({ route, peer, onBack, onClose }: {
  route: PaneRoute
  peer: PanePeer
  onBack: () => void
  onClose: () => void
}) {
  const twin = route.ticketId !== null && route.ticketId === peer.otherTicketId
  return (
    <div className="pane-bar">
      {route.ticketId && (
        <button type="button" className="pane-bar-btn" onClick={onBack} aria-label="Înapoi la listă" title="Înapoi la listă">
          <Icon name="back" size={16} />
        </button>
      )}
      <span className="pane-crumb">
        {route.screen === 'today' && !route.ticketId && <span className="pane-crumb-star"><Icon name="today" size={14} /></span>}
        {route.accent && <i className="pane-crumb-dot" style={{ ['--pc' as string]: route.accent }} />}
        <span className="pane-crumb-label">{route.label}</span>
        {route.ticketId && <><span className="pane-crumb-sl">/</span><span className="pane-crumb-id">{route.ticketId}</span></>}
      </span>
      {twin && <span className="pane-twin">deschis și în celălalt panou</span>}
      <span className="pane-bar-sp" />
      {peer.split && (
        <button type="button" className="pane-bar-btn pane-close" onClick={onClose} aria-label="Închide panoul" title="Închide panoul">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}

/** ✕ a trecut de gardă: gazda scoate panoul. */
export const postPaneClose = () => post({ hz: 'pane', kind: 'close' })
