// Deep links pentru tickete: URL-ul unui ticket e doar id-ul lui, la rădăcină
// (ex. /MS-03). Vezi docs/superpowers/specs/2026-07-28-ticket-deep-links-design.md
//
// Id-urile de issue au forma PREFIX-SUFIX (TUR-01, MS-03, TUR-API) — exact o
// cratimă, doar litere și cifre. Regexul e deliberat strict ca un slug de
// proiect (my-super-project) să nu fie confundat cu un id de ticket.
//
// Plus forma provizorie a unui tichet creat offline, `PREFIX-~abc123`
// (`makeTempIssueId`). Și ea e un URL de tichet: foaia deschisă pe o sarcină
// nesincronizată o pune în bară, iar o repornire offline peste ea trebuie să
// redeschidă foaia. Respinsă aici, nu era „tichet" pentru nimeni — nici pentru
// boot, nici pentru `popstate`, nici pentru garda lui `back()` — și bara rămânea
// pe un ID mort. Sufixul rămâne cum e: e aleator, în minuscule, nu un număr.

import { displayIssueId } from './issueId'

const TICKET_PATH = /^\/([A-Za-z0-9]+)-(~[a-z0-9]+|[A-Za-z0-9]+)\/?$/

/**
 * Id-ul ticketului din pathname, sau null. Prefixul (și un sufix real) se
 * normalizează uppercase; sufixul provizoriu nu.
 *
 * `resolveId` (din `repository.sync`) traduce un ID provizoriu deja remapat pe
 * cel real: un URL `/HZ-~abc` rămas din sesiunea dinainte de sincronizare
 * deschide `HZ-13`, nu un tichet care nu mai există sub numele vechi.
 */
export function parseTicketPath(pathname: string, resolveId: (id: string) => string = (id) => id): string | null {
  const match = TICKET_PATH.exec(pathname)
  if (!match) return null
  const [, prefix, suffix] = match
  const id = `${prefix.toUpperCase()}-${suffix.startsWith('~') ? suffix : suffix.toUpperCase()}`
  return resolveId(id)
}

/** Prefixul de proiect al unui id de issue: 'MS-03' -> 'MS'. */
export function prefixOf(issueId: string): string {
  const dash = issueId.indexOf('-')
  return (dash === -1 ? issueId : issueId.slice(0, dash)).toUpperCase()
}

/**
 * Proiectul căruia îi aparține un id de ticket, dedus din prefix. Un path de
 * ticket (/MS-03) nu conține proiectul, deci asta e singura cale de la URL la
 * proiect. Comparația ignoră caps-ul.
 *
 * Ambiguitate acceptată: dacă două proiecte împart prefixul, câștigă primul din
 * listă. În practică nu se poate întâmpla — `id`-ul unui proiect **este**
 * `prefix.toLowerCase()` și e cheie primară.
 */
export function resolveTicketProject<P extends { prefix: string }>(
  projects: readonly P[],
  ticketId: string,
): P | null {
  const prefix = prefixOf(ticketId)
  return projects.find((p) => p.prefix.toUpperCase() === prefix) ?? null
}

/**
 * De ce nu s-a putut deschide un deep link: fie datele s-au încărcat și
 * ticketul chiar nu există, fie încărcarea a eșuat și nu știm nimic despre el.
 */
export type DeepLinkFailure = 'missing' | 'load-failed'

/**
 * Mesajul pentru un deep link care nu s-a putut deschide. Un eșec de încărcare
 * nu are voie să pretindă că ticketul a dispărut — sunt două probleme diferite,
 * cu soluții diferite pentru user.
 */
export function deepLinkNotice(ticketId: string, failure: DeepLinkFailure): string {
  // Sufixul provizoriu nu-i spune nimic omului; pe ecran tichetul e `HZ-·`.
  const shown = displayIssueId(ticketId)
  return failure === 'load-failed'
    ? `Nu am putut încărca datele pentru ${shown}. Încearcă din nou.`
    : `Ticketul ${shown} nu mai există`
}

/** Path-ul canonic al unui ticket. */
export function ticketPath(issueId: string): string {
  return `/${issueId}`
}

/** URL absolut, pentru clipboard. */
export function ticketUrl(origin: string, issueId: string): string {
  return `${origin.replace(/\/$/, '')}${ticketPath(issueId)}`
}
