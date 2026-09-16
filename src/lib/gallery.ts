/**
 * Indexul din galeria de imagini — mutarea și ce rămâne deschis după ștergere.
 *
 * E aici, nu în `Lightbox.tsx`, din același motiv ca `schedule.ts` sau
 * `parseDue.ts`: sunt reguli despre numere, nu despre pixeli, iar cazurile care
 * chiar dor (ultima poză ștearsă, galeria golită) se verifică mai ieftin într-un
 * test decât cu un click.
 */

/**
 * Vecinul, fără ciclare. La capăt nu se întoarce la început: săgeata se stinge
 * și contorul („3 / 3") spune deja unde ești. O galerie care se învârte la
 * infinit face imposibil de știut dacă ai văzut tot.
 */
export function step(count: number, index: number, delta: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, index + delta))
}

/** Ultima poziție? Butonul de „înainte" n-are ce face. */
export function atEnd(count: number, index: number): boolean {
  return index >= count - 1
}

/**
 * Ce rămâne deschis după ce se șterge imaginea de la `index` dintr-o listă de
 * `count`. Indexul întors e în lista NOUĂ, mai scurtă cu unu; `null` înseamnă
 * „nu mai e nimic de arătat", deci vizualizatorul se închide.
 *
 * Ștergi din mijloc → rămâi pe loc, adică pe imaginea care vine după (exact ce
 * te aștepți de la un „șterge, șterge, șterge" pe rând). Ștergi ultima → te
 * muți cu una înapoi, fiindcă „după" nu mai există.
 */
export function afterDelete(count: number, index: number): number | null {
  if (count <= 1) return null
  return index >= count - 1 ? count - 2 : index
}
