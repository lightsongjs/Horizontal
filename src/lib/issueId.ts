// ID-uri provizorii pentru tichetele create offline.
//
// `HZ-12` e calculat de client ca „cel mai mare + 1" (`nextIssueId` din
// `supabaseRepository.ts`). Două dispozitive offline ar crea amândouă `HZ-13`.
// Deci offline nu se inventează un număr: se pune un marcaj (`-~`) care nu
// poate apărea într-un ID real, iar la sincronizare serverul dă numărul.
// `TICKET_PATH` din `deepLink.ts` acceptă forma asta ca URL de tichet, separat
// de cea reală — o repornire peste foaia deschisă trebuie s-o redeschidă.

const MARK = '-~'

export function makeTempIssueId(
  prefix: string,
  rand: () => string = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0'),
): string {
  return `${prefix}${MARK}${rand()}`
}

export function isTempIssueId(id: string): boolean {
  return id.includes(MARK)
}

/** Ce vede omul: `HZ-·` până primește numărul real. */
export function displayIssueId(id: string): string {
  const i = id.indexOf(MARK)
  return i === -1 ? id : `${id.slice(0, i)}-·`
}

/**
 * Numărul următor dintr-un proiect: „cel mai mare + 1", cu cel puțin două
 * cifre. ID-urile provizorii (`HZ-~abc`) și cele ciudate nu sunt numere și se
 * ignoră. Scris a doua oară în Kotlin (`core/Create.kt`) pentru fereastra de pe
 * telefon; fixtures comune în `issueId.fixtures.json`.
 */
export function nextIssueId(existing: string[], prefix: string): string {
  const max = existing
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}-${String(max + 1).padStart(2, '0')}`
}
