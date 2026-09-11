/**
 * Ce scrie recunoașterea din titlu în câmpurile de scadență — și ce are voie
 * să retragă.
 *
 * Regula e pură și stă aici, nu în formular, pentru că e singurul loc unde se
 * decide dacă o scadență existentă se pierde. Trei intrări, două ieșiri, nicio
 * referință la React sau la ceasul sistemului: tot ce ține de „azi" s-a
 * întâmplat deja în `parseDue`.
 */

/** Câmpurile de scadență, exact în forma pe care o scrie omul. */
export interface DueFields {
  /** `zz/ll/aaaa`, sau gol. */
  date: string
  /** `HH:MM`, sau gol — gol înseamnă toată ziua. */
  time: string
}

/** Ce a completat recunoașterea, și peste ce a completat. */
export interface FillMemo {
  /** Valorile scrise de recunoaștere. */
  wrote: DueFields
  /** Valorile dinaintea primei completări — ce se pune înapoi la retragere. */
  before: DueFields
}

export interface FillResult {
  /** Ce trebuie să ajungă în câmpuri. */
  fields: DueFields
  /** Memoria de dus mai departe. `null` = nu mai e nimic de retras. */
  memo: FillMemo | null
}

const same = (a: DueFields, b: DueFields) => a.date === b.date && a.time === b.time

/**
 * @param fields ce e ACUM în câmpuri
 * @param recognized ce a înțeles parserul din titlu, sau `null` dacă titlul nu
 *   mai conține o dată (ori fragmentul a fost refuzat)
 * @param memo ce s-a completat data trecută
 *
 * Titlul e stăpânul: o dată recunoscută suprascrie orice, inclusiv o scadență
 * aleasă cândva din calendar. Ce face schimbarea reversibilă e `before` —
 * ștergerea fragmentului din titlu pune înapoi valoarea dinainte, nu golul.
 *
 * `mine` e condiția care ține retragerea onestă: dacă omul a schimbat câmpul cu
 * mâna după ce am completat noi, valoarea nu mai e a noastră. Atunci nu se
 * retrage nimic, iar la următoarea completare ea devine noua bază — baza e
 * întotdeauna ultima valoare pe care n-am scris-o noi.
 */
export function fillFromTitle(
  fields: DueFields,
  recognized: DueFields | null,
  memo: FillMemo | null,
): FillResult {
  const mine = memo !== null && same(fields, memo.wrote)
  if (recognized) {
    return { fields: recognized, memo: { wrote: recognized, before: mine ? memo!.before : fields } }
  }
  return { fields: mine ? memo!.before : fields, memo: null }
}
