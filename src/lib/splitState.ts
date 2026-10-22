// Starea panoului dublu în documentul de sus (gazda). Pur, plus trei funcții
// subțiri de `sessionStorage`. Spec: docs/superpowers/specs/2026-10-22-split-pane-design.md.
//
// `sessionStorage`, nu `localStorage`: aceeași linie ca `SESSION_KEY` din
// App.tsx — supraviețuiește unei reîncărcări (inclusiv celei prin care `pwa.ts`
// aplică un build nou, sub om), dar moare cu fila. Pornirea rece = un panou.

import { isPaneId, type PaneId, type PaneSeed } from './pane'

export const SPLIT_KEY = 'horizontal:split'

/** Butonul ▯▯ din antetul tichetului docat cere pornirea; `Shell` o face (are ruta). */
export const OPEN_SPLIT_EVENT = 'hz:open-split'
/** De la cât apare pornirea: pragul panoului lateral (două panouri de ~480px lângă bară). */
export const SPLIT_MIN_QUERY = '(min-width: 1200px)'

/** Ținut numai cât sunt DOUĂ panouri: unul rămas după ✕ e aplicația până la reîncărcare. */
export interface SplitState {
  panes: [PaneId, PaneId]
  focus: PaneId
}

export function parseSplit(raw: string | null): SplitState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { panes?: unknown; focus?: unknown }
    const panes = Array.isArray(v.panes) ? v.panes : []
    if (panes.length !== 2 || !panes.every(isPaneId) || panes[0] === panes[1]) return null
    if (!isPaneId(v.focus) || !panes.includes(v.focus)) return null
    return { panes: [panes[0], panes[1]], focus: v.focus }
  } catch {
    return null
  }
}

export function loadSplit(): SplitState | null {
  try { return parseSplit(sessionStorage.getItem(SPLIT_KEY)) } catch { return null }
}
export function saveSplit(s: SplitState): void {
  try { sessionStorage.setItem(SPLIT_KEY, JSON.stringify(s)) } catch { /* stocare blocată: split-ul nu supraviețuiește reîncărcării */ }
}
export function clearSplit(): void {
  try { sessionStorage.removeItem(SPLIT_KEY) } catch { /* idem */ }
}

export const otherPane = (id: PaneId): PaneId => (id === 'L' ? 'R' : 'L')

/**
 * Intrarea-santinelă din istoricul de sus. Cât trăiesc panourile, Back-ul
 * browserului o părăsește; gazda o pune la loc și trimite „back" panoului cu
 * focus (Back = Back-ul panoului cu focus; pe rădăcina lui, nimic).
 */
export const SENTINEL_MARK = 'hzSplit'
export const isSentinel = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[SENTINEL_MARK] === true
export const sentinelState = (depth: number) => ({ hzDepth: depth, [SENTINEL_MARK]: true })

/**
 * Un deep link în documentul de sus cu panourile pornite: la o REÎNCĂRCARE
 * calea din bară e doar ruta panoului cu focus (scrisă de gazdă), deci se
 * ignoră; la o navigare (clic pe notificare, URL scris) un tichet din cale se
 * deschide în panoul cu focus.
 */
export function deepLinkForPane(navType: string, path: string, isTicketPath: (p: string) => boolean): string | null {
  if (navType === 'reload' || navType === 'back_forward') return null
  return isTicketPath(path) ? path : null
}

/** Ce știe ecranul de sus despre locul lui, la pornirea panourilor. */
export interface HereRoute {
  screen: string | null
  projectSlug: string | null
  ticketId: string | null
}

/** Pur: de unde pornește un panou. `withTicket` = panoul care primește tichetul (stânga). */
export function seedFor(here: HereRoute, withTicket: boolean): PaneSeed {
  const screen = here.screen
  const path = withTicket && here.ticketId
    ? `/${here.ticketId}`
    : screen || !here.projectSlug ? '/' : `/project/${here.projectSlug}`
  return {
    path,
    state: path === '/' ? { hzDepth: 0, hzScreen: screen ?? 'today' } : { hzDepth: 0 },
    lastView: screen && screen !== 'users' ? `smart:${screen}` : null,
    lastProject: here.projectSlug,
  }
}
