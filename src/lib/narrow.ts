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
//
// La fel „lat" (`<html data-wide>`, pragul panoului lateral, 1200px): într-un
// panou e mereu adevărat, ca tichetul să se deschidă DOCAT („lista SAU
// tichetul": `.split-pane` pe toată lățimea panoului), nu ca modalul de 94%.

export const NARROW_QUERY = '(max-width: 899px)'
export const WIDE_QUERY = '(min-width: 1200px)'

/** Pur: lat = viewport peste pragul panoului lateral SAU un panou al panoului dublu. */
export function isWide(viewportWide: boolean, pane: boolean): boolean {
  return viewportWide || pane
}

/** Pur: îngust = viewport sub prag ȘI nu suntem un panou al panoului dublu. */
export function isNarrow(viewportNarrow: boolean, pane: boolean): boolean {
  return viewportNarrow && !pane
}

let pane = false
/** Bara de captură de pe Linux: o fereastră de 720px pe desktop, cu mouse — niciodată „îngustă". */
let desktop = false
const listeners = new Set<() => void>()

export function narrowNow(): boolean {
  if (typeof window === 'undefined') return false
  return isNarrow(window.matchMedia(NARROW_QUERY).matches, pane || desktop)
}

export function wideNow(): boolean {
  if (typeof window === 'undefined') return false
  return isWide(window.matchMedia(WIDE_QUERY).matches, pane)
}

/** O dată, sincron, înainte de prima randare (`main.tsx`): primul cadru are deja layoutul corect. */
export function installNarrow(opts: { pane?: boolean; desktop?: boolean } = {}): void {
  pane = !!opts.pane
  desktop = !!opts.desktop
  const root = document.documentElement
  const apply = () => {
    root.toggleAttribute('data-narrow', narrowNow())
    root.toggleAttribute('data-wide', wideNow())
    for (const fn of [...listeners]) fn()
  }
  apply()
  window.matchMedia(NARROW_QUERY).addEventListener('change', apply)
  window.matchMedia(WIDE_QUERY).addEventListener('change', apply)
}

/** Pentru `useSyncExternalStore` (`useNarrow` / `useWide` din hooks.ts). */
export function subscribeNarrow(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
