// ID-uri provizorii pentru tichetele create offline.
//
// `HZ-12` e calculat de client ca „cel mai mare + 1" (`nextIssueId` din
// `supabaseRepository.ts`). Două dispozitive offline ar crea amândouă `HZ-13`.
// Deci offline nu se inventează un număr: se pune un marcaj (`-~`) care nu
// poate apărea într-un ID real (`TICKET_PATH` din `deepLink.ts` nu-l acceptă),
// iar la sincronizare serverul dă numărul.

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
