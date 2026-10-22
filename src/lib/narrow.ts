// „Îngust" (layoutul de telefon: bara de jos, FAB, sertar, foi de jos,
// glisări) e o decizie a APLICAȚIEI, nu a viewportului.
//
// De ce: în panoul dublu fiecare panou e aplicația într-un `<iframe>` de
// ~570px, iar acolo `(max-width: 899px)` ar fi adevărat — un panou de desktop,
// cu mouse, ar fi primit layoutul de telefon. Deci CSS-ul nu mai întreabă
// viewportul direct: `<html data-narrow>` e pus aici, iar regulile de telefon
// sunt `:where(html[data-narrow]) …`, cele de desktop
// `:where(html:not([data-narrow])) …` (`:where`, ca specificitatea să rămână
// cea de sub fostul `@media`). Un test `?raw` pică pe un `@media` 899/900 nou.
//
// Fără panouri, atributul urmează exact `(max-width: 899px)` — același prag.

export const NARROW_QUERY = '(max-width: 899px)'

/** Pur: îngust = viewport sub prag ȘI nu suntem un panou al panoului dublu. */
export function isNarrow(viewportNarrow: boolean, pane: boolean): boolean {
  return viewportNarrow && !pane
}

let pane = false
const listeners = new Set<() => void>()

export function narrowNow(): boolean {
  if (typeof window === 'undefined') return false
  return isNarrow(window.matchMedia(NARROW_QUERY).matches, pane)
}

/** O dată, sincron, înainte de prima randare (`main.tsx`): primul cadru are deja layoutul corect. */
export function installNarrow(opts: { pane?: boolean } = {}): void {
  pane = !!opts.pane
  const root = document.documentElement
  const apply = () => {
    root.toggleAttribute('data-narrow', narrowNow())
    for (const fn of [...listeners]) fn()
  }
  apply()
  window.matchMedia(NARROW_QUERY).addEventListener('change', apply)
}

/** Pentru `useSyncExternalStore` (`useNarrow` din hooks.ts). */
export function subscribeNarrow(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
