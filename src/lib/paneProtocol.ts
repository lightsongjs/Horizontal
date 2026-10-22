// Ce își spun gazda și panourile panoului dublu (`postMessage`, same-origin).
// Pur: tipurile, validarea și cele două reguli care se testează fără browser —
// tasta de comutare și marcajele barei laterale.
// Spec: docs/superpowers/specs/2026-10-22-split-pane-design.md.

import type { PaneId } from './pane'

/** Unde e un panou: ce trebuie să știe gazda ca să marcheze bara laterală și URL-ul. */
export interface PaneRoute {
  /** Ecranul de sus (`today`, `week`, `inbox`, `filter:<id>`), `users`, sau null pe un proiect. */
  screen: string | null
  /** Proiectul deschis CA ecran (nu doar încărcat sub o listă). */
  projectId: string | null
  /** Tichetul deschis în panou, sau null. */
  ticketId: string | null
  /** Calea pe care o arată panoul (`/`, `/project/x`, `/HZ-12`) — URL-ul de sus, cât are focus. */
  path: string
  /** `history.state` al intrării curente — scris în bara de sus odată cu calea. */
  state: unknown
  /** Firimitura din bara panoului: „Azi”, numele proiectului (al tichetului, cu unul deschis)… */
  label: string
  /** Culoarea proiectului din firimitură (bulina), sau null pe o listă. */
  accent?: string | null
}

/** Ce poate cere bara laterală (a gazdei) panoului cu focus. */
export type NavAction =
  | { type: 'screen'; screen: string }
  | { type: 'project'; id: string }
  | { type: 'filter-form'; id?: string }
  | { type: 'search' }
  | { type: 'new-issue' }
  | { type: 'new-project' }
  | { type: 'settings' }

export type PaneToHost =
  | { hz: 'pane'; kind: 'ready' }
  /** Omul a ales panoul (clic, tastă în el). */
  | { hz: 'pane'; kind: 'focus' }
  /** Tastatura a ajuns aici fără un gest al omului (un `focus()` din cod): dă-o înapoi panoului activ. */
  | { hz: 'pane'; kind: 'yield' }
  | { hz: 'pane'; kind: 'route'; route: PaneRoute }
  /** Ctrl+Shift+[ / ]: LATURA (stânga / dreapta), nu id-ul — gazda știe ce panou stă unde. */
  | { hz: 'pane'; kind: 'switch'; to: PaneId }
  /** ✕ a trecut de garda panoului: gazda îl poate scoate. */
  | { hz: 'pane'; kind: 'close' }

export type HostToPane =
  | { hz: 'host'; kind: 'nav'; action: NavAction }
  /** Back-ul browserului, cât panoul are focus. */
  | { hz: 'host'; kind: 'back' }
  /** Ia focusul tastaturii (după Ctrl+Shift+[ ], sau un clic în bara laterală). */
  | { hz: 'host'; kind: 'focus' }
  /** ✕ din bara panoului: aplică-ți garda, apoi răspunde cu `close`. */
  | { hz: 'host'; kind: 'close-request' }
  /** Un deep link venit în documentul de sus (clic pe notificare) — deschide-l aici. */
  | { hz: 'host'; kind: 'open-path'; path: string }
  /** Starea celuilalt panou: ce tichet are deschis, câte panouri sunt, dacă tu ai focusul. */
  | { hz: 'host'; kind: 'peer'; otherTicketId: string | null; split: boolean; focused: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function isPaneToHost(v: unknown): v is PaneToHost {
  if (!isObj(v) || v.hz !== 'pane') return false
  switch (v.kind) {
    case 'ready': case 'focus': case 'yield': case 'close': return true
    case 'switch': return v.to === 'L' || v.to === 'R'
    case 'route': return isObj(v.route) && typeof v.route.path === 'string' && typeof v.route.label === 'string'
    default: return false
  }
}

export function isHostToPane(v: unknown): v is HostToPane {
  if (!isObj(v) || v.hz !== 'host') return false
  switch (v.kind) {
    case 'back': case 'focus': case 'close-request': return true
    case 'open-path': return typeof v.path === 'string' && v.path.startsWith('/')
    case 'peer': return typeof v.split === 'boolean' && typeof v.focused === 'boolean'
    case 'nav': return isObj(v.action) && typeof v.action.type === 'string'
    default: return false
  }
}

/**
 * Ctrl+Shift+[ → stânga, Ctrl+Shift+] → dreapta (ca în kitty). După `code`,
 * nu după `key`: pe tastatura RO standard tastele scriu ă / î (cu Shift Ă / Î),
 * iar pe US `{` / `}`. Fără Alt / Meta (AltGr = Ctrl+Alt pe Linux/Windows).
 */
export function paneSwitchTarget(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): PaneId | null {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null
  return e.code === 'BracketLeft' ? 'L' : e.code === 'BracketRight' ? 'R' : null
}

/** Ce primește bara laterală a gazdei: locul panoului cu focus ca „on”, al celuilalt ca punct gri. */
export interface SidebarMarks {
  screen: string | null
  projectId: string | null
  otherScreen: string | null
  otherProjectId: string | null
}

export function sidebarMarks(focused: PaneRoute | null, other: PaneRoute | null): SidebarMarks {
  return {
    screen: focused?.screen ?? null,
    projectId: focused && !focused.screen ? focused.projectId : null,
    otherScreen: other?.screen ?? null,
    otherProjectId: other && !other.screen ? other.projectId : null,
  }
}
