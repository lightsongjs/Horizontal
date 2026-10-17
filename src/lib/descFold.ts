/**
 * Descrierea care are înălțimea textului (panoul lateral, formularul de pe
 * telefon, foaia de tichet). Macheta: `design/panel-thread/index.html`.
 *
 * Înainte, în panou descrierea ținea mereu 420px, chiar goală, iar Firul cădea
 * sub pliu. Acum cutia crește cu textul, până la un plafon; peste el se pliază
 * cu „Arată tot · încă N rânduri". Regulile de aici sunt pure ca să se poată
 * testa fără layout — măsurătorile (px) le dă componenta.
 */

/** Plafonul din panou nu trece de atât, oricât de înalt ar fi ecranul. */
export const PANE_CAP_PX = 340
/** Partea din panou / din ecranul vizibil pe care o poate ocupa descrierea. */
export const CAP_SHARE = 0.45
/** Nu ascundem un singur rând în spatele unui buton: plierea cere măcar atâtea. */
export const MIN_HIDDEN_LINES = 4

/**
 * Plafonul, în px. În panou `min(340, 45%)` din înălțimea panoului; pe
 * telefon 45% din înălțimea vizibilă (`--vvh`), fiindcă acolo ecranul e
 * măsura, nu un panou.
 */
export function descCap(host: number, where: 'pane' | 'viewport'): number {
  const share = Math.max(0, host) * CAP_SHARE
  return Math.round(where === 'pane' ? Math.min(PANE_CAP_PX, share) : share)
}

/**
 * Se pliază descrierea? `content` = înălțimea naturală a textului, `cap` =
 * plafonul, `line` = înălțimea unui rând. `hidden` = câte rânduri ar rămâne
 * sub pliu (rotunjit în sus: un rând tăiat pe jumătate e tot ascuns).
 */
export function foldState(content: number, cap: number, line: number): { folds: boolean; hidden: number } {
  if (!(content > cap) || !(line > 0) || !(cap > 0)) return { folds: false, hidden: 0 }
  const hidden = Math.ceil((content - cap) / line - 0.01)
  return { folds: hidden >= MIN_HIDDEN_LINES, hidden }
}

/**
 * Înălțimea editorului fără golul de umplere: `outer` = editorul, `scroller` =
 * scroller-ul lui (întins de CSS cât să umple foaia), `text` = rândurile +
 * padding-ul conținutului. Ce are scroller-ul peste text e umplutură, nu text
 * — iar `foldState` trebuie să vadă textul: umplutura depinde de pliere, deci
 * plierea ar decide după propriul efect și ar oscila (vezi `DescFold`).
 * Rotunjit, ca subpixelii să nu schimbe măsura între două citiri identice.
 */
export function stretchedOut(outer: number, scroller: number, text: number): number {
  return Math.round(outer - Math.max(0, scroller - text))
}

/**
 * „încă 21 de rânduri", „încă 4 rânduri", „încă un rând". În română „de" vine
 * după 20 și peste (și după sutele rotunde), nu și după 1–19 sau 101–119.
 */
export function moreLinesLabel(n: number): string {
  if (n === 1) return 'încă un rând'
  const rest = n % 100
  const de = n !== 0 && (rest === 0 || rest >= 20)
  return `încă ${n} ${de ? 'de ' : ''}rânduri`
}

/**
 * O atingere pe descriere, pe telefon (D-196): cât e PLIATĂ, întâi o arată
 * întreagă — fără focus, fără tastatură; abia pe textul întreg o atingere
 * pune cursorul. Pe ce e control în text (bifa, un link, „Arată tot") atingerea
 * își face treaba ei, pliat sau nu. Panoul lateral (mouse) rămâne cum era:
 * acolo un click în text e deja o alegere a locului unde scrii.
 */
export function tapRevealsOnly(where: 'pane' | 'viewport' | null, capped: boolean, onControl: boolean): boolean {
  return where === 'viewport' && capped && !onControl
}

/** Ce e control în cutia descrierii: bifa, linkurile, `#HZ-12`, „Arată tot". */
export const DESC_CONTROLS = '.md-task, [data-href], [data-ref], .desc-more'
