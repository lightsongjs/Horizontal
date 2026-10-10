// Gramatica gesturilor pe un rând de sarcină, pe telefon. Pur: praguri,
// blocarea direcției și ce înseamnă o eliberare. Componenta (`TaskRow`) doar
// citește degetul și aplică rezultatul — numerele de aici sunt cele din spec,
// într-un singur loc, ca glisarea și tragerea pentru refresh (`App.tsx`) să
// împartă exact aceeași regulă de direcție.

/** Sub atâta mișcare nu se decide nimic: degetul încă tremură. */
export const LOCK_PX = 10
/** Orizontal doar dacă |dx| > 1,5·|dy| — altfel e derulare și o lăsăm în pace. */
export const AXIS_RATIO = 1.5
/** Peste atâta mișcare, atingerea nu mai e o atingere (nu deschide foaia). */
export const TAP_SLOP = 8
/** Ținută atât, fără mișcare, atingerea intră în selecție. */
export const LONG_PRESS_MS = 450
/** Gestul „înapoi" de pe Android pornește din margine: nu-l furăm. */
export const EDGE_PX = 24
/** Glisarea completă: peste 55% din lățimea rândului. */
export const FULL_RATIO = 0.55

/** Lățimea benzii dezvăluite: un buton rotund pe stânga, trei pe dreapta. */
export const REVEAL_LEFT = 72
export const REVEAL_RIGHT = 172

export type Axis = 'pending' | 'h' | 'v'

/** Atingerea pornește din marginea ecranului? Atunci e a sistemului. */
export function inEdge(x: number, viewportWidth: number): boolean {
  return x < EDGE_PX || x > viewportWidth - EDGE_PX
}

/**
 * Direcția gestului, decisă o singură dată. `pending` până trec 10px; apoi
 * `h` numai dacă mișcarea e clar orizontală, altfel `v` — derularea câștigă
 * orice caz îndoielnic, fiindcă o listă care nu se mai derulează e mai rea
 * decât o glisare ratată.
 */
export function lockAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) < LOCK_PX) return 'pending'
  return Math.abs(dx) > AXIS_RATIO * Math.abs(dy) ? 'h' : 'v'
}

/** A depășit degetul pragul unei atingeri? */
export function movedBeyondTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TAP_SLOP
}

/** Starea de repaus a unui rând. */
export type Rest = 'closed' | 'left' | 'right'

export function restOffset(rest: Rest): number {
  return rest === 'left' ? REVEAL_LEFT : rest === 'right' ? -REVEAL_RIGHT : 0
}

/** Pragul glisării complete, în px, pentru un rând de `width`. */
export function fullThreshold(width: number): number {
  return Math.round(width * FULL_RATIO)
}

/**
 * Deplasarea rândului sub deget. Un rând deja deschis pornește de la banda
 * lui. Pe partea opusă unei acțiuni nu se trece de zero: un rând deschis la
 * dreapta, tras spre dreapta, se închide — nu sare direct pe cealaltă bandă.
 * Nu iese din ecran: plafonat la lățimea rândului.
 */
export function dragOffset(rest: Rest, dx: number, width: number): number {
  const raw = restOffset(rest) + dx
  const lo = rest === 'left' ? 0 : -width
  const hi = rest === 'right' ? 0 : width
  return Math.max(lo, Math.min(hi, raw))
}

/** Dincolo de prag: banda se colorează și telefonul vibrează o dată. */
export function crossedFull(offset: number, width: number): boolean {
  return Math.abs(offset) >= fullThreshold(width)
}

export type Release =
  | { kind: 'commit-right' } // „Mâine", glisare completă spre dreapta
  | { kind: 'full-left' } // foaia de dată — glisarea completă spre stânga nu execută nimic singură
  | { kind: 'rest'; rest: Rest }

/**
 * Ce se întâmplă la ridicarea degetului. Peste prag, acțiunea; peste jumătatea
 * benzii, banda rămâne deschisă (butoanele se apasă); altfel rândul se închide.
 */
export function release(offset: number, width: number): Release {
  if (offset >= fullThreshold(width)) return { kind: 'commit-right' }
  if (-offset >= fullThreshold(width)) return { kind: 'full-left' }
  if (offset >= REVEAL_LEFT / 2) return { kind: 'rest', rest: 'left' }
  if (-offset >= REVEAL_RIGHT / 2) return { kind: 'rest', rest: 'right' }
  return { kind: 'rest', rest: 'closed' }
}

/**
 * Sertarul se deschide trăgând din marginea STÂNGĂ — exact zona pe care
 * rândurile o lasă în pace (`inEdge`), deci o glisare de rând și deschiderea
 * sertarului nu pot porni din același deget. Direcția o decide tot `lockAxis`,
 * ca la rânduri și la tragerea de refresh: o tragere oblică e derulare.
 */
export const DRAWER_OPEN_PX = 48

export function drawerSwipe(startX: number, axis: Axis, dx: number): boolean {
  return startX < EDGE_PX && axis === 'h' && dx >= DRAWER_OPEN_PX
}
