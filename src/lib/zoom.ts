/**
 * Mărirea din galerie (`Lightbox`) — numai aritmetică, fără DOM.
 *
 * Pagina are `user-scalable=no` (foile lipite de tastatură măsoară în pixeli
 * reali), deci ciupitul browserului nu există: galeria își face singură
 * mărirea, cu `transform` pe imagine. Aici stau regulile care chiar se pot
 * greși — punctul de sub degete rămâne pe loc, imaginea nu se trage în gol,
 * scara nu fuge sub „încape" — testate ca numere, nu cu degetul.
 *
 * Coordonatele sunt RELATIVE LA CENTRUL cutiei. Imaginea „încăpută" e centrată
 * acolo (`w`×`h`, mărimea ei de layout), iar vederea e `translate(x, y)
 * scale(s)` cu originea în centru: un punct `q` al imaginii (față de centrul
 * ei) ajunge pe ecran la `x + s·q`.
 */

export type View = { s: number; x: number; y: number }
export type Size = { w: number; h: number }
export type Point = { x: number; y: number }

export const FIT: View = { s: 1, x: 0, y: 0 }
/** Cât de mult se poate mări. 5× peste „încape" ajunge la pixelii reali ai
 *  unei poze de telefon (4000px pe un ecran de ~400px, cu DPR 2–3). */
export const MAX_SCALE = 5
/** Dublul-tap: din „încape" direct aici, la punctul atins. */
export const TAP_SCALE = 2

export function clampScale(s: number, max = MAX_SCALE): number {
  if (!Number.isFinite(s)) return 1
  return Math.min(max, Math.max(1, s))
}

/**
 * Pe fiecare axă: dacă imaginea mărită încape în cutie, stă centrată (fără
 * tras în gol); altfel marginea ei nu poate intra în cutie.
 */
export function clampView(v: View, img: Size, box: Size): View {
  const s = clampScale(v.s)
  const axis = (t: number, len: number, room: number) => {
    const slack = (s * len - room) / 2
    if (slack <= 0) return 0
    return Math.min(slack, Math.max(-slack, t))
  }
  return { s, x: axis(v.x, img.w, box.w), y: axis(v.y, img.h, box.h) }
}

/** Scara nouă, cu punctul `f` (față de centrul cutiei) ținut pe loc. */
export function zoomAt(v: View, scale: number, f: Point, img: Size, box: Size): View {
  const s = clampScale(scale)
  const k = s / v.s
  return clampView({ s, x: f.x - k * (f.x - v.x), y: f.y - k * (f.y - v.y) }, img, box)
}

/** Dublul-tap: mărită → înapoi la „încape"; încăpută → `TAP_SCALE` la punct. */
export function toggleZoom(v: View, f: Point, img: Size, box: Size): View {
  return isZoomed(v) ? FIT : zoomAt(v, TAP_SCALE, f, img, box)
}

/**
 * Ciupitul: pornind de la vederea `start`, cu degetele în `a0`/`b0`, acum în
 * `a`/`b`. Scara urmează distanța dintre degete, iar punctul imaginii care era
 * între ele rămâne între ele — deci ciupitul mută și trage în același gest.
 */
export function pinch(start: View, a0: Point, b0: Point, a: Point, b: Point, img: Size, box: Size): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const s = clampScale(d0 > 0 ? (start.s * d) / d0 : start.s)
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const k = s / start.s
  return clampView({ s, x: m.x - k * (m0.x - start.x), y: m.y - k * (m0.y - start.y) }, img, box)
}

/** Tras cu un deget (sau mouse-ul) cât e mărită. */
export function pan(start: View, dx: number, dy: number, img: Size, box: Size): View {
  return clampView({ s: start.s, x: start.x + dx, y: start.y + dy }, img, box)
}

/** Rotița: în sus mărește, în jos micșorează, proporțional cu cât s-a rotit. */
export function wheelScale(s: number, deltaY: number): number {
  return clampScale(s * Math.exp(-deltaY * 0.0025))
}

export function isZoomed(v: View): boolean {
  return v.s > 1.001
}
