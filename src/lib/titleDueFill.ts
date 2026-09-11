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

/** Titlul care ajunge în bază, plus semnalul „n-a mai rămas nimic din el". */
export interface SaveTitle {
  /** Ce se scrie ca titlu — fără fragmentele devenite scadență. */
  title: string
  /** Textul era numai dată: „mâine la 14" n-are ce salva ca sarcină. */
  bare: boolean
}

/**
 * Ce se salvează ca titlu, după ce recunoașterea și-a luat partea.
 *
 * Un fragment devenit scadență e redundant în titlu — scadența se vede deja în
 * câmpul ei și pe card — și, mai rău, minte la a doua deschidere: „la 14"
 * rămas în text se recalculează față de ALTĂ zi. De-aia se taie la salvare, la
 * fel ca la adăugarea rapidă, unde regula asta e de la început.
 *
 * @param raw textul din câmp, așa cum l-a scris omul
 * @param recognized `TitleDate.title` — același text fără fragmentele
 *   recunoscute și nerefuzate (identic cu `raw` când nu s-a recunoscut nimic)
 */
export function titleToSave(raw: string, recognized: string): SaveTitle {
  const title = recognized.trim()
  return { title, bare: title === '' && raw.trim() !== '' }
}
